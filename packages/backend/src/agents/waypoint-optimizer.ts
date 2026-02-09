/** Builds route candidates from POIs and strategy (nearest-neighbor style). */

import { haversineDistance, ROUTE_STRATEGIES } from '@mappy/shared';
import {
  ROUTE_CONSTANTS,
  DISTANCE_CONSTANTS,
  ROUTE_MODE,
} from '../config/constants.js';

import type {
  LatLng,
  ParsedPreferences,
  SearchSpace,
  RankedPOI,
  OptimizedRoute,
  EvaluatedRoute,
  WaypointSequence,
  RouteType,
  RouteStrategy,
  POIType,
} from '@mappy/shared';

import type { OptimizationStrategy } from './strategic-planner.js';

interface NearestNeighborWeights {
  scoreWeight: number;
  distanceWeight: number;
  typeWeight: number;
  diversityBonus: number;
}

export class WaypointOptimizer {
  async optimize(
    origin: LatLng,
    preferences: ParsedPreferences,
    searchSpace: SearchSpace,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    numFinalRoutes: number = ROUTE_CONSTANTS.FINAL_ROUTES,
    routeType: RouteType = ROUTE_MODE.WALK
  ): Promise<OptimizedRoute[]> {
    console.log(`[WaypointOptimizer] Generating ${numFinalRoutes} diverse routes with ${pois.length} POIs using ${strategy.optimizationStyle} strategy`);

    // Generate candidates using algorithm + AI guidance
    const candidates = this.generateCandidatesAlgorithmic(
      origin,
      preferences,
      searchSpace,
      pois,
      strategy,
      routeType
    );

    if (candidates.length === 0) {
      console.warn('[WaypointOptimizer] No candidates generated, using fallback');
      return [];
    }

    console.log(`[WaypointOptimizer] Generated ${candidates.length} candidates:`,
      candidates.map(c => `${c.strategy} (${c.waypoints.length} stops)`).join(', '));

    // Evaluate each candidate
    const evaluated = candidates.map(candidate =>
      this.evaluateRoute(candidate, preferences, pois, strategy)
    );

    // Sort by composite score and return top N
    const sorted = [...evaluated].sort((a, b) => b.composite - a.composite);
    const selected = sorted.slice(0, numFinalRoutes);

    return selected.map((route, i) => ({
      waypoints: route.waypoints,
      objectives: route.objectives,
      composite: route.composite,
      label: this.assignLabel(route),
      explanation: `Route option ${i + 1}`,
    }));
  }

  /**
   * Generate candidate waypoint sequences using AI-guided nearest-neighbor algorithm.
   */
  private generateCandidatesAlgorithmic(
    origin: LatLng,
    preferences: ParsedPreferences,
    _searchSpace: SearchSpace,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    routeType: RouteType
  ): WaypointSequence[] {
    const targetDistance = this.getTargetDistance(preferences);
    const candidates: WaypointSequence[] = [];

    // Generate 3 distinct route strategies with POI diversification
    try {
      const usedPOIIds = new Set<string>();

      // Strategy 1: SCENIC - Prioritize scenic POIs (parks, viewpoints, water)
      const scenic = this.generateScenicRoute(origin, pois, strategy, targetDistance, routeType, usedPOIIds);
      if (scenic.poiIds) {
        scenic.poiIds.forEach(id => usedPOIIds.add(id));
      }
      candidates.push(scenic);

      // Strategy 2: BALANCED - Mix of POI types and efficient path (excludes POIs from Scenic)
      const balanced = this.generateBalancedRoute(origin, pois, strategy, targetDistance, routeType, usedPOIIds);
      if (balanced.poiIds) {
        balanced.poiIds.forEach(id => usedPOIIds.add(id));
      }
      candidates.push(balanced);

      // Strategy 3: ADVENTUROUS - Explore farther, more diverse POIs (excludes POIs from Scenic + Balanced)
      const adventurous = this.generateAdventurousRoute(origin, pois, strategy, targetDistance, routeType, usedPOIIds);
      candidates.push(adventurous);
    } catch (error) {
      console.error('[WaypointOptimizer] Algorithm generation failed:', error);
    }

    // Filter out invalid candidates
    return candidates.filter(c => c.waypoints.length >= ROUTE_CONSTANTS.MIN_WAYPOINTS);
  }

