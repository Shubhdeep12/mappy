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

export interface ProgressEvent {
  type: 'progress';
  step: string;
  message: string;
  progress?: number;
}

export interface CompleteEvent {
  type: 'complete';
  routes: GeneratedRoute[];
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

const envApiUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL;
const defaultBaseUrl = (typeof envApiUrl === 'string' && envApiUrl.trim()) ? envApiUrl.trim() : '/api';

export class RouteAPI {
  private baseUrl: string;

  constructor(baseUrl: string = defaultBaseUrl) {
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

  /**
   * Generate route with streaming progress updates (SSE)
   */
  async generateRouteWithProgress(
    request: RouteRequest,
    onProgress: (event: ProgressEvent) => void
  ): Promise<{ routes: GeneratedRoute[] }> {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    return new Promise((resolve, reject) => {
      // Use fetch with streaming response instead of EventSource for POST support
      fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          ...request,
          requestId,
          timestamp,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const error = await response.json().catch(() => ({
              code: 'UNKNOWN_ERROR',
              message: `HTTP ${response.status}: ${response.statusText}`,
            }));
            reject(new Error(error.message || error.error || `HTTP ${response.status}: ${error.code || 'Unknown error'}`));
            return;
          }

          if (!response.body) {
            reject(new Error('Response body is null'));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  try {
                    const event = JSON.parse(data) as ProgressEvent | CompleteEvent | ErrorEvent;
                    
                    if (event.type === 'progress') {
                      onProgress(event);
                    } else if (event.type === 'complete') {
                      resolve({ routes: event.routes });
                      return;
                    } else if (event.type === 'error') {
                      reject(new Error(event.message));
                      return;
                    }
                  } catch (parseError) {
                    console.warn('Failed to parse SSE data:', data, parseError);
                  }
                }
              }
            }
          } catch (streamError) {
            reject(streamError);
          }
        })
        .catch(reject);
    });
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
