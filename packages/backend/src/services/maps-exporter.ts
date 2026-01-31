/**
 * Maps Export Service
 * 
 * Generates export formats for route consumption.
 * Creates URLs and deep links for various mapping platforms.
 */

import { ACTIVITY_TYPE } from '@mappy/shared';
import type { LatLng, ExportData, ActivityType } from '@mappy/shared';

export class MapsExporter {
  generateExport(waypoints: LatLng[], activity: ActivityType = ACTIVITY_TYPE.WALKING as ActivityType): ExportData {
    const mapsUrl = this.generateGoogleMapsUrl(waypoints, activity);
    const deepLinks = this.generateDeepLinks(waypoints, activity);

    return {
      maps_url: mapsUrl,
      deep_links: deepLinks,
    };
  }

  private generateGoogleMapsUrl(waypoints: LatLng[], activity: ActivityType): string {
    if (waypoints.length < 2) {
      return '';
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediate = waypoints.slice(1, -1);

    const baseUrl = 'https://www.google.com/maps/dir/';
    const waypointStr = [
      `${origin.lat},${origin.lng}`,
      ...intermediate.map(wp => `${wp.lat},${wp.lng}`),
      `${destination.lat},${destination.lng}`,
    ].join('/');

    const mode = activity === ACTIVITY_TYPE.BIKING ? 'biking' : 'walking';
    
    return `${baseUrl}${waypointStr}?travelmode=${mode}`;
  }

  private generateDeepLinks(waypoints: LatLng[], activity: ActivityType): Record<string, string> {
    const mapsUrl = this.generateGoogleMapsUrl(waypoints, activity);

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const appleMapsUrl = `https://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${destination.lat},${destination.lng}`;

    return {
      web: mapsUrl,
      ios: appleMapsUrl,
      android: mapsUrl,
      universal: mapsUrl,
    };
  }
}
