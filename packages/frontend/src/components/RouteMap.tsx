/**
 * Route Map Component
 * 
 * Map visualization supporting both Google Maps (production) and Leaflet/OpenStreetMap (development).
 * 
 * Features:
 * - Display route polyline
 * - Waypoint markers
 * - POI markers with info windows
 * - Auto-detect map provider based on API key availability
 * 
 * Uses:
 * - Google Maps: @googlemaps/js-api-loader (when API key provided)
 * - Leaflet/OpenStreetMap: react-leaflet (development fallback)
 */

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
// @ts-ignore - react-leaflet types may not be resolved correctly in monorepo
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeneratedRoute } from '@mappy/shared';

// Fix Leaflet default icon issue - use CDN URLs instead of importing files
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Declare google namespace for TypeScript
declare global {
  interface Window {
    google: typeof google;
  }
}

interface RouteMapProps {
  route: GeneratedRoute;
  apiKey?: string;
}

export function RouteMap({ route, apiKey }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const [useGoogleMaps, setUseGoogleMaps] = useState(!!apiKey);

  // Use Google Maps if API key provided, otherwise use Leaflet
  useEffect(() => {
    setUseGoogleMaps(!!apiKey);
  }, [apiKey]);

  // Google Maps implementation
  useEffect(() => {
    if (!useGoogleMaps || !mapRef.current || !apiKey) {
      return undefined;
    }

    let isMounted = true;

    // Use new functional API
    setOptions({
      key: apiKey,
      v: 'weekly',
    });

    Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('core'),
    ]).then(async ([maps, marker, core]) => {
      if (!isMounted || !mapRef.current) return;

      const { Map } = maps;
      const { Marker } = marker;
      const { LatLngBounds } = core;

      const map = new Map(mapRef.current, {
        center: {
          lat: route.waypoints[0].lat,
          lng: route.waypoints[0].lng,
        },
        zoom: 14,
      });

      mapInstanceRef.current = map as any;

      // Draw route polyline
      const path = route.route.geometry.coordinates.map((coord: [number, number]) => ({
        lat: coord[1],
        lng: coord[0],
      }));

      new maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeOpacity: 1.0,
        strokeWeight: 5,
        map,
      });

      // Add waypoint markers
      route.waypoints.forEach((waypoint: { lat: number; lng: number }, index: number) => {
        new Marker({
          position: { lat: waypoint.lat, lng: waypoint.lng },
          map,
          label: {
            text: `${index + 1}`,
            color: 'white',
            fontWeight: 'bold',
          },
          title: `Waypoint ${index + 1}`,
        });
      });

      // Add POI markers
      route.pois.forEach((poi: { id: string; location: { lat: number; lng: number }; name: string }) => {
        new Marker({
          position: { lat: poi.location.lat, lng: poi.location.lng },
          map,
          icon: {
            url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
          },
          title: poi.name,
        });
      });

      // Fit bounds to show entire route
      const bounds = new LatLngBounds();
      path.forEach((point: { lat: number; lng: number }) => bounds.extend(point));
      map.fitBounds(bounds);
    }).catch((error: unknown) => {
      console.error('Failed to load Google Maps:', error);
    });

    return () => {
      isMounted = false;
    };
  }, [route, apiKey, useGoogleMaps]);

  // Leaflet/OpenStreetMap implementation (development)
  if (!useGoogleMaps) {
    const center: [number, number] = [
      route.waypoints[0].lat,
      route.waypoints[0].lng,
    ];

    const polylinePositions: [number, number][] = route.route.geometry.coordinates.map(
      (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
    );

    return (
      <div className="w-full h-96 rounded-lg overflow-hidden border border-gray-300">
        <MapContainer
          center={center}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline
            positions={polylinePositions}
            pathOptions={{ color: '#4285F4', weight: 4 }}
          />
          {route.waypoints.map((waypoint: { lat: number; lng: number }, index: number) => (
            <Marker key={index} position={[waypoint.lat, waypoint.lng]}>
              <Popup>Waypoint {index + 1}</Popup>
            </Marker>
          ))}
          {route.pois?.map((poi: { id: string; location: { lat: number; lng: number }; name: string }) => (
            <Marker key={poi.id} position={[poi.location.lat, poi.location.lng]}>
              <Popup>{poi.name}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    );
  }

  // Google Maps fallback message
  if (!apiKey) {
    return (
      <div className="w-full h-96 bg-gray-200 rounded-lg flex items-center justify-center">
        <p className="text-gray-600">
          Google Maps API key required for map visualization.
          <br />
          <a
            href={route.export.maps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Open in Google Maps
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-96 rounded-lg overflow-hidden">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
