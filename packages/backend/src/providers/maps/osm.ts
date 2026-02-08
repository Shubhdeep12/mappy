/**
 * OpenStreetMap Provider - Free mapping services for development.
 * Uses OSRM (routing), Overpass API (POI discovery), Nominatim (geocoding), Open-Elevation (elevation).
 */


import type { MapsProvider } from './interface';
import type { LatLng, BoundingBox, TravelMode, POIType, Route, POI } from '@mappy/shared';

export class OSMProvider implements MapsProvider {
  private osrmEndpoint: string;
  private overpassEndpoint: string;
  private nominatimEndpoint: string;
  private timeout: number = 30000; // 30 seconds

  constructor(
    osrmEndpoint: string = 'http://router.project-osrm.org',
    overpassEndpoint: string = 'https://overpass-api.de/api/interpreter',
    nominatimEndpoint: string = 'https://nominatim.openstreetmap.org'
  ) {
    this.osrmEndpoint = osrmEndpoint.replace(/\/$/, '');
    this.overpassEndpoint = overpassEndpoint.replace(/\/$/, '');
    this.nominatimEndpoint = nominatimEndpoint.replace(/\/$/, '');
  }

  async route(waypoints: LatLng[], mode: TravelMode): Promise<Route> {
    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints required for routing');
    }

    const profile = mode === 'biking' ? 'bike' : 'foot';
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = `${this.osrmEndpoint}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true&annotations=true`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mappy/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OSRM API error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json() as {
        code?: string;
        message?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { type: string; coordinates: number[][] };
          legs?: Array<{
            distance: number;
            duration: number;
            steps?: Array<{
              distance: number;
              duration: number;
              maneuver?: { instruction?: string; modifier?: string };
              geometry?: { type: string; coordinates: number[][] };
            }>;
          }>;
        }>;
      };

      if (data.code !== 'Ok') {
        throw new Error(`OSRM routing failed: ${data.message || 'Unknown error'}`);
      }

      if (!data.routes || data.routes.length === 0) {
        throw new Error('OSRM returned no routes');
      }

      const route = data.routes[0];

      return {
        distance: route.distance,
        duration: route.duration,
        geometry: {
          type: 'LineString' as const,
          coordinates: route.geometry.coordinates as [number, number][],
        },
        legs: route.legs?.map((leg: any) => ({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps?.map((step: any) => ({
            distance: step.distance,
            duration: step.duration,
            instruction: step.maneuver?.instruction || step.maneuver?.modifier || 'Continue',
            geometry: step.geometry ? {
              type: 'LineString' as const,
              coordinates: step.geometry.coordinates as [number, number][],
            } : {
              type: 'LineString' as const,
              coordinates: route.geometry.coordinates as [number, number][],
            },
          })) || [],
        })) || [],
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`OSRM request timeout after ${this.timeout}ms`);
        }
        throw error;
      }

      throw new Error(`Unknown error in OSM routing: ${error}`);
    }
  }

  async findPOIs(bounds: BoundingBox, types: POIType[]): Promise<POI[]> {
    if (types.length === 0) {
      return [];
    }

    const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

    // Build Overpass query
    const typeQueries = types.map(type => {
      const osmTag = this.poiTypeToOSMTag(type);
      return `  node[${osmTag}](${bbox});\n  way[${osmTag}](${bbox});`;
    }).join('\n');

    const query = `[out:json][timeout:25];
(
${typeQueries}
);
out center tags;`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.overpassEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mappy/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Overpass API error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json() as {
        elements?: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };

      if (!data.elements || !Array.isArray(data.elements)) {
        return [];
      }

      const pois: POI[] = [];

      for (const element of data.elements) {
        const location = element.lat && element.lon
          ? { lat: element.lat, lng: element.lon }
          : element.center
            ? { lat: element.center.lat, lng: element.center.lon }
            : null;

        if (!location) {
          continue;
        }

        pois.push({
          id: `osm-${element.type}-${element.id}`,
          name: element.tags?.name || 'Unnamed',
          location,
          type: this.osmTagToPOIType(element.tags || {}),
          rating: element.tags?.stars ? parseFloat(element.tags.stars) : undefined,
          metadata: element.tags,
        });
      }

      return pois;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Overpass API request timeout after ${this.timeout}ms`);
        }
        throw error;
      }

      throw new Error(`Unknown error in POI discovery: ${error}`);
    }
  }

  async geocode(address: string): Promise<LatLng> {
    if (!address || address.trim().length === 0) {
      throw new Error('Address cannot be empty');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds for geocoding

    try {
      const url = `${this.nominatimEndpoint}/search?q=${encodeURIComponent(address)}&format=json&limit=1`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mappy/1.0', // Required by Nominatim
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Nominatim API error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json() as Array<{
        lat: string;
        lon: string;
      }>;

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(`No results found for address: ${address}`);
      }

      const result = data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Geocoding request timeout after 10s`);
        }
        throw error;
      }

      throw new Error(`Unknown error in geocoding: ${error}`);
    }
  }

  async getElevation(path: LatLng[]): Promise<number[]> {
    if (path.length === 0) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mappy/1.0',
        },
        body: JSON.stringify({
          locations: path.map(p => ({
            latitude: p.lat,
            longitude: p.lng,
          })),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Open-Elevation API error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json() as {
        results?: Array<{ elevation?: number }>;
      };

      if (!data.results || !Array.isArray(data.results)) {
        throw new Error('Invalid response format from Open-Elevation API');
      }

      return data.results.map((r) => r.elevation || 0);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Elevation request timeout after ${this.timeout}ms`);
        }
        throw error;
      }

      throw new Error(`Unknown error in elevation lookup: ${error}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Use valid routeable coordinates (San Francisco area - known to have routes)
      // Format: lng,lat;lng,lat (OSRM format)
      const testCoords = '-122.4194,37.7749;-122.4094,37.7849';
      const url = `${this.osrmEndpoint}/route/v1/foot/${testCoords}?overview=false`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mappy/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`OSM health check failed: ${response.status} ${response.statusText} from ${this.osrmEndpoint}`, errorText.substring(0, 100));
        return false;
      }

      // Verify we got a valid route response
      const data = await response.json().catch(() => null) as { code?: string } | null;
      if (!data || data.code !== 'Ok') {
        console.warn(`OSM health check: Invalid response from ${this.osrmEndpoint}`, data?.code || 'No data');
        return false;
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`OSM health check error: ${errorMessage} (endpoint: ${this.osrmEndpoint})`);
      return false;
    }
  }

  private poiTypeToOSMTag(type: POIType): string {
    const mapping: Record<POIType, string> = {
      cafe: 'amenity=cafe',
      park: 'leisure=park',
      viewpoint: 'tourism=viewpoint',
      restaurant: 'amenity=restaurant',
      water: 'natural=water',
      scenic: 'tourism=viewpoint',
      historical: 'historic',
      nature: 'natural',
      landmark: 'tourism=attraction',
      shopping: 'shop',
      entertainment: 'tourism=museum',
      other: 'amenity',
    };
    return mapping[type] || 'amenity=cafe';
  }

  private osmTagToPOIType(tags: Record<string, string>): POIType {
    if (tags.amenity === 'cafe') return 'cafe';
    if (tags.amenity === 'restaurant') return 'restaurant';
    if (tags.leisure === 'park') return 'park';
    if (tags.tourism === 'viewpoint') return 'viewpoint';
    if (tags.natural === 'water') return 'water';
    if (tags.historic) return 'historical';
    return 'cafe'; // default
  }
}
