// src/routes/apps.routes.ts
import type { Express, Request, Response } from 'express';
import { getAllApplications } from '../repositories/apps.repository.js';

/**
 * S1-US3: Applications listing
 * GET /apps -> { applications: [...] }
 */
export function registerAppsRoutes(app: Express) {
  app.get('/apps', async (_req: Request, res: Response) => {
    try {
      const apps = await getAllApplications();
      res.status(200).json({ applications: apps });
    } catch (error) {
      console.error('Error fetching applications:', error);
      res.status(500).json({ error: 'Failed to fetch applications' });
    }
  });
}
