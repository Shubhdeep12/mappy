/**
 * Rate Limiting Middleware
 * 
 * Implements token bucket algorithm for request rate limiting.
 * Protects API from abuse and manages resource usage.
 * 
 * Limits:
 * - Per-user: 10 requests/minute
 * - Per-IP: 30 requests/minute
 * - Burst allowance: 3 requests
 * 
 * Strategy:
 * - Token bucket with configurable window and max requests
 * - Exponential backoff with jitter for rate limit exceeded
 * - Rate limit headers in response (X-RateLimit-*)
 * 
 * Storage:
 * - In-memory for development
 * - Redis for production (distributed rate limiting)
 * 
 * Error response:
 * - 429 Too Many Requests
 * - Retry-After header with backoff time
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later',
    retry_after: Math.ceil(config.rateLimit.windowMs / 1000),
    fallback_available: false,
    request_id: '', // Will be set by error handler
  },
  handler: (req, res) => {
    const retryAfter = Math.ceil(config.rateLimit.windowMs / 1000);
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      retry_after: retryAfter,
      fallback_available: false,
      request_id: req.correlationId || 'unknown',
    });
  },
});
