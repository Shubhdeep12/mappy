/**
 * Zod validation schemas
 *
 * Runtime validation for API request input. Only schemas used by the API are exported.
 */

import { z } from 'zod';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const PreferencePillSchema = z.object({
  text: z.string().min(1).max(500),
});

export const ContextMetadataSchema = z.object({
  routeType: z.enum(['walk', 'explore']).optional(),
  preferredDistanceUnit: z.enum(['miles', 'km']).optional(),
});

export const LocationInputSchema = z.object({
  type: z.enum(['current', 'custom']),
  coordinates: LatLngSchema.optional(),
  address: z.string().optional(),
}).refine(
  (data) => {
    if (data.type === 'custom') {
      return data.coordinates || data.address;
    }
    return true;
  },
  { message: 'Custom location must have coordinates or address' }
);

export const RouteGenerationRequestSchema = z.object({
  preferences: z.array(PreferencePillSchema).min(1),
  location: LocationInputSchema,
  context: ContextMetadataSchema.optional(),
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  apiKeys: z.object({
    gemini: z.string().optional(),
    googleMaps: z.string().optional(),
  }).optional(),
});
