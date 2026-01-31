/**
 * Error Handling Middleware
 * 
 * Centralized error handling for Express routes.
 * Transforms errors into standardized ErrorResponse format.
 * 
 * Error classification:
 * - RECOVERABLE: Can retry or fallback
 * - DEGRADED: Partial functionality available
 * - FATAL: Cannot proceed
 * 
 * Error response format:
 * - code: Machine-readable error code
 * - message: Human-readable message
 * - retry_after: Optional retry delay (seconds)
 * - fallback_available: Whether fallback exists
 * - request_id: Correlation ID for debugging
 * 
 * Logging:
 * - Structured logging with error context
 * - Request correlation ID tracking
 * - Error metrics collection
 */

import type { Request, Response, NextFunction } from 'express';
import { sanitizeForLog } from '../utils/sanitize';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  retryAfter?: number;
  fallbackAvailable?: boolean;
}

export function errorHandler(
  err: AppError | Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId || 'unknown';

  // Log error (message/stack sanitized so API keys are never written to logs)
  console.error(JSON.stringify({
    type: 'error',
    correlationId,
    error: {
      name: err.name,
      message: sanitizeForLog(err.message),
      stack: process.env.NODE_ENV === 'development' ? sanitizeForLog(err.stack) : undefined,
    },
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  }));

  // Determine status code
  const statusCode = (err as AppError).statusCode || 500;

  // Build error response
  const errorResponse = {
    code: (err as AppError).code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred',
    retry_after: (err as AppError).retryAfter,
    fallback_available: (err as AppError).fallbackAvailable || false,
    request_id: correlationId,
  };

  res.status(statusCode).json(errorResponse);
}

// Helper to create AppError
export function createError(
  message: string,
  statusCode: number = 500,
  options?: {
    code?: string;
    retryAfter?: number;
    fallbackAvailable?: boolean;
  }
): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = options?.code || 'INTERNAL_SERVER_ERROR';
  error.retryAfter = options?.retryAfter;
  error.fallbackAvailable = options?.fallbackAvailable || false;
  return error;
}
