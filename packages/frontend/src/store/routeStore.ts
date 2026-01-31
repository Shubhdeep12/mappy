/**
 * Route State Store (Zustand)
 * 
 * Global state management for route generation.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PreferencePill, LocationInput, GeneratedRoute, RouteType, DistanceUnit } from '@mappy/shared';
import { ROUTE_MODE } from '@mappy/shared';

interface RouteState {
  preferences: PreferencePill[];
  location: LocationInput | null;
  routeType: RouteType;
  distanceUnit: DistanceUnit; // miles | km — used for display and sent to backend
  apiKeys: {
    gemini?: string;
    googleMaps?: string;
  };
  loading: boolean;
  route: GeneratedRoute[] | null;
  error: string | null;
}

interface RouteActions {
  addPreference: (pill: PreferencePill) => void;
  removePreference: (index: number) => void;
  setLocation: (location: LocationInput) => void;
  setRouteType: (routeType: RouteType) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setApiKeys: (keys: { gemini?: string; googleMaps?: string }) => void;
  setLoading: (loading: boolean) => void;
  setRoute: (route: GeneratedRoute[] | null) => void;
  setError: (error: string | null) => void;
  clearRoute: () => void;
  clearAll: () => void;
}

export const useRouteStore = create<RouteState & RouteActions>()(
  persist(
    (set) => ({
      preferences: [],
      location: null,
      routeType: ROUTE_MODE.WALK as RouteType,
      distanceUnit: 'miles',
      apiKeys: {},
      loading: false,
      route: null,
      error: null,

      addPreference: (pill) =>
        set((state) => ({
          preferences: [...state.preferences, pill],
        })),

      removePreference: (index) =>
        set((state) => ({
          preferences: state.preferences.filter((_, i) => i !== index),
        })),

      setLocation: (location) =>
        set({ location }),

      setRouteType: (routeType) =>
        set({ routeType }),

      setDistanceUnit: (distanceUnit) =>
        set({ distanceUnit }),

      setApiKeys: (keys) =>
        set({ apiKeys: keys }),

      setLoading: (loading) =>
        set({ loading }),

      setRoute: (route) =>
        set({ route, error: null }),

      setError: (error) =>
        set({ error, loading: false }),

      clearRoute: () =>
        set({ route: null, error: null }),

      clearAll: () =>
        set({
          preferences: [],
          location: null,
          route: null,
          error: null,
          loading: false,
        }),
    }),
    {
      name: 'mappy-route-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        preferences: state.preferences,
        location: state.location,
        routeType: state.routeType,
        distanceUnit: state.distanceUnit,
        // apiKeys intentionally excluded: never persist user API keys to storage
      }),
    }
  )
);
