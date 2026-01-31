/**
 * Shared package exports
 * 
 * This package contains:
 * - Core type definitions (Route, Preferences, POI, etc.)
 * - Common interfaces for providers (LLM, Maps)
 * - Validation schemas (Zod)
 * - Utility functions used across backend and frontend
 */

export * from './types';
export * from './providers';
export * from './validation';
export * from './utils/geometry';
export * from './constants';
