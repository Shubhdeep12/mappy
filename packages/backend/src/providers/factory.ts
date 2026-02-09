/** Picks LLM and Maps providers from request API keys or fallback. */

import type { LLMProvider } from './llm/interface.js';
import type { MapsProvider } from './maps/interface.js';
import { OllamaProvider } from './llm/ollama.js';
import { OSMProvider } from './maps/osm.js';
import { config } from '../config/index.js';

export class ProviderFactory {
  static async createLLMProvider(apiKey?: string): Promise<LLMProvider> {
    if (apiKey) {
      const { GeminiProvider } = await import('./llm/gemini.js');
      return new GeminiProvider(apiKey, process.env.GEMINI_MODEL || 'gemini-3-flash-preview');
    }

    return new OllamaProvider(
      config.llm.endpoint,
      config.llm.model
    );
  }

  static async createMapsProvider(apiKey?: string): Promise<MapsProvider> {
    if (apiKey) {
      const { GoogleMapsProvider } = await import('./maps/google.js');
      return new GoogleMapsProvider(apiKey);
    }

    return new OSMProvider(
      config.maps.routing,
      config.maps.overpass,
      config.maps.geocoding
    );
  }
}
