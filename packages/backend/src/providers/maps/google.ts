/**
 * Google Maps Provider - Production implementation using Routes API (v2),
 * Places API (2023+), Geocoding, and Elevation APIs.
 */


import { createRequire } from 'node:module';
import { Client, Status } from '@googlemaps/google-maps-services-js';
import { RoutesClient } from '@googlemaps/routing';
import { PlacesClient } from '@googlemaps/places';
import { getDistance } from 'geolib';

const require = createRequire(import.meta.url);
const { decode } = require('@googlemaps/polyline-codec') as { decode: (encoded: string, precision?: number) => [number, number][] };
import type { MapsProvider } from './interface';
import type { LatLng, BoundingBox, TravelMode, POIType, Route, POI } from '@mappy/shared';

export class GoogleMapsProvider implements MapsProvider {
  private readonly legacyClient: Client;
  private readonly routingClient: RoutesClient;
  private readonly placesClient: PlacesClient;
  private readonly apiKey: string;
  private readonly timeout: number = 30000;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google Maps API key is required');
    }
    this.apiKey = apiKey;
    this.legacyClient = new Client({});
    this.routingClient = new RoutesClient({ apiKey });
    this.placesClient = new PlacesClient({ apiKey });
  }

  /**
   * Generates a route using the modern Routes v2 API
   * 
   * @param waypoints - The waypoints to route between.
   * @param mode - The travel mode.
   * @returns The route.
   */
  async route(waypoints: LatLng[], mode: TravelMode): Promise<Route> {
    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints required for routing');
    }

    const travelMode = mode === 'biking' ? 'BICYCLE' : 'WALK';
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.length > 2 ? waypoints.slice(1, -1) : undefined;

    try {
      const [response] = await this.routingClient.computeRoutes({
        origin: this.formatWaypoint(origin),
        destination: this.formatWaypoint(destination),
        intermediates: intermediates?.map(w => this.formatWaypoint(w)),
        travelMode,
        polylineQuality: 'OVERVIEW',
        polylineEncoding: 'ENCODED_POLYLINE',
      }, {
        otherArgs: {
          headers: {
            'X-Goog-FieldMask': [
              'routes.distanceMeters',
              'routes.duration',
              'routes.polyline.encodedPolyline',
              'routes.legs.distanceMeters',
              'routes.legs.duration',
              'routes.legs.steps.distanceMeters',
              'routes.legs.steps.staticDuration',
              'routes.legs.steps.polyline.encodedPolyline',
              'routes.legs.steps.navigationInstruction.instructions',
            ].join(','),
          },
        },
      });

      if (!response.routes?.[0]) {
        throw new Error('Routing failed: No routes found');
      }

      return this.parseRouteResponse(response.routes[0]);
    } catch (error: unknown) {
      this.handleError(error, 'routing');
    }
  }

  /**
   * Search for POIs using Places API.
   * 
   * @param bounds - The bounding box to search within.
   * @param types - The types of POIs to search for.
   * @returns A list of POIs.
   */
  async findPOIs(bounds: BoundingBox, types: POIType[]): Promise<POI[]> {
    const center = {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2,
    };

    const allPOIs: POI[] = [];

    for (const type of types) {
      try {
        const [response] = await this.placesClient.searchNearby({
          locationRestriction: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: this.calculateRadius(bounds, center),
            },
          },
          includedTypes: [this.mapPOIType(type)],
          maxResultCount: 20,
        }, {
          otherArgs: {
            headers: {
              'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.formattedAddress,places.types',
            },
          },
        });

        if (response.places) {
          allPOIs.push(...response.places.map(place => this.mapPlaceToPOI(place, type)));
        }
      } catch (error) {
        console.warn(`Places search failed for ${type}:`, error);
      }
    }

    return allPOIs;
  }

  /**
   * Converts an address to coordinates using the Geocoding API.
   * 
   * @param address - The address to geocode.
   * @returns The coordinates.
   */
  async geocode(address: string): Promise<LatLng> {
    if (!address || address.trim().length === 0) {
      throw new Error('Address cannot be empty');
    }

    const response = await this.legacyClient.geocode({
      params: { address, key: this.apiKey },
      timeout: 10000,
    });

    if (response.data.status !== Status.OK || !response.data.results?.[0]) {
      throw new Error(`Geocoding failed: ${response.data.status || 'No results'}`);
    }

    const { lat, lng } = response.data.results[0].geometry.location;
    return { lat, lng };
  }

  /**
   * Gets the elevation profile for a path using the Elevation API.
   * 
   * @param path - The path to get the elevation profile for.
   * @returns The elevation profile.
   */
  async getElevation(path: LatLng[]): Promise<number[]> {
    if (path.length === 0) return [];

    const response = await this.legacyClient.elevation({
      params: { locations: path, key: this.apiKey },
      timeout: this.timeout,
    });

    if (response.data.status !== Status.OK || !response.data.results) {
      throw new Error(`Elevation API failed: ${response.data.status || 'No results'}`);
    }

    return response.data.results.map((r) => r.elevation || 0);
  }

  /**
   * Checks if the Google Maps API is healthy.
   * 
   * @returns True if the API is healthy, false otherwise.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.legacyClient.geocode({
        params: { address: 'test', key: this.apiKey },
        timeout: 5000,
      });
      return response.data.status === Status.OK || response.data.status === Status.ZERO_RESULTS;
    } catch {
      return false;
    }
  }

  /**
   * Formats a waypoint for the Routes API.
   * 
   * @param w - The waypoint to format.
   * @returns The formatted waypoint.
   */
  private formatWaypoint(w: LatLng) {
    return { location: { latLng: { latitude: w.lat, longitude: w.lng } } };
  }

  /**
   * Parses a route response from the Routes API.
   * 
   * @param routeData - The route data to parse.
   * @returns The parsed route.
   */
  private parseRouteResponse(routeData: any): Route {
    const geometry = decode(routeData.polyline.encodedPolyline);

    const legs = (routeData.legs || []).map((leg: any) => ({
      distance: leg.distanceMeters || 0,
      duration: this.parseDuration(leg.duration),
      steps: (leg.steps || []).map((step: any) => ({
        distance: step.distanceMeters || 0,
        duration: this.parseDuration(step.staticDuration),
        instruction: step.navigationInstruction?.instructions || '',
        geometry: {
          type: 'LineString' as const,
          coordinates: step.polyline?.encodedPolyline
            ? decode(step.polyline.encodedPolyline).map(([lat, lng]) => [lng, lat] as [number, number])
            : [],
        },
      })),
    }));

    return {
      distance: routeData.distanceMeters || legs.reduce((s: number, l: any) => s + l.distance, 0),
      duration: this.parseDuration(routeData.duration) || legs.reduce((s: number, l: any) => s + l.duration, 0),
      geometry: {
        type: 'LineString',
        coordinates: geometry.map(([lat, lng]) => [lng, lat]) as [number, number][],
      },
      legs,
    };
  }

  /**
   * Maps a place to a POI.
   * 
   * @param place - The place to map.
   * @param originalType - The original type of the place.
   * @returns The mapped POI.
   */
  private mapPlaceToPOI(place: any, originalType: POIType): POI {
    return {
      id: place.id!,
      name: place.displayName?.text || 'Unknown',
      location: {
        lat: place.location?.latitude || 0,
        lng: place.location?.longitude || 0,
      },
      type: originalType,
      rating: place.rating,
      metadata: {
        address: place.formattedAddress,
        types: place.types,
      },
    };
  }

  /**
   * Parses a duration value to a number (seconds).
   * 
   * @param duration - The duration value (string like "30s", number, or undefined).
   * @returns The parsed duration in seconds.
   */
  private parseDuration(duration: string | number | undefined): number {
    if (!duration) return 0;
    if (typeof duration === 'number') return duration;
    if (typeof duration === 'string') {
      return parseInt(duration.replace('s', ''), 10) || 0;
    }
    return 0;
  }

  /**
   * Calculates the radius of a bounding box.
   * 
   * @param bounds - The bounding box to calculate the radius of.
   * @param center - The center of the bounding box.
   * @returns The radius of the bounding box.
   */
  private calculateRadius(bounds: BoundingBox, center: LatLng): number {
    return Math.min(
      getDistance(
        { latitude: bounds.north, longitude: bounds.west },
        { latitude: center.lat, longitude: center.lng }
      ),
      50000
    );
  }

  /**
   * Map POI type to Google Maps Places API type.
   * 
   * @param type - The POI type.
   * @returns The Google Maps Places API type.
   */
  private mapPOIType(type: POIType): string {
    const mapping: Record<POIType, string> = {
      cafe: 'cafe',
      park: 'park',
      viewpoint: 'tourist_attraction',
      restaurant: 'restaurant',
      water: 'park', // Parks often include waterfront/water features
      scenic: 'tourist_attraction',
      historical: 'museum',
      nature: 'park',
      landmark: 'tourist_attraction',
      shopping: 'shopping_mall',
      entertainment: 'amusement_park',
      other: 'establishment',
    };
    return mapping[type] ?? 'establishment';
  }

  /**
   * Handle errors from Google Maps API.
   * 
   * @param error - The error.
   * @param context - The context.
   * @returns Never.
   */
  private handleError(error: unknown, context: string): never {
    if (error instanceof Error) throw error;
    throw new Error(`Unknown error in Google Maps ${context}: ${error}`);
  }
}
