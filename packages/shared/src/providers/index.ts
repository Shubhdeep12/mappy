/**
 * Provider interfaces for abstraction layer
 * 
 * This module defines interfaces for:
 * - LLM Provider: Abstract interface for language models (Ollama, Gemini)
 * - Maps Provider: Abstract interface for mapping services (OSM, Google Maps)
 * 
 * Implementations live in packages/backend/src/providers/
 * Application code uses these interfaces, never concrete implementations
 */

export * from './llm';
export * from './maps';
