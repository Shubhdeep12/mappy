/**
 * Vercel serverless entry — forwards all /api/* requests to the Express app.
 * Backend dist is included via vercel.json functions[].includeFiles; load from cwd at runtime.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const appPath = path.join(process.cwd(), 'packages/backend/dist/app.js');
  const { default: app } = await import(pathToFileURL(appPath).href);
  (app as NodeHandler)(req, res);
}
