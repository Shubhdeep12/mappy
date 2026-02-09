import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

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
