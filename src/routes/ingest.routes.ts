// src/routes/ingest.routes.ts
import { Router, type Express, type Request, type Response } from 'express';
import {
  automationAuth,
  type AutomationRequest,
} from '../middleware/automationAuth.js';
import { createTestRun } from '../repositories/testRuns.repository.js';

/**
 * Register ingest routes, protected by API key auth.
 */
export function registerIngestRoutes(app: Express) {
  const router = Router();

  /**
   * POST /ingest/test-runs
   * Body:
   * {
   *   "runId": "ci-1234",
   *   "status": "running",
   *   "branch": "main",
   *   "commitSha": "abc123",
   *   "ciBuildNumber": "123",
   *   "environment": "staging"
   * }
   *
   * Requires: x-api-key header
   */
  router.post(
    '/test-runs',
    automationAuth,
    async (req: AutomationRequest, res: Response) => {
      try {
        if (!req.application) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const {
          runId,
          status,
          branch,
          commitSha,
          ciBuildNumber,
          environment,
        } = req.body as {
          runId?: string;
          status?: string;
          branch?: string;
          commitSha?: string;
          ciBuildNumber?: string;
          environment?: string;
        };

        if (!runId || !status) {
          return res.status(400).json({
            error: 'Missing required fields: runId, status',
          });
        }

        const testRun = await createTestRun({
          applicationId: req.application.applicationId,
          runId,
          status,
          branch,
          commitSha,
          ciBuildNumber,
          environment,
        });

        return res.status(201).json({ testRun });
      } catch (error) {
        console.error('Error creating test run:', error);
        return res.status(500).json({
          error: 'Failed to create test run',
        });
      }
    }
  );

  // Mount under /ingest
  app.use('/ingest', router);
}
