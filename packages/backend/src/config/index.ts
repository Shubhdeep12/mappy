/**
 * Application Configuration
 * 
 * Loads and validates environment variables.
 * Provides typed configuration for:
 * - Environment mode (development/production)
 * - Free mode provider settings (Ollama endpoint, OSM endpoints)
 * - Server settings (port, host)
 * - Rate limiting configuration
 * - Cache settings
 * 
 * Note: API keys (Gemini, Google Maps) are no longer supported via env vars.
 * Users provide their own API keys via the UI for Premium Mode.
 * Free Mode (Ollama + OSM) is the default fallback.
 */

export interface AppConfig {
  env: 'development' | 'production';
  server: {
    port: number;
    host: string;
  };
  llm: {
    endpoint: string;
    model: string;
  };
  maps: {
    routing: string;
    geocoding: string;
    overpass: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    burstAllowance: number;
  };
  cache: {
    ttl: number;
    maxSize: number;
  };
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV as 'development' | 'production') || 'development';

  return {
    env,
    server: {
      port: parseInt(process.env.PORT || '8080', 10),
      host: process.env.HOST || 'localhost',
    },
    llm: {
      endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'gemma3:1b',
    },
    maps: {
      routing: process.env.OSRM_ENDPOINT || 'http://router.project-osrm.org',
      geocoding: process.env.NOMINATIM_ENDPOINT || 'https://nominatim.openstreetmap.org',
      overpass: process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter',
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10', 10),
      burstAllowance: parseInt(process.env.RATE_LIMIT_BURST || '3', 10),
    },
    cache: {
      ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
      maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
    },
  };
}

export const config = loadConfig();
