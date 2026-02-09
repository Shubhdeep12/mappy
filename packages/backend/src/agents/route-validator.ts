/**
 * Route Validator - Validates waypoint sequences using Google Directions API or OSRM.
 */


import type { MapsProvider } from '../providers/maps/interface.js';
import { calculateElevationGain } from '@mappy/shared';
import { VALIDATION_CONSTANTS, DISTANCE_CONSTANTS } from '../config/constants.js';
import type { LatLng, ParsedPreferences, ValidationResult, ActivityType } from '@mappy/shared';
import { ValidationError } from '@mappy/shared';

export class RouteValidator {
  constructor(private maps: MapsProvider) { }

  async validateRoute(
    waypoints: LatLng[],
    preferences: ParsedPreferences,
    activity: ActivityType,
    maxRetries: number = VALIDATION_CONSTANTS.MAX_VALIDATION_RETRIES
  ): Promise<ValidationResult> {
    if (waypoints.length < 2) {
      return {
        valid: false,
        error: ValidationError.CONNECTIVITY_FAILURE,
        details: 'At least 2 waypoints required',
      };
    }

    for (const wp of waypoints) {
      if (typeof wp.lat !== 'number' || typeof wp.lng !== 'number' ||
        isNaN(wp.lat) || isNaN(wp.lng) ||
        wp.lat < -90 || wp.lat > 90 ||
        wp.lng < -180 || wp.lng > 180) {
        return {
          valid: false,
          error: ValidationError.CONNECTIVITY_FAILURE,
          details: `Invalid waypoint coordinates: lat=${wp.lat}, lng=${wp.lng}`,
        };
      }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await this.validate(waypoints, preferences, activity);

      if (result.valid) {
        return result;
      }

      if (attempt < maxRetries - 1 && result.error === ValidationError.API_ERROR) {
        console.warn(`Validation attempt ${attempt + 1} failed: ${result.error}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      } else {
        return result;
      }
    }

    return {
      valid: false,
      error: ValidationError.CONNECTIVITY_FAILURE,
      details: 'Failed to validate route after multiple attempts',
    };
  }

  private async validate(
    waypoints: LatLng[],
    preferences: ParsedPreferences,
    activity: ActivityType
  ): Promise<ValidationResult> {
    try {
      const route = await this.maps.route(waypoints, activity);

      if (!route.distance || route.distance <= 0) {
        console.error('[RouteValidator] Maps API returned invalid distance:', {
          distance: route.distance,
          waypointCount: waypoints.length,
          firstWaypoint: waypoints[0],
          lastWaypoint: waypoints[waypoints.length - 1],
        });
        return {
          valid: false,
          error: ValidationError.DISTANCE_MISMATCH,
          details: `Routing returned zero or invalid distance (distance=${route.distance}, waypoints=${waypoints.length})`,
        };
      }

      // Calculate distance accuracy for scoring (but don't fail validation)
      let distanceAccuracy = 1.0;
      let distanceWarning: string | undefined;

      const distanceConstraint = preferences.constraints.hard.find(c => c.type === 'distance');
      if (distanceConstraint && typeof distanceConstraint.value === 'number') {
        const targetDistance = distanceConstraint.unit === 'km'
          ? distanceConstraint.value * 1000
          : distanceConstraint.value * 1609.34;

        // Calculate accuracy as a ratio (1.0 = perfect, lower = worse)
        const deviation = Math.abs(route.distance - targetDistance) / targetDistance;
        distanceAccuracy = Math.max(0, 1 - deviation);

        // Log warning if significantly off, but DON'T fail validation
        if (deviation > DISTANCE_CONSTANTS.DISTANCE_TOLERANCE) {
          distanceWarning = `Distance deviation: actual ${(route.distance / 1000).toFixed(1)}km vs target ${(targetDistance / 1000).toFixed(1)}km (${(deviation * 100).toFixed(0)}% off)`;
          console.warn(`[RouteValidator] ${distanceWarning}`);
        }
      }

      if (route.elevation && route.elevation.length > 0) {
        const elevationConstraint = preferences.constraints.hard.find(c => c.type === 'elevation');
        if (elevationConstraint && typeof elevationConstraint.value === 'number') {
          const maxElevation = elevationConstraint.value;
          const elevationGain = calculateElevationGain(route.elevation);

          if (elevationGain > maxElevation) {
            return {
              valid: false,
              error: ValidationError.ELEVATION_EXCEEDED,
              details: `Elevation gain ${elevationGain}m exceeds limit ${maxElevation}m`,
            };
          }
        }
      }

      return {
        valid: true,
        directions: route,
        metadata: {
          distance: route.distance,
          duration: route.duration,
          waypointCount: waypoints.length,
          distanceAccuracy,
          distanceWarning,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
      console.error('Route validation API error:', errorMessage);
      return {
        valid: false,
        error: ValidationError.API_ERROR,
        details: errorMessage,
      };
    }
  }
}