  /**
   * Generate SCENIC route: STRICTLY prioritize scenic POIs.
   * BUT always includes user-requested POI types for satisfaction.
   */
  private generateScenicRoute(
    origin: LatLng,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    targetDistance: number,
    routeType: RouteType,
    usedPOIIds: Set<string> = new Set()
  ): WaypointSequence {
    // STRICT filter: ONLY scenic POIs (viewpoint, park, water, scenic, nature)
    const scenicTypes: POIType[] = ['viewpoint', 'park', 'water', 'scenic', 'nature'];
    const scenicPOIs = pois.filter(p => scenicTypes.includes(p.type) && !usedPOIIds.has(p.id));

    // CRITICAL: Extract user-requested POI types from AI strategy
    const userRequestedTypes = new Set<POIType>(
      Object.keys(strategy.poiPriorities) as POIType[]
    );

    // Ensure at least one POI of each user-requested type is included
    const requiredPOIs: RankedPOI[] = [];
    for (const requestedType of userRequestedTypes) {
      if (!scenicTypes.includes(requestedType)) {
        // Find best POI of this type that hasn't been used (prefer fresh POIs for diversity)
        const bestOfType = pois
          .filter(p => p.type === requestedType && !usedPOIIds.has(p.id))
          .sort((a, b) => b.score.composite - a.score.composite)[0];
        if (bestOfType) {
          requiredPOIs.push(bestOfType);
        } else {
          // Fallback: allow reuse if no fresh POIs available
          const fallbackPOI = pois
            .filter(p => p.type === requestedType)
            .sort((a, b) => b.score.composite - a.score.composite)[0];
          if (fallbackPOI) requiredPOIs.push(fallbackPOI);
        }
      }
    }

    // Combine: scenic POIs + required user preferences
    const usePOIs = scenicPOIs.length >= 3
      ? [...scenicPOIs, ...requiredPOIs]
      : [...scenicPOIs, ...requiredPOIs, ...pois.filter(p => !scenicTypes.includes(p.type) && !requiredPOIs.some(r => r.id === p.id)).slice(0, 10)];

    // Weights strongly favor scenic beauty, allow going farther
    const weights: NearestNeighborWeights = {
      scoreWeight: 2.0,     // Highest quality scenic spots
      distanceWeight: 0.2,  // Willing to go far for scenic spots
      typeWeight: 3.0,      // HEAVILY favor scenic types
      diversityBonus: 0.3,  // Less focus on diversity, more on scenic quality
    };

    return this.nearestNeighborRoute(
      origin,
      usePOIs,
      strategy,
      targetDistance,
      weights,
      ROUTE_STRATEGIES.SCENIC,
      routeType
    );
  }

  /**
   * Generate BALANCED route: efficient path with good POI mix.
   * Prioritizes nearby high-scoring POIs and ensures user preferences are met.
   */
  private generateBalancedRoute(
    origin: LatLng,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    targetDistance: number,
    routeType: RouteType,
    usedPOIIds: Set<string> = new Set()
  ): WaypointSequence {
    // Use top 60% of POIs by score, excluding already used ones for diversity
    const topPOIs = pois
      .slice()
      .filter(p => !usedPOIIds.has(p.id))
      .sort((a, b) => b.score.composite - a.score.composite)
      .slice(0, Math.ceil(pois.length * 0.6));

    // CRITICAL: Ensure at least one POI of each user-requested type
    const userRequestedTypes = new Set<POIType>(
      Object.keys(strategy.poiPriorities) as POIType[]
    );
    const requiredPOIs: RankedPOI[] = [];
    for (const requestedType of userRequestedTypes) {
      // Prefer unused POIs for diversity
      const bestOfType = pois
        .filter(p => p.type === requestedType && !usedPOIIds.has(p.id))
        .sort((a, b) => b.score.composite - a.score.composite)[0];
      if (bestOfType && !topPOIs.some(p => p.id === bestOfType.id)) {
        requiredPOIs.push(bestOfType);
      } else if (!bestOfType) {
        // Fallback: allow reuse if necessary
        const fallback = pois
          .filter(p => p.type === requestedType)
          .sort((a, b) => b.score.composite - a.score.composite)[0];
        if (fallback && !topPOIs.some(p => p.id === fallback.id)) {
          requiredPOIs.push(fallback);
        }
      }
    }

    // Combine top POIs with required user preferences
    const usePOIs = [...topPOIs, ...requiredPOIs];

    // Balanced weights - equal importance to all factors
    const weights: NearestNeighborWeights = {
      scoreWeight: 1.2,
      distanceWeight: 1.2,  // Favor nearby POIs for efficiency
      typeWeight: 1.0,
      diversityBonus: strategy.diversityWeight * 2.5,
    };

    return this.nearestNeighborRoute(
      origin,
      usePOIs,
      strategy,
      targetDistance,
      weights,
      ROUTE_STRATEGIES.BALANCED,
      routeType
    );
  }

