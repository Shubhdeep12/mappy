import { ROUTE_MODE, ACTIVITY_TYPE } from '@mappy/shared';

export const ROUTE_CONSTANTS = {
  /** Minimum number of waypoints required for a valid route */
  MIN_WAYPOINTS: 2,

  /** Maximum number of route candidates to generate */
  MAX_CANDIDATES: 10,

  /** Number of final routes to return to user */
  FINAL_ROUTES: 3,

  /** Maximum number of POIs to include in route response */
  MAX_POIS_IN_RESPONSE: 5,

  /** Minimum waypoints for LLM generation */
  MIN_WAYPOINTS_FOR_LLM: 8,

  /** Maximum waypoints for LLM generation */
  MAX_WAYPOINTS_FOR_LLM: 10,

  /** Max POIs discovered and passed to algorithmic optimizer (increased since we use algorithm now, not LLM prompts) */
  MAX_POIS_DISCOVERED: 100,
} as const;

export const DISTANCE_CONSTANTS = {
  /** Default route radius in meters (5km) */
  DEFAULT_RADIUS_M: 5000,

  /** Default route distance in miles */
  DEFAULT_DISTANCE_MILES: 5,

  /** Distance tolerance for route validation (±35% - accounts for road detours vs straight-line estimates) */
  DISTANCE_TOLERANCE: 0.35,

  /** Minimum spacing between POIs in meters */
  MIN_POI_SPACING_M: 200,

  /** Maximum distance from route to consider POI "nearby" in meters */
  POI_NEARBY_THRESHOLD_M: 500,

  /** Maximum distance from origin for loop closure in meters */
  LOOP_CLOSURE_THRESHOLD_M: 100,

  /** Maximum distance for waypoint perturbation in degrees (~500m) */
  WAYPOINT_PERTURBATION_DEG: 0.01,

  /** Maximum distance for cell connectivity in meters */
  CELL_CONNECTIVITY_THRESHOLD_M: 200,
} as const;

export const SPATIAL_CONSTANTS = {
  /** Grid resolution for small routes (< 2km) in meters */
  GRID_RESOLUTION_SMALL_M: 50,

  /** Grid resolution for medium routes (2-5km) in meters */
  GRID_RESOLUTION_MEDIUM_M: 100,

  /** Grid resolution for large routes (> 5km) in meters */
  GRID_RESOLUTION_LARGE_M: 200,

  /** Small route threshold in meters */
  SMALL_ROUTE_THRESHOLD_M: 2000,

  /** Medium route threshold in meters */
  MEDIUM_ROUTE_THRESHOLD_M: 5000,

  /** Meters per degree latitude (approximate) */
  METERS_PER_DEGREE_LAT: 111000,
} as const;

export const SCORING_CONSTANTS = {
  /** Default scenic score when no segments available */
  DEFAULT_SCENIC_SCORE: 7,

  /** Default safety score when no segments available */
  DEFAULT_SAFETY_SCORE: 8,

  /** Default POI satisfaction score */
  DEFAULT_POI_SATISFACTION: 5,

  /** POI satisfaction multiplier (per POI) */
  POI_SATISFACTION_MULTIPLIER: 2,

  /** Maximum POI satisfaction score */
  MAX_POI_SATISFACTION: 10,
} as const;

export const VALIDATION_CONSTANTS = {
  /** Maximum retry attempts for route validation */
  MAX_VALIDATION_RETRIES: 3,

  /** Minimum elevation gain threshold (meters) */
  MIN_ELEVATION_GAIN_M: 0,
} as const;

export const QUALITY_CONSTANTS = {
  /** Minimum composite score for route to be included (lowered for local/dev environments) */
  MIN_COMPOSITE_SCORE: 2.0,

  /** Minimum score for at least one key metric (scenic, safety, or POI) */
  MIN_KEY_METRIC_SCORE: 7.0,

  /** Minimum distance accuracy score */
  MIN_DISTANCE_ACCURACY: 0.7,

  /** If key metric is excellent (>= 8.5), allow lower composite scores */
  EXCELLENT_KEY_METRIC_THRESHOLD: 8.5,

  /** Minimum composite score when key metric is excellent */
  MIN_COMPOSITE_WITH_EXCELLENT_KEY_METRIC: 1.5,
} as const;

export { ROUTE_MODE, ACTIVITY_TYPE };
