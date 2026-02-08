/**
 * Core type definitions for Mappy (routes, preferences, POIs, locations, scoring)
 */


export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GeoFence {
  type: 'polygon' | 'circle';
  coordinates: LatLng[] | { center: LatLng; radius: number };
}

import { ROUTE_MODE, ACTIVITY_TYPE } from '../constants';

export const ROUTE_STRATEGIES = {
  SCENIC: 'scenic' as const,
  BALANCED: 'balanced' as const,
  SAFE: 'safe' as const,
  ADVENTUROUS: 'adventurous' as const,
} as const;

export type ActivityType = typeof ACTIVITY_TYPE[keyof typeof ACTIVITY_TYPE];
export type TravelMode = ActivityType;
export type RouteType = typeof ROUTE_MODE[keyof typeof ROUTE_MODE];
export type POIType =
  | 'cafe'
  | 'park'
  | 'viewpoint'
  | 'restaurant'
  | 'water'
  | 'scenic'
  | 'historical'
  | 'nature'      // forests, trails, gardens
  | 'landmark'    // monuments, statues, significant buildings
  | 'shopping'    // markets, shops, malls
  | 'entertainment' // theaters, museums, attractions
  | 'other';      // catch-all for dynamic LLM types
export type RouteStrategy = typeof ROUTE_STRATEGIES[keyof typeof ROUTE_STRATEGIES];
export type PillCategory = 'distance' | 'scenic' | 'poi' | 'safety' | 'terrain' | 'time';

export interface PreferencePill {
  text: string;
}

export interface LocationInput {
  type: 'current' | 'custom';
  coordinates?: LatLng;
  address?: string;
}

export type DistanceUnit = 'miles' | 'km';

export interface ContextMetadata {
  routeType?: RouteType; // 'walk' for closed loop, 'explore' for point-to-point
  preferredDistanceUnit?: DistanceUnit; // how to display/interpret distance (miles vs km)
  timeOfDay?: TimeWindow;
  weather?: WeatherCondition;
  userActivity?: ActivityType;
  deviceType?: DeviceType;
}

export interface TimeWindow {
  start: string; // ISO8601
  end: string; // ISO8601
}

export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'unknown';
export type DeviceType = 'mobile' | 'desktop' | 'tablet';

export interface HardConstraint {
  type: 'distance' | 'time' | 'elevation' | 'boundary';
  value: number | Range | GeoFence;
  unit: string;
  source: string; // which pill generated this
}

export interface SoftConstraint {
  type: 'scenic' | 'safety' | 'poi' | 'surface';
  weight: number; // 0-1
  preferences: Record<string, number>;
  negotiable: boolean;
}

export interface Range {
  min: number;
  max: number;
}

export interface Objective {
  name: string;
  weight: number;
  metric: string;
  direction: 'maximize' | 'minimize';
}

export interface Interpretation {
  scenario: string;
  probability: number;
  constraints: (HardConstraint | SoftConstraint)[];
}

export interface Ambiguity {
  field: string;
  possibleValues: string[];
  confidence: number;
}

export interface ConfidenceScore {
  overall: number; // 0-1
  byField: Record<string, number>;
}

export interface SpecificPlace {
  name: string;
  type?: POIType; // Optional inferred type
  priority?: number; // How important (1-10)
}

export interface ParsedPreferences {
  constraints: {
    hard: HardConstraint[];
    soft: SoftConstraint[];
  };
  objectives: Objective[];
  interpretations: Interpretation[];
  confidence: ConfidenceScore;
  ambiguities: Ambiguity[];
  specific_places?: SpecificPlace[]; // AI-extracted specific place names
}

export interface POI {
  id: string;
  name: string;
  location: LatLng;
  type: POIType;
  rating?: number;
  metadata?: Record<string, any>;
}

export interface POIScore {
  relevance: number; // match to preferences
  popularity: number; // rating * review_count
  spatialFit: number; // distribution quality
  accessibility: number; // reachability
  temporal: number; // opening hours match
  composite: number; // weighted sum
}

export interface RankedPOI extends POI {
  score: POIScore;
}

