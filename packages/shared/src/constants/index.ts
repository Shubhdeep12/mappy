/**
 * Shared constants for the Mappy application
 */

export const ROUTE_MODE = {
  WALK: 'walk',
  EXPLORE: 'explore',
} as const;

export type RouteMode = typeof ROUTE_MODE[keyof typeof ROUTE_MODE];

export const ACTIVITY_TYPE = {
  WALKING: 'walking',
  RUNNING: 'running',
  BIKING: 'biking',
} as const;

export type ActivityTypeConstant = typeof ACTIVITY_TYPE[keyof typeof ACTIVITY_TYPE];
