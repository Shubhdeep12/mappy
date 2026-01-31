/**
 * Route Orchestrator Service
 * 
 * Coordinates all agents in the route generation pipeline.
 * Implements event-driven coordination with error handling and retries.
 */

import type { LLMProvider } from '../providers/llm/interface';
import type { MapsProvider } from '../providers/maps/interface';
import { PreferenceParser } from '../agents/preference-parser';
import { SpatialReasoner } from '../agents/spatial-reasoner';
import { POIDiscoverer } from '../agents/poi-discoverer';
import { WaypointOptimizer } from '../agents/waypoint-optimizer';
import { RouteValidator } from '../agents/route-validator';
import { RouteEvaluator } from '../agents/route-evaluator';
import { MapsExporter } from './maps-exporter';
import {
  haversineDistance,
  calculateElevationGain,
} from '@mappy/shared';
import {
  ROUTE_CONSTANTS,
  DISTANCE_CONSTANTS,
  QUALITY_CONSTANTS,
  ACTIVITY_TYPE,
  ROUTE_MODE,
} from '../config/constants';
import {
  PreferencePill,
  LocationInput,
  ContextMetadata,
  GeneratedRoute,
  RankedPOI,
  OptimizedRoute,
  Route,
  RouteMetadata,
  LatLng,
  ROUTE_STRATEGIES,
  ActivityType,
} from '@mappy/shared';

export class RouteOrchestrator {
  private preferenceParser: PreferenceParser;
  private spatialReasoner: SpatialReasoner;
  private poiDiscoverer: POIDiscoverer;
  private waypointOptimizer: WaypointOptimizer;
  private routeValidator: RouteValidator;
  private routeEvaluator: RouteEvaluator;
  private mapsExporter: MapsExporter;
  private maps: MapsProvider;

  constructor(llm: LLMProvider, maps: MapsProvider, isAdvancedModel: boolean = false) {
    this.maps = maps;
    this.preferenceParser = new PreferenceParser(llm);
    this.spatialReasoner = new SpatialReasoner();
    this.poiDiscoverer = new POIDiscoverer(maps);
    this.waypointOptimizer = new WaypointOptimizer(llm, isAdvancedModel);
    this.routeValidator = new RouteValidator(maps);
    this.routeEvaluator = new RouteEvaluator(llm);
    this.mapsExporter = new MapsExporter();
  }

