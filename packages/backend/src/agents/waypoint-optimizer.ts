import type { LLMProvider } from '../providers/llm/interface';
import { haversineDistance, ROUTE_STRATEGIES } from '@mappy/shared';
import {
  ROUTE_CONSTANTS,
  DISTANCE_CONSTANTS,
  ROUTE_MODE,
} from '../config/constants';

import type {
  LatLng,
  ParsedPreferences,
  SearchSpace,
  RankedPOI,
  OptimizedRoute,
  EvaluatedRoute,
  WaypointSequence,
  RouteType,
} from '@mappy/shared';

export class WaypointOptimizer {
  private isAdvancedModel: boolean;

  constructor(private llm: LLMProvider, isAdvancedModel: boolean = false) {
    this.isAdvancedModel = isAdvancedModel;
  }

  /**
   * Optimizes waypoints for a given route.
   * 
   * @param origin - The origin of the route.
   * @param preferences - The preferences for the route.
   * @param searchSpace - The search space for the route.
   * @param pois - The POIs for the route.
   * @param numCandidates - The number of candidates to generate.
   * @param numFinalRoutes - The number of final routes to return.
   * @param routeType - The type of route.
   * @returns The optimized routes.
   */
  async optimize(
    origin: LatLng,
    preferences: ParsedPreferences,
    searchSpace: SearchSpace,
    pois: RankedPOI[],
    numCandidates: number = ROUTE_CONSTANTS.MAX_CANDIDATES,
    numFinalRoutes: number = ROUTE_CONSTANTS.FINAL_ROUTES,
    routeType: RouteType = ROUTE_MODE.WALK
  ): Promise<OptimizedRoute[]> {
    const candidates = await this.generateCandidates(
      origin,
      preferences,
      searchSpace,
      pois,
      numCandidates,
      routeType
    );
    const evaluated = candidates.map(candidate =>
      this.evaluateRoute(candidate, preferences, pois)
    );

    const sorted = [...evaluated].sort((a, b) => b.composite - a.composite);
    const selected = sorted.slice(0, numFinalRoutes);

    return selected.map((route, i) => ({
      waypoints: route.waypoints,
      objectives: route.objectives,
      composite: route.composite,
      label: this.assignLabel(route, i),
      explanation: `Route option ${i + 1} with composite score ${route.composite.toFixed(2)}`,
    }));
  }

