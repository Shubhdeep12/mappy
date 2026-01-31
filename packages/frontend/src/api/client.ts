/**
 * API Client
 * 
 * HTTP client for backend API communication.
 */

import type { PreferencePill, LocationInput, ContextMetadata, GeneratedRoute } from '@mappy/shared';

export interface RouteRequest {
  preferences: PreferencePill[];
  location: LocationInput;
  context?: ContextMetadata;
  apiKeys?: {
    gemini?: string;
    googleMaps?: string;
  };
}

export class RouteAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async generateRoute(request: RouteRequest): Promise<{ routes: GeneratedRoute[] }> {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        requestId,
        timestamp,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ 
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw new Error(error.message || error.error || `HTTP ${response.status}: ${error.code || 'Unknown error'}`);
    }

    return await response.json();
  }

  async healthCheck(): Promise<{ status: string; providers: Record<string, string> }> {
    const response = await fetch(`${this.baseUrl}/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return await response.json();
  }

  async getStatus(): Promise<{ status: string; version: string; environment: string }> {
    const response = await fetch(`${this.baseUrl}/status`);

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }

    return await response.json();
  }
}
