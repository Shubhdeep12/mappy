/**
 * API Routes
 * 
 * Express router configuration for all API endpoints.
 * 
 * Endpoints:
 * - POST /api/generate: Main route generation endpoint
 * - GET /api/health: Health check for all providers
 * - GET /api/status: System status and metrics
 * 
 * Request validation:
 * - Zod schema validation for RouteGenerationRequest
 * - Input sanitization
 * - Coordinate bounds checking
 * 
 * Provider injection:
 * - Accepts optional API keys in request body
 * - Creates providers via ProviderFactory
 * - Falls back to config-based providers
 * 
 * Response format:
 * - Success: GeneratedRoute JSON
 * - Error: ErrorResponse JSON with details
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { RouteGenerationRequestSchema } from '@mappy/shared';
import { ProviderFactory } from '../providers/factory';
import { createError } from '../middleware/error-handler';
import { RouteOrchestrator } from '../services/orchestrator';
import { formatErrorResponse } from '../utils/user-friendly-errors';

const router: Router = Router();

// Health check endpoint
router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const llm = await ProviderFactory.createLLMProvider();
    const maps = await ProviderFactory.createMapsProvider();

    const [llmHealthy, mapsHealthy] = await Promise.all([
      llm.healthCheck(),
      maps.healthCheck(),
    ]);

    const healthy = llmHealthy && mapsHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      providers: {
        llm: llmHealthy ? 'healthy' : 'unhealthy',
        maps: mapsHealthy ? 'healthy' : 'unhealthy',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// Status endpoint
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'operational',
    version: '0.1.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Route generation endpoint with SSE support
router.post('/generate', async (req, res, next) => {
  let llm: Awaited<ReturnType<typeof ProviderFactory.createLLMProvider>> | undefined;
  let maps: Awaited<ReturnType<typeof ProviderFactory.createMapsProvider>> | undefined;
  
  // Check if client wants streaming (SSE)
  const acceptHeader = req.headers.accept || '';
  const wantsStream = acceptHeader.includes('text/event-stream');
  
  try {
    // Validate request
    const validationResult = RouteGenerationRequestSchema.safeParse({
      ...req.body,
      requestId: req.body.requestId || req.correlationId || randomUUID(),
      timestamp: req.body.timestamp || new Date().toISOString(),
    });

    if (!validationResult.success) {
      throw createError(
        `Invalid request data: ${validationResult.error.issues.map((e) => e.message).join(', ')}`,
        400,
        {
          code: 'VALIDATION_ERROR',
          fallbackAvailable: false,
        }
      );
    }

    const { preferences, location, apiKeys, context } = validationResult.data;

    // Setup SSE if requested
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }

    const sendProgress = (step: string, message: string, progress?: number) => {
      if (wantsStream) {
        res.write(`data: ${JSON.stringify({ type: 'progress', step, message, progress })}\n\n`);
      }
    };

    sendProgress('init', 'Initializing providers...', 5);

    try {
      llm = await ProviderFactory.createLLMProvider(apiKeys?.gemini);
      maps = await ProviderFactory.createMapsProvider(apiKeys?.googleMaps);
    } catch (providerError) {
      throw createError(
        providerError instanceof Error ? providerError.message : 'Provider initialization failed',
        503,
        {
          code: 'PROVIDER_ERROR',
          fallbackAvailable: false,
        }
      );
    }

    sendProgress('health_check', 'Checking provider connectivity...', 10);

    // Health check providers
    const [llmHealthy, mapsHealthy] = await Promise.all([
      llm.healthCheck(),
      maps.healthCheck(),
    ]);

    if (!llmHealthy || !mapsHealthy) {
      const issues = [];
      if (!llmHealthy) issues.push('LLM provider');
      if (!mapsHealthy) issues.push('Maps provider');

      throw createError(
        `Provider(s) unavailable: ${issues.join(', ')}. Please check your configuration and network connectivity.`,
        503,
        {
          code: 'PROVIDER_UNAVAILABLE',
          fallbackAvailable: false,
        }
      );
    }

    const isAdvancedModel = !!apiKeys?.gemini;
    const orchestrator = new RouteOrchestrator(llm, maps, isAdvancedModel);

    try {
      const routes = await orchestrator.generateRoute(
        preferences,
        location,
        context,
        wantsStream ? sendProgress : undefined
      );

      if (wantsStream) {
        res.write(`data: ${JSON.stringify({ type: 'complete', routes })}\n\n`);
        res.end();
      } else {
        res.json({ routes });
      }
    } catch (orchestratorError) {
      throw createError(
        orchestratorError instanceof Error ? orchestratorError.message : 'Route generation failed',
        500,
        {
          code: 'ROUTE_GENERATION_FAILED',
          fallbackAvailable: false,
        }
      );
    }
  } catch (error) {
    if (wantsStream && !res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    
    const friendlyError = formatErrorResponse(error);
    
    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ type: 'error', ...friendlyError })}\n\n`);
      res.end();
    } else {
      next(error);
    }
  } finally {
    // Do not retain provider instances (they hold user API keys). Release references
    // so they can be GC'd; we never store or reuse them after the request.
    llm = undefined;
    maps = undefined;
  }
});

export default router;
