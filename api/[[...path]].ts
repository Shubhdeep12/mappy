/**
 * Vercel serverless entry — forwards all /api/* requests to the Express app.
 * Build (vercel.json) runs from repo root and builds shared + backend + frontend,
 * so packages/backend/dist/app.js exists when this runs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { default: app } = await import('../packages/backend/dist/app.js');
  app(req, res);
}