  /**
   * Generate ADVENTUROUS route: explore farther, discover hidden gems.
   * Prioritizes less-visited POIs but ensures user preferences are met.
   */
  private generateAdventurousRoute(
    origin: LatLng,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    targetDistance: number,
    routeType: RouteType,
    usedPOIIds: Set<string> = new Set()
  ): WaypointSequence {
    // Use farther POIs: sort by distance from origin, take middle 60% (skip closest and extreme outliers)
    // IMPORTANT: Exclude already used POIs for diversity
    const sortedByDistance = pois
      .slice()
      .filter(p => !usedPOIIds.has(p.id))
      .map(p => ({ poi: p, dist: haversineDistance(origin, p.location) }))
      .sort((a, b) => a.dist - b.dist);

    const startIdx = Math.floor(sortedByDistance.length * 0.2);
    const endIdx = Math.ceil(sortedByDistance.length * 0.8);
    const farPOIs = sortedByDistance.slice(startIdx, endIdx).map(x => x.poi);

    // CRITICAL: Ensure at least one POI of each user-requested type
    const userRequestedTypes = new Set<POIType>(
      Object.keys(strategy.poiPriorities) as POIType[]
    );
    const requiredPOIs: RankedPOI[] = [];
    for (const requestedType of userRequestedTypes) {
      // Prefer unused POIs
      const bestOfType = pois
        .filter(p => p.type === requestedType && !usedPOIIds.has(p.id))
        .sort((a, b) => b.score.composite - a.score.composite)[0];
      if (bestOfType && !farPOIs.some(p => p.id === bestOfType.id)) {
        requiredPOIs.push(bestOfType);
      } else if (!bestOfType) {
        // Fallback: allow reuse
        const fallback = pois
          .filter(p => p.type === requestedType)
          .sort((a, b) => b.score.composite - a.score.composite)[0];
        if (fallback && !farPOIs.some(p => p.id === fallback.id)) {
          requiredPOIs.push(fallback);
        }
      }
    }

    // Combine far POIs with required user preferences
    const usePOIs = [...farPOIs, ...requiredPOIs];

    // Adjust target distance based on AI risk tolerance
    const adjustedDistance = targetDistance * (1 + strategy.riskTolerance * 0.4);

    // Adventurous weights: favor diversity and farther exploration
    const weights: NearestNeighborWeights = {
      scoreWeight: 1.0,
      distanceWeight: 0.4,  // Very willing to explore farther
      typeWeight: 0.7,
      diversityBonus: strategy.diversityWeight * 4,  // MAXIMUM diversity
    };

    return this.nearestNeighborRoute(
      origin,
      usePOIs,
      strategy,
      adjustedDistance,
      weights,
      ROUTE_STRATEGIES.ADVENTUROUS,
      routeType
    );
  }