export interface RouteSegment {
  path: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance: number; // meters
  duration: number; // seconds
  bearing: number; // degrees
  roadType?: string;
}

export interface ScenicScore {
  greenery: number; // 0-10
  water: number; // 0-10
  openness: number; // 0-10
  aesthetics: number; // 0-10
  composite: number; // 0-10
}

export interface SafetyScore {
  roadType: number; // 0-10 (residential=10, highway=0)
  trafficDensity: number; // 0-10 (low=10, high=0)
  infrastructure: number; // sidewalk, crosswalks
  lighting: number; // time-based inference
  surface: number; // pavement quality
  composite: number; // weighted average
  confidence: number; // data quality indicator
}

export interface SegmentScores {
  scenic: ScenicScore;
  safety: SafetyScore;
}

export interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface RouteLeg {
  distance: number;
  duration: number;
  steps: RouteStep[];
}

export interface Route {
  distance: number; // meters
  duration: number; // seconds
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  legs: RouteLeg[];
  elevation?: number[]; // meters
}

export interface RouteMetadata {
  distance: number; // meters
  duration: number; // seconds
  elevation_gain: number; // meters
  activity: ActivityType;
  city: string;
  strategy: RouteStrategy;
}

export interface RouteScores {
  scenic: number; // 0-10
  safety: number; // 0-10
  poi_satisfaction: number; // 0-10
  distance_accuracy: number; // 0-1
  composite: number; // 0-10
}

export interface RouteNarrative {
  summary: string;
  explanation: string;
  highlights: string[];
}

export interface ExportData {
  maps_url: string;
  deep_links: Record<string, string>;
}

export interface GeneratedRoute {
  id: string;
  waypoints: LatLng[];
  route: Route;
  metadata: RouteMetadata;
  scores: RouteScores;
  narrative: RouteNarrative;
  export: ExportData;
  pois: RankedPOI[];
  created_at: string; // ISO8601
  warnings?: string[]; // User-facing warnings about route generation
  fallbacks_used?: string[]; // Which agents used fallback logic
}

export interface SearchSpace {
  boundary: {
    type: 'Polygon';
    coordinates: [[number, number][]];
  };
  grid: SpatialGrid;
  graph: ReachabilityGraph;
  metadata: {
    area: number; // km²
    cellCount: number;
    avgConnectivity: number;
    topologyType: 'urban' | 'suburban' | 'rural';
  };
}

export interface SpatialGrid {
  cells: GridCell[];
  resolution: number; // meters
  index: any; // RTree (implementation-specific)
}

export interface GridCell {
  id: string;
  center: LatLng;
  bounds: BoundingBox;
  accessible: boolean;
  metadata?: Record<string, any>;
}

export interface ReachabilityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adjacency: Map<string, string[]>;
}

export interface GraphNode {
  id: string;
  location: LatLng;
  cellId: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  distance: number;
  weight: number;
}

export interface WaypointSequence {
  waypoints: LatLng[];
  poiIds?: string[];
  strategy?: RouteStrategy;
}

export interface EvaluatedRoute {
  waypoints: WaypointSequence;
  objectives: Record<string, number>;
  composite: number;
}

export interface OptimizedRoute extends EvaluatedRoute {
  label: string;
  explanation: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
  details?: string;
  directions?: Route;
  metadata?: Record<string, any>;
}

export enum ValidationError {
  CONNECTIVITY_FAILURE = 'CONNECTIVITY_FAILURE',
  DISTANCE_MISMATCH = 'DISTANCE_MISMATCH',
  ELEVATION_EXCEEDED = 'ELEVATION_EXCEEDED',
  TRAVEL_MODE_MISMATCH = 'TRAVEL_MODE_MISMATCH',
  TIMEOUT = 'TIMEOUT',
  API_ERROR = 'API_ERROR'
}

export interface RouteGenerationRequest {
  preferences: PreferencePill[];
  location: LocationInput;
  context?: ContextMetadata;
  requestId: string;
  timestamp: string; // ISO8601
}

export interface ErrorResponse {
  code: string;
  message: string;
  retry_after?: number;
  fallback_available: boolean;
  request_id: string;
}
