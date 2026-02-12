// src/routes/health.routes.ts
import { Express, Request, Response } from 'express';

export function registerHealthRoutes(app: Express) {
  /**
   * S1-US2: Health endpoint
   * AC: GET /health -> 200 + { status: 'ok' }
   * Must be lightweight (no DB calls).
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });
}
