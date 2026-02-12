// src/routes/ready.routes.ts
import type { Express, Request, Response } from 'express';
import { dbPing } from '../db/pool.js';

/**
 * Readiness endpoint: checks DB connectivity.
 * - 200 when DB is reachable
 * - 503 when DB check fails
 */
export function registerReadyRoutes(app: Express) {
  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      await dbPing();
      res.status(200).json({ status: 'ready', db: 'ok' });
    } catch (error) {
      console.error('Readiness check failed:', error);
      res.status(503).json({ status: 'unhealthy', db: 'error' });
    }
  });
}