  /**
   * Core nearest-neighbor algorithm with AI-guided scoring.
   * 
   * Greedy algorithm that selects next POI based on weighted score considering:
   * - POI composite score (from POIDiscoverer)
   * - Distance from current point
   * - POI type match with AI priorities
   * - Diversity bonus for new POI types
   * - Loop closure constraint
   */
  private nearestNeighborRoute(
    origin: LatLng,
    pois: RankedPOI[],
    strategy: OptimizationStrategy,
    targetDistance: number,
    weights: NearestNeighborWeights,
    routeStrategy: RouteStrategy,
    routeType: RouteType
  ): WaypointSequence {
    const waypoints: LatLng[] = [origin];
    const poiIds: string[] = [];
    const usedTypes = new Set<POIType>();
    const used = new Set<string>();
    let cumulativeDistance = 0;

    const roadFactor = 1.7;  // Road distance is ~1.7x straight-line in urban areas
    const maxPOIs = routeType === ROUTE_MODE.WALK ? 4 : 5;
    const minPOISpacing = DISTANCE_CONSTANTS.MIN_POI_SPACING_M;

    while (cumulativeDistance < targetDistance * 0.85 && poiIds.length < maxPOIs) {
      const lastPoint = waypoints[waypoints.length - 1];

      // Score each unused POI
      const candidates = pois
        .filter(p => !used.has(p.id))
        .map(p => {
          const distToPoint = haversineDistance(lastPoint, p.location);

          // Skip if too close to any existing waypoint
          if (distToPoint < minPOISpacing) return null;

          const score = this.scorePOIForRoute(
            p,
            lastPoint,
            origin,
            strategy,
            weights,
            usedTypes,
            cumulativeDistance,
            targetDistance
          );

          return { poi: p, score, distance: distToPoint };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => b.score - a.score);

      if (candidates.length === 0) break;

      const best = candidates[0];
      const distToPOI = best.distance * roadFactor;
      const distBackToOrigin = haversineDistance(best.poi.location, origin) * roadFactor;

      // Check if adding this POI keeps us within target distance (with buffer)
      if (cumulativeDistance + distToPOI + distBackToOrigin > targetDistance * 1.15) {
        break;
      }

      waypoints.push(best.poi.location);
      poiIds.push(best.poi.id);
      used.add(best.poi.id);
      usedTypes.add(best.poi.type);
      cumulativeDistance += distToPOI;
    }

    // Close loop for walk routes
    if (routeType === ROUTE_MODE.WALK && waypoints.length > 1) {
      waypoints.push(origin);
    }

    return {
      waypoints,
      poiIds,
      strategy: routeStrategy,
    };
  }

  /**
   * Score a POI for route inclusion using AI-guided weights.
   * 
   * Combines multiple factors:
   * - POI intrinsic quality (composite score)
   * - Distance efficiency
   * - Type match with AI priorities
   * - Diversity bonus
   * - Distance budget remaining
   */
  private scorePOIForRoute(
    poi: RankedPOI,
    currentPoint: LatLng,
    origin: LatLng,
    strategy: OptimizationStrategy,
    weights: NearestNeighborWeights,
    usedTypes: Set<POIType>,
    cumulativeDistance: number,
    targetDistance: number
  ): number {
    // Base score from POI quality
    let score = poi.score.composite * weights.scoreWeight;

    // Distance factor (closer is better, but not too much weight)
    const distToPoint = haversineDistance(currentPoint, poi.location);
    const distScore = Math.max(0, 10 - (distToPoint / 100));  // Normalize to 0-10
    score += distScore * weights.distanceWeight;

    // Type match with AI priorities (this is the AI guidance!)
    const typePriority = strategy.poiPriorities[poi.type] || 1.0;
    score += typePriority * 5 * weights.typeWeight;

    // Diversity bonus for new POI types
    if (!usedTypes.has(poi.type)) {
      score += weights.diversityBonus * 3;
    }

    // Budget remaining factor (prefer POIs that fit well in remaining distance)
    const remainingBudget = targetDistance - cumulativeDistance;
    const distBackToOrigin = haversineDistance(poi.location, origin);
    const totalDistNeeded = (distToPoint + distBackToOrigin) * 1.7;

    if (totalDistNeeded < remainingBudget * 0.5) {
      score += 2;  // Bonus for POIs that leave room for more
    } else if (totalDistNeeded > remainingBudget * 1.2) {
      score -= 5;  // Penalty for POIs that risk exceeding budget
    }

    return score;
  }

  /**
   * Get target distance from preferences (in meters).
   */
  private getTargetDistance(preferences: ParsedPreferences): number {
    const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
    if (distanceConstraint && typeof distanceConstraint.value === 'number') {
      const value = distanceConstraint.value;
      const isKm = distanceConstraint.unit === 'km';
      return isKm ? value * 1000 : value * 1609.34;  // Convert to meters
    }
    return DISTANCE_CONSTANTS.DEFAULT_RADIUS_M * 2;  // Default to 10km
  }

  /**
   * Evaluate a waypoint sequence against preferences and POIs.
   */
  private evaluateRoute(
    route: WaypointSequence,
    preferences: ParsedPreferences,
    pois: RankedPOI[],
    strategy: OptimizationStrategy
  ): EvaluatedRoute {
    const distanceMatch = this.evalDistanceMatch(route, preferences);
    const scenicQuality = this.evalScenic(route, pois);
    const poiSatisfaction = this.evalPOIs(route, pois, strategy);
    const diversity = this.evalDiversity(route, pois);
    const safetyScore = 5;  // Placeholder, real safety computed after validation

    const objectives: Record<string, number> = {
      distance_match: distanceMatch,
      distance_accuracy: distanceMatch,
      scenic_quality: scenicQuality,
      scenic_score: scenicQuality,
      safety_score: safetyScore,
      poi_satisfaction: poiSatisfaction,
      poi_count: poiSatisfaction,
      diversity,
    };

    const composite = this.computeComposite(objectives, preferences);

    return {
      waypoints: route,
      objectives,
      composite,
    };
  }

  /**
   * Evaluate distance accuracy.
   */
  private evalDistanceMatch(route: WaypointSequence, preferences: ParsedPreferences): number {
    const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
    if (!distanceConstraint) return 1.0;

    let totalDistance = 0;
    for (let i = 0; i < route.waypoints.length - 1; i++) {
      totalDistance += haversineDistance(route.waypoints[i], route.waypoints[i + 1]);
    }

    const targetDistance = this.getTargetDistance(preferences);
    if (targetDistance === 0) return 1.0;

    const deviation = Math.abs(totalDistance - targetDistance) / targetDistance;
    return Math.max(0, 1 - deviation) * 10;
  }

  /**
   * Evaluate scenic quality based on POI types.
   */
  private evalScenic(route: WaypointSequence, pois: RankedPOI[]): number {
    if (!route.poiIds || route.poiIds.length === 0) return 5;

    const poiMap = new Map(pois.map(p => [p.id, p]));
    const scenicTypes: Set<POIType> = new Set(['viewpoint', 'park', 'water', 'scenic']);

    let scenicCount = 0;
    let totalScore = 0;

    for (const id of route.poiIds) {
      const poi = poiMap.get(id);
      if (poi) {
        if (scenicTypes.has(poi.type)) {
          scenicCount++;
          totalScore += poi.score.composite * 1.5;
        } else {
          totalScore += poi.score.composite;
        }
      }
    }

    const baseScore = totalScore / Math.max(1, route.poiIds.length);
    const scenicBonus = (scenicCount / Math.max(1, route.poiIds.length)) * 3;

    return Math.min(10, baseScore + scenicBonus);
  }

  /**
   * Evaluate POI satisfaction with AI strategy guidance.
   */
  private evalPOIs(route: WaypointSequence, pois: RankedPOI[], strategy: OptimizationStrategy): number {
    if (!route.poiIds || route.poiIds.length === 0) return 0;

    const poiMap = new Map(pois.map(p => [p.id, p]));
    let score = 0;

    for (const id of route.poiIds) {
      const poi = poiMap.get(id);
      if (poi) {
        // Base score from POI quality
        let poiScore = poi.score.composite;

        // AI priority bonus
        const typePriority = strategy.poiPriorities[poi.type] || 1.0;
        poiScore *= typePriority;

        score += poiScore;
      }
    }

    return Math.min(10, score / Math.max(1, route.poiIds.length) * 1.5);
  }

  /**
   * Evaluate diversity (variety of POI types).
   */
  private evalDiversity(route: WaypointSequence, pois: RankedPOI[]): number {
    if (!route.poiIds || route.poiIds.length === 0) return 0;

    const poiMap = new Map(pois.map(p => [p.id, p]));
    const types = new Set<POIType>();

    for (const id of route.poiIds) {
      const poi = poiMap.get(id);
      if (poi) types.add(poi.type);
    }

    // More unique types = higher diversity score
    const uniqueCount = types.size;
    return Math.min(10, uniqueCount * (10 / 5));  // 5 types = perfect score
  }

  /**
   * Compute composite score from objectives.
   */
  private computeComposite(objectives: Record<string, number>, preferences: ParsedPreferences): number {
    let total = 0;
    let totalWeight = 0;

    for (const objective of preferences.objectives) {
      const value = objectives[objective.metric] || objectives[objective.name] || 5;
      total += value * objective.weight;
      totalWeight += objective.weight;
    }

    return totalWeight > 0 ? total / totalWeight : 7.5;
  }

  /**
   * Assign label based on strategy.
   */
  private assignLabel(route: EvaluatedRoute): string {
    return route.waypoints.strategy || ROUTE_STRATEGIES.BALANCED;
  }
}
