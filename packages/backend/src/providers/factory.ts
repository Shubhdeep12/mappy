/**
 * Provider Factory
 * 
 * Creates provider instances based on user-provided API keys or free mode fallback.
 * Implements the factory pattern for provider abstraction.
 * 
 * Logic:
 * - If user provides API keys → use Gemini + Google Maps
 * - If no user keys → use Ollama + OSM (Free Mode)
 * 
 * No environment variable API keys - users manage their own keys via UI.
 */

import type { LLMProvider } from './llm/interface';
import type { MapsProvider } from './maps/interface';
import { OllamaProvider } from './llm/ollama';
import { OSMProvider } from './maps/osm';
import { config } from '../config';

export class ProviderFactory {
  /**
   * Create LLM provider based on user-provided API key or free mode fallback
   */
  static async createLLMProvider(apiKey?: string): Promise<LLMProvider> {
    if (apiKey) {
      const { GeminiProvider } = await import('./llm/gemini');
      return new GeminiProvider(apiKey, process.env.GEMINI_MODEL || 'gemini-3-flash-preview');
    }

    return new OllamaProvider(
      config.llm.endpoint,
      config.llm.model
    );
  }

  /**
   * Create Maps provider based on user-provided API key
   */
  static async createMapsProvider(apiKey?: string): Promise<MapsProvider> {
    if (apiKey) {
      const { GoogleMapsProvider } = await import('./maps/google');
      return new GoogleMapsProvider(apiKey);
    }

    return new OSMProvider(
      config.maps.routing,
      config.maps.overpass,
      config.maps.geocoding
    );
  }
}
