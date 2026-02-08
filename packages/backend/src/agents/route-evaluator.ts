/**
 * Route Evaluator - Scores validated routes (scenic, safety, POI satisfaction)
 * using LLM with template-based fallback.
 */


import type { LLMProvider } from '../providers/llm/interface';
import type {
  Route,
  RouteMetadata,
  RouteScores,
  RouteNarrative,
  ParsedPreferences,
  RankedPOI,
  LatLng,
} from '@mappy/shared';
import { haversineDistance, ROUTE_STRATEGIES } from '@mappy/shared';
import { DISTANCE_CONSTANTS, SCORING_CONSTANTS } from '../config/constants';

interface RouteInput {
  id: string;
  route: Route;
  metadata: RouteMetadata;
  waypoints: LatLng[];
  nearbyPOIs: RankedPOI[];
}

interface RouteEvaluation {
  routeId: string;
  scenicScore: number;
  safetyScore: number;
  poiSatisfaction: number;
  summary: string;
  explanation: string;
  highlights: string[];
}

interface EvaluationResult {
  scores: RouteScores;
  narrative: RouteNarrative;
}

export class RouteEvaluator {
  constructor(private llm: LLMProvider) { }

  /**
   * Evaluate all routes in a single LLM call.
   * Returns scores and narrative for each route.
   */
  async evaluateRoutes(
    routes: RouteInput[],
    preferences: ParsedPreferences,
    allPOIs: RankedPOI[]
  ): Promise<Map<string, EvaluationResult>> {
    const results = new Map<string, EvaluationResult>();

    if (routes.length === 0) {
      return results;
    }

    try {
      const evaluations = await this.batchEvaluateWithLLM(routes, preferences, allPOIs);

      for (const evaluation of evaluations) {
        const routeInput = routes.find(r => r.id === evaluation.routeId);
        if (!routeInput) continue;

        // Calculate distance accuracy from route metadata
        const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
        const targetDistance = distanceConstraint && typeof distanceConstraint.value === 'number'
          ? (distanceConstraint.unit === 'km' ? distanceConstraint.value * 1000 : distanceConstraint.value * 1609.34)
          : routeInput.route.distance;

        const distanceAccuracy = targetDistance > 0
          ? Math.max(0, Math.min(1, 1 - Math.abs(routeInput.route.distance - targetDistance) / targetDistance))
          : 1;

        // Calculate composite score
        const composite = this.calculateCompositeScore(
          evaluation.scenicScore,
          evaluation.safetyScore,
          evaluation.poiSatisfaction,
          distanceAccuracy,
          preferences
        );

        results.set(evaluation.routeId, {
          scores: {
            scenic: evaluation.scenicScore,
            safety: evaluation.safetyScore,
            poi_satisfaction: evaluation.poiSatisfaction,
            distance_accuracy: distanceAccuracy,
            composite,
          },
          narrative: {
            summary: evaluation.summary,
            explanation: evaluation.explanation,
            highlights: evaluation.highlights,
          },
        });
      }
    } catch (error) {
      console.warn('LLM batch evaluation failed, using template fallback:', error);
      // Fallback: use template-based scoring for each route
      for (const routeInput of routes) {
        const result = this.templateEvaluation(routeInput, preferences, allPOIs);
        results.set(routeInput.id, result);
      }
    }

    return results;
  }

