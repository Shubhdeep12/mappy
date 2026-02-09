/**
 * Shared package exports
 * 
 * This package contains:
 * - Core type definitions (Route, Preferences, POI, etc.)
 * - Common interfaces for providers (LLM, Maps)
 * - Validation schemas (Zod)
 * - Utility functions used across backend and frontend
 */

export * from './types/index.js';
export * from './providers/index.js';
export * from './validation/index.js';
export * from './utils/geometry.js';
export * from './constants/index.js';