  /**
   * Generates candidates for a given route.
   * 
   * @param origin - The origin of the route.
   * @param preferences - The preferences for the route.
   * @param searchSpace - The search space for the route.
   * @param pois - The POIs for the route.
   * @param n - The number of candidates to generate.
   * @param routeType - The type of route.
   * @returns The generated candidates.
   */
  private async generateCandidates(
    origin: LatLng,
    preferences: ParsedPreferences,
    searchSpace: SearchSpace,
    pois: RankedPOI[],
    n: number,
    routeType: RouteType
  ): Promise<WaypointSequence[]> {
    const prompt = this.buildGenerationPrompt(origin, preferences, searchSpace, pois, routeType);

    try {
      const result = await this.llm.generateJSON<{
        sequence: Array<{ id?: string; index?: number; lat?: number; lng?: number }>
      }>(prompt, {
        type: 'object',
        properties: {
          sequence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                index: { type: 'number' },
                lat: { type: 'number' },
                lng: { type: 'number' },
              }
            },
            minItems: 3,
            maxItems: 12,
          },
        },
        required: ['sequence'],
      }, {
        systemInstruction: `You are a Senior Route Architect for Mappy.
Goal: Generate a logical sequence of waypoints from the provided POIs.
- Prefer using "index" (0-based position in the list) — e.g. {"index": 0}, {"index": 5}. This is more reliable than copying long IDs.
- You may use "id" only if you copy the exact ID string from the list.
- Ensure the route is varied and matches the distance target.
- For Loop routes, ensure the path curves back towards the start.`,
        thinking: true,
        grounding: true,
      });

      if (!result.sequence || !Array.isArray(result.sequence)) {
        throw new Error('Invalid LLM response: missing sequence');
      }

      const sequence = this.resolveSequence(result.sequence, pois, origin);

      if (sequence.waypoints.length < 2) {
        throw new Error('LLM sequence resolved to fewer than 2 waypoints');
      }

      const strategies = Object.values(ROUTE_STRATEGIES);
      const numStrategies = Math.min(n, strategies.length);
      const candidates: WaypointSequence[] = [{
        waypoints: sequence.waypoints,
        poiIds: sequence.poiIds,
        strategy: strategies[0],
      }];

      for (let i = 1; i < numStrategies; i++) {
        const variation = this.createVariation(sequence.waypoints, searchSpace, routeType, origin);
        if (variation.length >= 2) {
          candidates.push({
            waypoints: variation,
            poiIds: sequence.poiIds,
            strategy: strategies[i],
          });
        }
      }

      if (candidates.length === 0) {
        throw new Error('No valid candidates after filtering');
      }

      return candidates;
    } catch (error) {
      console.warn('POI-centric generation failed, using greedy fallback:', error);
      return this.greedyGenerate(origin, preferences, searchSpace, pois, n);
    }
  }

  /**
   * Resolves a sequence of waypoints from raw LLM output (index, id, or lat/lng).
   * Index-based refs (0-based) are more reliable for small models than copying long IDs.
   */
  private resolveSequence(
    raw: Array<{ id?: string; index?: number; lat?: number; lng?: number }>,
    pois: RankedPOI[],
    origin: LatLng
  ): { waypoints: LatLng[]; poiIds: string[] } {
    const waypoints: LatLng[] = [origin];
    const poiIds: string[] = [];

    for (const item of raw) {
      let poi: RankedPOI | undefined;

      if (typeof item.index === 'number' && item.index >= 0 && item.index < pois.length) {
        poi = pois[item.index];
      } else if (item.id) {
        poi = pois.find(p => p.id === item.id);
      }

      if (poi) {
        waypoints.push(poi.location);
        poiIds.push(poi.id);
      } else if (item.lat !== undefined && item.lng !== undefined) {
        waypoints.push({ lat: item.lat, lng: item.lng });
      }
    }

    return { waypoints, poiIds };
  }

  /**
   * Builds the generation prompt for a given route.
   * 
   * @param origin - The origin of the route.
   * @param preferences - The preferences for the route.
   * @param searchSpace - The search space for the route.
   * @param pois - The POIs for the route.
   * @param routeType - The type of route.
   * @returns The generation prompt.
   */
  private buildGenerationPrompt(
    origin: LatLng,
    preferences: ParsedPreferences,
    _searchSpace: SearchSpace,
    pois: RankedPOI[],
    routeType: RouteType
  ): string {
    const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
    let targetMiles: number;
    if (distanceConstraint && typeof distanceConstraint.value === 'number' && !Number.isNaN(distanceConstraint.value)) {
      const raw = distanceConstraint.value;
      const isKm = distanceConstraint.unit === 'km' || (distanceConstraint.unit && distanceConstraint.unit.toLowerCase().startsWith('k'));
      targetMiles = isKm ? raw * 0.621371 : raw;
    } else {
      targetMiles = DISTANCE_CONSTANTS.DEFAULT_DISTANCE_MILES;
    }

    if (this.isAdvancedModel) {
      return this.buildRichPrompt(origin, targetMiles, routeType, pois);
    } else {
      return this.buildSimplePrompt(origin, targetMiles, routeType, pois);
    }
  }

  /**
   * Builds the rich prompt for a given route.
   * 
   * @param origin - The origin of the route.
   * @param targetMiles - The target miles for the route.
   * @param routeType - The type of route.
   * @param pois - The POIs for the route.
   * @returns The rich prompt.
   */
  private buildRichPrompt(
    origin: LatLng,
    targetMiles: number,
    routeType: RouteType,
    pois: RankedPOI[]
  ): string {
    const isLoop = routeType === ROUTE_MODE.WALK;
    const limit = ROUTE_CONSTANTS.MAX_POIS_IN_PROMPT_RICH;
    const poisList = pois.slice(0, limit);
    const poiContext = poisList.map((p, i) =>
      `${i}: [id: ${p.id}] ${p.name} (${p.type}, Rating: ${p.rating ?? 'N/A'}) at ${p.location.lat.toFixed(5)}, ${p.location.lng.toFixed(5)}`
    ).join('\n');

    return `STARTING LOCATION: ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}

AVAILABLE POIs. You may refer to each by "index" (0, 1, 2, ...) or by "id" (exact string below):
${poiContext}

TASK:
1. Create a ${isLoop ? 'Loop (Walk/Jog)' : 'Point-to-Point (Explore)'} route of ~${targetMiles} miles.
2. Pick 5-8 POIs and put them in a logical order. Use "index" (number) or "id" (string) for each.
3. ${isLoop ? 'End near the start (loop back).' : 'Progress logically through the area.'}

RESPONSE FORMAT (JSON ONLY). Example with index: {"sequence": [{"index": 0}, {"index": 5}]}. Or use "id" with exact ID string.
{
  "sequence": [
    {"index": 0},
    {"index": 5},
    {"index": 2}
  ]
}`;
  }

  /**
   * Builds the simple prompt for a given route.
   * 
   * @param origin - The origin of the route.
   * @param targetMiles - The target miles for the route.
   * @param routeType - The type of route.
   * @param pois - The POIs for the route.
   * @returns The simple prompt.
   */
  private buildSimplePrompt(
    origin: LatLng,
    targetMiles: number,
    routeType: RouteType,
    pois: RankedPOI[]
  ): string {
    const isLoop = routeType === ROUTE_MODE.WALK;
    const poisList = pois.slice(0, ROUTE_CONSTANTS.MAX_POIS_IN_PROMPT_SIMPLE);
    const poiListStr = poisList.map((p, i) => `${i}: ${p.name} (${p.type})`).join(', ');

    return `Create a ${targetMiles} mile ${isLoop ? 'loop' : 'trip'} from ${origin.lat}, ${origin.lng}.
POIs by index: ${poiListStr}
Return JSON with "index" (number) for each POI, e.g. {"sequence": [{"index": 0}, {"index": 2}]}`;
  }

  /**
   * Filters waypoints to ensure they are within the search space.
   * 
   * @param waypoints - The waypoints to filter.
   * @param searchSpace - The search space to filter the waypoints within.
   * @returns The filtered waypoints.
   */
  private filterWaypointsInBounds(waypoints: LatLng[], searchSpace: SearchSpace): LatLng[] {
    const bounds = searchSpace.boundary.coordinates[0];
    const minLng = Math.min(...bounds.map(c => c[0]));
    const maxLng = Math.max(...bounds.map(c => c[0]));
    const minLat = Math.min(...bounds.map(c => c[1]));
    const maxLat = Math.max(...bounds.map(c => c[1]));

    return waypoints.filter(wp =>
      wp.lat >= minLat && wp.lat <= maxLat &&
      wp.lng >= minLng && wp.lng <= maxLng
    );
  }

  /**
   * Creates a variation of a given waypoints sequence.
   * 
   * @param waypoints - The waypoints to create a variation of.
   * @param searchSpace - The search space to create a variation within.
   * @param routeType - The type of route.
   * @param origin - The origin of the route.
   * @returns The created variation.
   */
  private createVariation(
    waypoints: LatLng[],
    searchSpace: SearchSpace,
    routeType: RouteType,
    origin?: LatLng
  ): LatLng[] {
    const variation = waypoints.map((wp, i) => {
      if (i === 0) return wp;
      return {
        lat: wp.lat + (Math.random() - 0.5) * DISTANCE_CONSTANTS.WAYPOINT_PERTURBATION_DEG,
        lng: wp.lng + (Math.random() - 0.5) * DISTANCE_CONSTANTS.WAYPOINT_PERTURBATION_DEG,
      };
    });

    const validVariation = this.filterWaypointsInBounds(variation, searchSpace);
    if (routeType === ROUTE_MODE.WALK && origin && validVariation.length > 0) {
      validVariation.push(origin);
    }

    return validVariation;
  }

  /**
   * Generates a greedy route from a given set of POIs.
   * 
   * @param origin - The origin of the route.
   * @param preferences - The preferences for the route.
   * @param searchSpace - The search space for the route.
   * @param pois - The POIs for the route.
   * @param n - The number of candidates to generate.
   * @returns The generated greedy route.
   */
  private greedyGenerate(
    origin: LatLng,
    _preferences: ParsedPreferences,
    _searchSpace: SearchSpace,
    pois: RankedPOI[],
    _n: number
  ): WaypointSequence[] {
    const selectedPOIs = pois.slice(0, ROUTE_CONSTANTS.MAX_POIS_GREEDY);
    const waypoints = [origin, ...selectedPOIs.map(p => p.location), origin];
    const poiIds = selectedPOIs.map(p => p.id);

    return [{
      waypoints,
      poiIds,
      strategy: ROUTE_STRATEGIES.BALANCED,
    }];
  }

  private evaluateRoute(
    route: WaypointSequence,
    preferences: ParsedPreferences,
    pois: RankedPOI[]
  ): EvaluatedRoute {
    const distanceMatch = this.evalDistanceMatch(route, preferences);
    const scenicQuality = this.evalScenic(route, preferences);
    const poiSatisfaction = this.evalPOIs(route, pois);
    const diversity = this.evalDiversity(route, pois);
    // Safety needs route segments (from directions); real safety is computed in orchestrator after validation
    const safetyScore = 5;

    const objectives: Record<string, number> = {
      distance_match: distanceMatch,
      distance_accuracy: distanceMatch,
      distance_deviation: distanceMatch,
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

  private evalDistanceMatch(route: WaypointSequence, preferences: ParsedPreferences): number {
    const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
    if (!distanceConstraint) return 1.0;

    let totalDistance = 0;
    for (let i = 0; i < route.waypoints.length - 1; i++) {
      totalDistance += haversineDistance(route.waypoints[i], route.waypoints[i + 1]);
    }

    const targetDistance = typeof distanceConstraint.value === 'number'
      ? (distanceConstraint.unit === 'km' ? distanceConstraint.value * 1000 : distanceConstraint.value * 1609.34)
      : DISTANCE_CONSTANTS.DEFAULT_RADIUS_M;

    if (targetDistance === 0) return 1.0;

    const deviation = Math.abs(totalDistance - targetDistance) / targetDistance;
    return Math.max(0, 1 - deviation);
  }

  private evalScenic(_route: WaypointSequence, preferences: ParsedPreferences): number {
    const scenicWeight = preferences.constraints.soft.find(c => c.type === 'scenic')?.weight || 0.5;
    return scenicWeight * 10;
  }

  private evalPOIs(route: WaypointSequence, pois: RankedPOI[]): number {
    if (!route.poiIds?.length) return 0;
    const byId = new Map(pois.map((p) => [p.id, p]));
    let score = 0;
    for (const id of route.poiIds) {
      const poi = byId.get(id);
      if (poi?.score?.composite != null) {
        score += poi.score.composite;
      } else {
        score += 1.5;
      }
    }
    return Math.min(10, score);
  }

  /** Diversity: variety of POI types in the route (more types = higher score). */
  private evalDiversity(route: WaypointSequence, pois: RankedPOI[]): number {
    if (!route.poiIds?.length) return 0;
    const byId = new Map(pois.map((p) => [p.id, p]));
    const types = new Set<string>();
    for (const id of route.poiIds) {
      const poi = byId.get(id);
      if (poi?.type) types.add(poi.type);
    }
    // 0–6+ unique types → scale to 0–10 (e.g. 1 type ≈ 1.5, 4 types ≈ 6.5, 6+ ≈ 10)
    const uniqueCount = types.size;
    return Math.min(10, uniqueCount * (10 / 6));
  }

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

  private assignLabel(_route: EvaluatedRoute, index: number): string {
    const labels = Object.values(ROUTE_STRATEGIES);
    return labels[index] || ROUTE_STRATEGIES.BALANCED;
  }
}