  /**
   * Generate routes from user preferences, location, and context.
   * @param preferences - User preferences (e.g. "5 mile scenic walk")
   * @param location - User's starting location (address, coordinates, or current location)
   * @param context - Additional context (e.g. route type, activity type, time of day, weather, device type)
   * @returns Array of generated routes
   */
  async generateRoute(
    preferences: PreferencePill[],
    location: LocationInput,
    context?: ContextMetadata
  ): Promise<GeneratedRoute[]> {
    // Step 1: Resolve location to coordinates
    const origin = await this.resolveLocation(location);

    // Step 2: Parse preferences 
    const parsedPreferences = await this.preferenceParser.parse(preferences, context);

    // Step 3: Compute search space
    const routeType = context?.routeType || ROUTE_MODE.WALK;
    const distanceConstraint = parsedPreferences.constraints.hard.find(c => c.type === 'distance') ?? null;
    const searchSpace = this.spatialReasoner.computeSearchSpace(
      origin,
      distanceConstraint,
      routeType
    );

    // Step 4: Discover POIs
    const bounds = {
      north: searchSpace.boundary.coordinates[0][2][1],
      south: searchSpace.boundary.coordinates[0][0][1],
      east: searchSpace.boundary.coordinates[0][1][0],
      west: searchSpace.boundary.coordinates[0][0][0],
    };
    const pois = await this.poiDiscoverer.discoverPOIs(
      bounds,
      parsedPreferences,
      ROUTE_CONSTANTS.MAX_POIS_DISCOVERED
    );

    // Step 5: Optimize waypoints
    const optimizedRoutes = await this.waypointOptimizer.optimize(
      origin,
      parsedPreferences,
      searchSpace,
      pois,
      ROUTE_CONSTANTS.MAX_CANDIDATES,
      ROUTE_CONSTANTS.FINAL_ROUTES,
      routeType
    );


    // Step 6: Validate ALL routes first (Maps API only, no LLM calls)
    interface ValidatedCandidate {
      id: string;
      optimized: OptimizedRoute;
      route: Route;
      metadata: RouteMetadata;
      waypoints: LatLng[];
      nearbyPOIs: RankedPOI[];
      activity: ActivityType;
    }
    const validatedCandidates: ValidatedCandidate[] = [];

    for (const optimized of optimizedRoutes) {
      if (optimized.waypoints.waypoints.length === 0) {
        console.warn('Skipping route with no waypoints');
        continue;
      }

      if (optimized.waypoints.waypoints.length < ROUTE_CONSTANTS.MIN_WAYPOINTS) {
        console.warn(`Skipping route with less than ${ROUTE_CONSTANTS.MIN_WAYPOINTS} waypoints:`, optimized.waypoints.waypoints.length);
        continue;
      }

      try {
        const activity = context?.userActivity || ACTIVITY_TYPE.WALKING;
        const validation = await this.routeValidator.validateRoute(
          optimized.waypoints.waypoints,
          parsedPreferences,
          activity
        );

        if (validation.valid && validation.directions) {
          const metadata = await this.calculateMetadata(validation.directions, context, origin, optimized);

          // Find POIs near this route
          const routePath = validation.directions.geometry.coordinates;
          const nearbyPOIs = pois.filter(poi => {
            for (const coord of routePath) {
              const distance = haversineDistance(
                { lat: coord[1], lng: coord[0] },
                poi.location
              );
              if (distance < DISTANCE_CONSTANTS.POI_NEARBY_THRESHOLD_M) {
                return true;
              }
            }
            return false;
          });

          validatedCandidates.push({
            id: globalThis.crypto.randomUUID(),
            optimized,
            route: validation.directions,
            metadata,
            waypoints: optimized.waypoints.waypoints,
            nearbyPOIs,
            activity,
          });
        } else {
          console.warn(`Route validation failed: ${validation.error} - ${validation.details}`);
        }
      } catch (error) {
        console.error('Error during route validation:', error instanceof Error ? error.message : String(error));
      }

      if (validatedCandidates.length >= ROUTE_CONSTANTS.FINAL_ROUTES) {
        break;
      }
    }

    if (validatedCandidates.length === 0) {
      throw new Error('Failed to generate any valid routes. Try adjusting your preferences or location.');
    }

    // Step 7: Batch evaluate ALL routes in ONE LLM call (scenic + safety + narrative)
    const routeInputs = validatedCandidates.map(c => ({
      id: c.id,
      route: c.route,
      metadata: c.metadata,
      waypoints: c.waypoints,
      nearbyPOIs: c.nearbyPOIs,
    }));

    const evaluations = await this.routeEvaluator.evaluateRoutes(
      routeInputs,
      parsedPreferences,
      pois
    );

    // Step 8: Build final routes with scores and narratives
    const validatedRoutes: GeneratedRoute[] = [];
    const filteredRoutes: Array<{ route: GeneratedRoute; compositeScore: number; keyMetricScore: number }> = [];

    for (const candidate of validatedCandidates) {
      const evaluation = evaluations.get(candidate.id);
      if (!evaluation) {
        console.warn(`No evaluation found for route ${candidate.id}`);
        continue;
      }

      const { scores, narrative } = evaluation;
      const compositeScore = candidate.optimized.composite;
      const keyMetricScore = Math.max(scores.scenic, scores.safety, scores.poi_satisfaction);
      const distanceAccuracy = scores.distance_accuracy || 0;

      // Quality thresholds
      const hasExcellentKeyMetric = keyMetricScore >= QUALITY_CONSTANTS.EXCELLENT_KEY_METRIC_THRESHOLD;
      const minCompositeRequired = hasExcellentKeyMetric
        ? QUALITY_CONSTANTS.MIN_COMPOSITE_WITH_EXCELLENT_KEY_METRIC
        : QUALITY_CONSTANTS.MIN_COMPOSITE_SCORE;

      const meetsQualityThresholds =
        compositeScore >= minCompositeRequired &&
        (keyMetricScore >= QUALITY_CONSTANTS.MIN_KEY_METRIC_SCORE || compositeScore >= minCompositeRequired + 1.0) &&
        distanceAccuracy >= QUALITY_CONSTANTS.MIN_DISTANCE_ACCURACY;

      const exportData = this.mapsExporter.generateExport(
        candidate.waypoints,
        candidate.activity
      );

      const generatedRoute: GeneratedRoute = {
        id: candidate.id,
        waypoints: candidate.waypoints,
        route: candidate.route,
        metadata: candidate.metadata,
        scores,
        narrative,
        export: exportData,
        pois: candidate.nearbyPOIs.slice(0, ROUTE_CONSTANTS.MAX_POIS_IN_RESPONSE),
        created_at: new Date().toISOString(),
      };

      if (!meetsQualityThresholds) {
        console.warn(`Route filtered: composite=${compositeScore.toFixed(2)}, keyMetric=${keyMetricScore.toFixed(2)}`);
        filteredRoutes.push({ route: generatedRoute, compositeScore, keyMetricScore });
        continue;
      }

      validatedRoutes.push(generatedRoute);
    }

    // Return best routes or fallback
    if (validatedRoutes.length === 0 && filteredRoutes.length > 0) {
      console.warn(`No routes passed quality filter. Using best fallback.`);
      filteredRoutes.sort((a, b) => b.compositeScore - a.compositeScore);
      return [filteredRoutes[0].route];
    }

    if (validatedRoutes.length === 0) {
      throw new Error('Failed to generate any valid routes. Try adjusting your preferences or location.');
    }

    return validatedRoutes;
  }

