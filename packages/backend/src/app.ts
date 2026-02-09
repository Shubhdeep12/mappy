/**
 * Express app — routes, middleware, and handler setup.
 * packages/backend/src/index.ts imports this and calls listen() to run the server.
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './middleware/request-logger.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';
import apiRoutes from './api/routes.js';

const app: Express = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(requestLogger);
app.use('/api', rateLimiter);
app.use('/api', apiRoutes);

app.get('/', (_req, res) => {
  res.json({
    name: 'Mappy API',
    version: '0.1.0',
    status: 'operational',
  });
});

app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
    fallback_available: false,
    request_id: req.correlationId || 'unknown',
  });
});

app.use(errorHandler);

export default app;
