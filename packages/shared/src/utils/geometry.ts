/**
 * Geometry utilities for spatial calculations
 * 
 * Shared functions for distance, bearing, and coordinate calculations
 * used across backend services and agents.
 */

import type { LatLng } from '../types/index.js';

/**
 * Earth's radius in meters
 */
const EARTH_RADIUS_M = 6371000;

/**
 * Calculate distance between two points using Haversine formula
 * 
 * @param p1 First point
 * @param p2 Second point
 * @returns Distance in meters
 */
export function haversineDistance(p1: LatLng, p2: LatLng): number {
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculate bearing between two points
 * 
 * @param p1 Start point
 * @param p2 End point
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(p1: LatLng, p2: LatLng): number {
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360;
}

/**
 * Calculate elevation gain from elevation profile
 * 
 * @param elevation Array of elevation values in meters
 * @returns Total elevation gain in meters
 */
export function calculateElevationGain(elevation: number[]): number {
  let gain = 0;
  for (let i = 1; i < elevation.length; i++) {
    const diff = elevation[i] - elevation[i - 1];
    if (diff > 0) {
      gain += diff;
    }
  }
  return Math.round(gain);
}

/**
 * Check if a point is within a bounding box
 * 
 * @param point Point to check
 * @param bounds Bounding box
 * @returns True if point is within bounds
 */
export function isPointInBounds(point: LatLng, bounds: { north: number; south: number; east: number; west: number }): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north &&
    point.lng >= bounds.west && point.lng <= bounds.east;
}
