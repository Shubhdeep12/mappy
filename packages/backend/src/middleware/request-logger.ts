/**
 * Request Logging Middleware
 * 
 * Structured logging for all incoming requests.
 * Generates correlation IDs and logs request/response lifecycle.
 * 
 * Logs:
 * - Request: method, path, query (body is never logged to protect API keys)
 * - Response: status, duration
 * - Errors: stack traces, context
 * 
 * Correlation ID:
 * - Generated per request (UUID)
 * - Included in response headers (X-Request-ID)
 * - Propagated to all downstream services
 * - Used for distributed tracing
 * 
 * Format: JSON structured logs for log aggregation
 * Tools: Compatible with Cloud Logging, Datadog, etc.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

// Extend Express Request to include correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      startTime?: number;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Generate correlation ID
  const correlationId = req.headers['x-request-id'] as string || randomUUID();
  req.correlationId = correlationId;
  req.startTime = Date.now();

  // Set correlation ID in response header
  res.setHeader('X-Request-ID', correlationId);

  // Log request
  console.log(JSON.stringify({
    type: 'request',
    correlationId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString(),
  }));

  // Log response when finished
  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    
    console.log(JSON.stringify({
      type: 'response',
      correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    }));
  });

  next();
}
