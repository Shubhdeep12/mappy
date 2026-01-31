/**
 * Maps Provider Interface
 * 
 * Defines the contract for mapping and geospatial services.
 * Implementations: OSMProvider (dev), GoogleMapsProvider (prod)
 * 
 * Methods:
 * - route(): Calculate route through waypoints
 * - findPOIs(): Discover points of interest in area
 * - geocode(): Convert address to coordinates
 * - getElevation(): Get elevation profile for path
 * - healthCheck(): Provider availability check
 */

import type { LatLng, BoundingBox, TravelMode, POIType, Route, POI } from '../types';

export interface MapsProvider {
  /**
   * Calculate route through waypoints with specified travel mode
   */
  route(waypoints: LatLng[], mode: TravelMode): Promise<Route>;
  
  /**
   * Find POIs within bounding box matching specified types
   */
  findPOIs(bounds: BoundingBox, types: POIType[]): Promise<POI[]>;
  
  /**
   * Convert address string to coordinates
   */
  geocode(address: string): Promise<LatLng>;
  
  /**
   * Get elevation profile for a path (array of coordinates)
   */
  getElevation(path: LatLng[]): Promise<number[]>;
  
  /**
   * Check if provider is available and healthy
   */
  healthCheck(): Promise<boolean>;
}