  /**
   * Single LLM call to evaluate all routes
   */
  private async batchEvaluateWithLLM(
    routes: RouteInput[],
    preferences: ParsedPreferences,
    _allPOIs: RankedPOI[]  // Passed for future use in enhanced context
  ): Promise<RouteEvaluation[]> {
    const routeSummaries = routes.map((r, index) => {
      const distanceMiles = (r.route.distance / 1609.34).toFixed(1);
      const distanceKm = (r.route.distance / 1000).toFixed(1);

      // Find POIs near this route
      const nearbyPOINames = r.nearbyPOIs.slice(0, 5).map(p => p.name).join(', ') || 'None';

      // Get summary from route legs
      const routeSteps = r.route.legs?.[0]?.steps || [];
      const roadTypes = routeSteps.slice(0, 10).map(s => s.instruction).join(', ') || 'mixed roads';

      return `
ROUTE ${index + 1} (ID: ${r.id}):
- Distance: ${distanceMiles} mi (${distanceKm} km)
- Duration: ${Math.round(r.route.duration / 60)} min
- Elevation: ${r.metadata.elevation_gain}m gain
- Strategy: ${r.metadata.strategy}
- Nearby POIs: ${nearbyPOINames}
- Path: ${roadTypes}`;
    }).join('\n');

    // Extract user preference weights
    const scenicWeight = preferences.constraints.soft.find(c => c.type === 'scenic')?.weight || 0.3;
    const safetyWeight = preferences.constraints.soft.find(c => c.type === 'safety')?.weight || 0.3;
    const poiWeight = preferences.constraints.soft.find(c => c.type === 'poi')?.weight || 0.2;

    const prompt = `You are an expert route evaluator. Score and describe ${routes.length} routes based on user preferences.

USER PRIORITIES:
- Scenic importance: ${(scenicWeight * 100).toFixed(0)}%
- Safety importance: ${(safetyWeight * 100).toFixed(0)}%
- POI/destinations: ${(poiWeight * 100).toFixed(0)}%

ROUTES TO EVALUATE:
${routeSummaries}

For EACH route, provide:
1. scenicScore (0-10): Visual appeal, greenery, views, aesthetics
2. safetyScore (0-10): Pedestrian safety, lighting, traffic, infrastructure
3. poiSatisfaction (0-10): How well it matches requested POIs/destinations
4. summary: One compelling sentence (15-20 words)
5. explanation: 2-3 sentences highlighting what makes this route special
6. highlights: 3-5 bullet points of key features

Be honest and differentiated - don't give all routes the same scores.`;

    const schema = {
      type: 'object',
      properties: {
        evaluations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              routeId: { type: 'string' },
              scenicScore: { type: 'number' },
              safetyScore: { type: 'number' },
              poiSatisfaction: { type: 'number' },
              summary: { type: 'string' },
              explanation: { type: 'string' },
              highlights: { type: 'array', items: { type: 'string' } },
            },
            required: ['routeId', 'scenicScore', 'safetyScore', 'poiSatisfaction', 'summary', 'explanation', 'highlights'],
          },
        },
      },
      required: ['evaluations'],
    };

    console.log('[RouteEvaluator] Sending evaluation request to LLM...');
    const result = await this.llm.generateJSON<any>(prompt, schema, {
      temperature: 0.3,  // Lower temperature for consistent structured output
      maxTokens: 4096,
    });
    console.log('[RouteEvaluator] LLM response received:', JSON.stringify(result).slice(0, 200) + '...');

    // Handle multiple response formats from LLM
    let evaluationsArray: any[] = [];

    if (Array.isArray(result?.evaluations)) {
      evaluationsArray = result.evaluations;
    } else if (Array.isArray(result?.routes)) {
      evaluationsArray = result.routes;
    } else if (result && typeof result === 'object') {
      // Handle route1, route2, route3 format
      const keys = Object.keys(result).filter(k => k.match(/^route\d+$/i));
      if (keys.length > 0) {
        evaluationsArray = keys.map((key, index) => ({
          ...result[key],
          routeId: routes[index]?.id || '',  // Map to actual route IDs
        }));
      }
    }

    if (evaluationsArray.length === 0) {
      console.warn('[RouteEvaluator] Could not extract evaluations from LLM response:', result);
      throw new Error('LLM returned invalid or empty evaluations');
    }

    // Normalize and validate all scores - handle both routeId and route_id
    return evaluationsArray.map((evaluation: any, index: number) => ({
      routeId: evaluation.routeId || evaluation.route_id || routes[index]?.id || '',
      scenicScore: this.clampScore(evaluation.scenicScore),
      safetyScore: this.clampScore(evaluation.safetyScore),
      poiSatisfaction: this.clampScore(evaluation.poiSatisfaction),
      summary: evaluation.summary || '',
      explanation: evaluation.explanation || '',
      highlights: Array.isArray(evaluation.highlights) ? evaluation.highlights.slice(0, 5) : [],
    }));
  }

  /**
   * Template fallback for when LLM fails
   */
  private templateEvaluation(
    routeInput: RouteInput,
    preferences: ParsedPreferences,
    allPOIs: RankedPOI[]
  ): EvaluationResult {
    const { route, metadata, nearbyPOIs } = routeInput;

    // Simple heuristic scoring
    const scenicScore = this.templateScenicScore(metadata);
    const safetyScore = this.templateSafetyScore(metadata);
    const poiSatisfaction = this.templatePOISatisfaction(route, allPOIs);

    const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
    const targetDistance = distanceConstraint && typeof distanceConstraint.value === 'number'
      ? (distanceConstraint.unit === 'km' ? distanceConstraint.value * 1000 : distanceConstraint.value * 1609.34)
      : route.distance;

    const distanceAccuracy = targetDistance > 0
      ? Math.max(0, Math.min(1, 1 - Math.abs(route.distance - targetDistance) / targetDistance))
      : 1;

    const composite = this.calculateCompositeScore(
      scenicScore,
      safetyScore,
      poiSatisfaction,
      distanceAccuracy,
      preferences
    );

    const distanceMiles = (route.distance / 1609.34).toFixed(1);
    const distanceKm = (route.distance / 1000).toFixed(1);

    // Generate intelligent narrative with POI names
    const narrative = this.generateTemplateNarrative(
      metadata,
      distanceMiles,
      distanceKm,
      nearbyPOIs,
      preferences
    );

    return {
      scores: {
        scenic: scenicScore,
        safety: safetyScore,
        poi_satisfaction: poiSatisfaction,
        distance_accuracy: distanceAccuracy,
        composite,
      },
      narrative,
    };
  }

  /**
   * Generate intelligent template narrative with POI names and details.
   */
  private generateTemplateNarrative(
    metadata: RouteMetadata,
    distanceMiles: string,
    distanceKm: string,
    nearbyPOIs: RankedPOI[],
    _preferences: ParsedPreferences
  ): RouteNarrative {
    // Get top POIs by score
    const topPOIs = nearbyPOIs
      .sort((a, b) => b.score.composite - a.score.composite)
      .slice(0, 4);

    // Extract POI types and names
    const poiTypes = new Map<string, number>();
    for (const poi of nearbyPOIs) {
      poiTypes.set(poi.type, (poiTypes.get(poi.type) || 0) + 1);
    }

    // Build summary based on strategy
    let summary = '';
    const strategyDescriptors: Record<string, string> = {
      [ROUTE_STRATEGIES.SCENIC]: 'picturesque',
      [ROUTE_STRATEGIES.BALANCED]: 'well-rounded',
      [ROUTE_STRATEGIES.ADVENTUROUS]: 'exploratory',
      [ROUTE_STRATEGIES.SAFE]: 'comfortable',
    };

    const descriptor = strategyDescriptors[metadata.strategy] || 'enjoyable';

    if (topPOIs.length >= 3) {
      const poiNames = topPOIs.slice(0, 3).map(p => p.name).join(', ');
      summary = `A ${descriptor} ${distanceMiles}-mile ${metadata.activity} route featuring ${poiNames}`;
    } else if (topPOIs.length > 0) {
      summary = `A ${descriptor} ${distanceMiles}-mile ${metadata.activity} route including ${topPOIs.map(p => p.name).join(' and ')}`;
    } else {
      summary = `A ${descriptor} ${distanceMiles}-mile ${metadata.strategy} ${metadata.activity} route`;
    }

    // Build explanation with POI type summary
    const typeSummary = Array.from(poiTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    const explanation = topPOIs.length > 0
      ? `This ${metadata.strategy} route covers ${distanceKm} km and passes ${typeSummary}. ${metadata.elevation_gain > 50 ? `Includes ${metadata.elevation_gain}m elevation gain for varied terrain.` : 'Mostly flat terrain for easy navigation.'}`
      : `A ${metadata.strategy} route covering ${distanceKm} km with ${metadata.elevation_gain}m elevation gain.`;

    // Build highlights
    const highlights: string[] = [];

    // Add distance and elevation
    highlights.push(`${distanceMiles} miles (${distanceKm} km) total distance`);

    if (metadata.elevation_gain > 50) {
      highlights.push(`${metadata.elevation_gain}m elevation gain`);
    } else {
      highlights.push('Mostly flat, easy terrain');
    }

    // Add top POIs by name
    for (const poi of topPOIs.slice(0, 3)) {
      highlights.push(`Passes ${poi.name}`);
    }

    // Add POI type diversity
    if (poiTypes.size >= 3) {
      highlights.push(`Diverse mix of ${poiTypes.size} POI types`);
    }

    return {
      summary,
      explanation,
      highlights,
    };
  }

  private templateScenicScore(metadata: RouteMetadata): number {
    const strategyScores: Record<string, number> = {
      [ROUTE_STRATEGIES.SCENIC]: 8.0,
      [ROUTE_STRATEGIES.BALANCED]: 6.5,
      [ROUTE_STRATEGIES.SAFE]: 5.5,
      [ROUTE_STRATEGIES.ADVENTUROUS]: 7.0,
    };
    return strategyScores[metadata.strategy] ?? 6.0;
  }

  private templateSafetyScore(metadata: RouteMetadata): number {
    const strategyScores: Record<string, number> = {
      [ROUTE_STRATEGIES.SAFE]: 8.5,
      [ROUTE_STRATEGIES.BALANCED]: 7.0,
      [ROUTE_STRATEGIES.SCENIC]: 6.5,
      [ROUTE_STRATEGIES.ADVENTUROUS]: 5.5,
    };
    return strategyScores[metadata.strategy] ?? 6.5;
  }

  private templatePOISatisfaction(route: Route, pois: RankedPOI[]): number {
    let nearbyPOIs = 0;
    const routePath = route.geometry.coordinates;
    const seenPOIs = new Set<string>();

    for (const coord of routePath) {
      for (const poi of pois) {
        if (seenPOIs.has(poi.id)) continue;

        const distance = haversineDistance(
          { lat: coord[1], lng: coord[0] },
          poi.location
        );
        if (distance < DISTANCE_CONSTANTS.POI_NEARBY_THRESHOLD_M) {
          nearbyPOIs++;
          seenPOIs.add(poi.id);
        }
      }
    }

    return Math.min(
      SCORING_CONSTANTS.MAX_POI_SATISFACTION,
      nearbyPOIs * SCORING_CONSTANTS.POI_SATISFACTION_MULTIPLIER
    );
  }

  private calculateCompositeScore(
    scenic: number,
    safety: number,
    poiSatisfaction: number,
    distanceAccuracy: number,
    preferences: ParsedPreferences
  ): number {
    // Get importance weights (these are user preferences 0-1, NOT normalized)
    const scenicImportance = preferences.constraints.soft.find(c => c.type === 'scenic')?.weight || 0.3;
    const safetyImportance = preferences.constraints.soft.find(c => c.type === 'safety')?.weight || 0.3;
    const poiImportance = preferences.constraints.soft.find(c => c.type === 'poi')?.weight || 0.2;
    const distanceImportance = 0.2; // Fixed weight for distance accuracy

    // Normalize weights so they sum to 1.0
    const totalWeight = scenicImportance + safetyImportance + poiImportance + distanceImportance;
    const scenicWeight = scenicImportance / totalWeight;
    const safetyWeight = safetyImportance / totalWeight;
    const poiWeight = poiImportance / totalWeight;
    const distanceWeight = distanceImportance / totalWeight;

    // All scores normalized to 0-1 for consistent weighting
    const scenicNorm = scenic / 10;
    const safetyNorm = safety / 10;
    const poiNorm = poiSatisfaction / 10;
    const distanceNorm = distanceAccuracy; // Already 0-1

    // Weighted average (0-1), then scale back to 0-10
    const composite = (
      scenicNorm * scenicWeight +
      safetyNorm * safetyWeight +
      poiNorm * poiWeight +
      distanceNorm * distanceWeight
    ) * 10;

    return Math.round(composite * 10) / 10;
  }

  private clampScore(value: number): number {
    if (typeof value !== 'number' || isNaN(value)) {
      return 5;
    }
    return Math.round(Math.max(0, Math.min(10, value)) * 10) / 10;
  }
}
