/** Check lat/lng are in range and not obviously invalid (e.g. ocean). */

import type { LatLng } from '@mappy/shared';

export interface CoordinateValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

export function validateCoordinates(location: LatLng): CoordinateValidationResult {
  const { lat, lng } = location;

  // Basic range validation
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return {
      valid: false,
      error: 'Invalid coordinates format',
      suggestion: 'Please enter valid latitude and longitude values',
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      valid: false,
      error: 'Latitude out of range',
      suggestion: 'Latitude must be between -90 and 90 degrees',
    };
  }

  if (lng < -180 || lng > 180) {
    return {
      valid: false,
      error: 'Longitude out of range',
      suggestion: 'Longitude must be between -180 and 180 degrees',
    };
  }

  // Check for obviously uninhabited areas
  const oceanRegions = [
    // Pacific Ocean
    { latMin: -60, latMax: 60, lngMin: -180, lngMax: -100 },
    { latMin: -60, latMax: 60, lngMin: 140, lngMax: 180 },
    // Atlantic Ocean
    { latMin: -60, latMax: 60, lngMin: -60, lngMax: -10 },
    // Indian Ocean
    { latMin: -60, latMax: 20, lngMin: 40, lngMax: 120 },
    // Southern Ocean
    { latMin: -90, latMax: -60, lngMin: -180, lngMax: 180 },
    // Arctic Ocean
    { latMin: 80, latMax: 90, lngMin: -180, lngMax: 180 },
  ];

  for (const region of oceanRegions) {
    if (lat >= region.latMin && lat <= region.latMax && 
        lng >= region.lngMin && lng <= region.lngMax) {
      return {
        valid: false,
        error: 'Location appears to be in ocean or remote area',
        suggestion: 'Please select a location on land with roads and points of interest',
      };
    }
  }

  // Check for extreme polar regions
  if (Math.abs(lat) > 75) {
    return {
      valid: false,
      error: 'Location is too close to poles',
      suggestion: 'Please select a location between 75°N and 75°S for reliable route generation',
    };
  }

  return { valid: true };
}

/**
 * Get a user-friendly location description for error messages.
 */
export function getLocationDescription(location: LatLng): string {
  const { lat, lng } = location;
  
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

/**
 * Check if coordinates are likely in a populated area (heuristic).
 * Uses rough continental boundaries.
 */
export function isLikelyPopulated(location: LatLng): boolean {
  const { lat, lng } = location;

  // Major inhabited regions (rough bounding boxes)
  const populatedRegions = [
    // North America
    { latMin: 25, latMax: 70, lngMin: -170, lngMax: -50 },
    // South America
    { latMin: -55, latMax: 15, lngMin: -85, lngMax: -30 },
    // Europe
    { latMin: 35, latMax: 72, lngMin: -10, lngMax: 45 },
    // Africa
    { latMin: -35, latMax: 37, lngMin: -20, lngMax: 52 },
    // Asia
    { latMin: -10, latMax: 55, lngMin: 60, lngMax: 150 },
    // Australia/Oceania
    { latMin: -45, latMax: -10, lngMin: 110, lngMax: 180 },
  ];

  for (const region of populatedRegions) {
    if (lat >= region.latMin && lat <= region.latMax && 
        lng >= region.lngMin && lng <= region.lngMax) {
      return true;
    }
  }

  return false;
}