  private async resolveLocation(location: LocationInput): Promise<LatLng> {
    if (location.coordinates) {
      return location.coordinates;
    }

    if (location.type === 'current') {
      throw new Error('Current location requires coordinates. Please use browser geolocation or provide coordinates.');
    }

    if (location.address) {
      return await this.maps.geocode(location.address);
    }

    throw new Error('Location must have coordinates or address');
  }

  private async calculateMetadata(
    route: Route,
    context: ContextMetadata | undefined,
    origin: LatLng,
    optimizedRoute: OptimizedRoute
  ): Promise<RouteMetadata> {
    const elevationGain = route.elevation
      ? calculateElevationGain(route.elevation)
      : 0;

    const city = await this.inferCity(origin);

    const strategy = optimizedRoute.waypoints.strategy || ROUTE_STRATEGIES.BALANCED;

    const activity = context?.userActivity || ACTIVITY_TYPE.WALKING;

    return {
      distance: route.distance,
      duration: route.duration,
      elevation_gain: elevationGain,
      activity,
      city,
      strategy,
    };
  }

  private async inferCity(location: LatLng): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${location.lat}&lon=${location.lng}&format=json&addressdetails=1`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mappy/1.0',
        },
      });

      if (response.ok) {
        const data = await response.json() as {
          address?: {
            city?: string;
            town?: string;
            village?: string;
            municipality?: string;
            county?: string;
          };
        };

        const address = data.address;
        if (address) {
          return address.city || address.town || address.village || address.municipality || address.county || 'Unknown';
        }
      }
    } catch (error) {
      console.warn('Failed to reverse geocode city:', error);
    }

    return 'Unknown';
  }
}
