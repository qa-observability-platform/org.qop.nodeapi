// src/app.ts
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerReadyRoutes } from './routes/ready.routes.js';
import { registerAppsRoutes } from './routes/apps.routes.js';
import { registerIngestRoutes } from './routes/ingest.routes.js';
import { registerRunsRoutes } from './routes/runs.routes.js';
import { registerProjectsRoutes } from './routes/projects.routes.js';
import { registerApplicationsRoutes } from './routes/applications.routes.js';
import { registerOrganizationsRoutes } from './routes/organizations.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerInvitationsRoutes } from './routes/invitations.routes.js';
import { registerUsersRoutes } from './routes/users.routes.js';
import { registerFlakyTestsRoutes } from './routes/flakyTests.routes.js';
import screenshotsRouter from './routes/screenshots.routes.js';
import patternLearningRouter from './routes/patternLearning.routes.js';
import patternLearningJobsRouter from './routes/patternLearningJobs.routes.js';
import comparativeAnalysisRouter from './routes/comparativeAnalysis.routes.js';
import comparisonHistoryRouter from './routes/comparisonHistory.routes.js';
import { requestContext, type RequestWithContext } from './middleware/requestContext.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  // CRITICAL: Enable CORS FIRST before any other middleware
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or same-origin)
      if (!origin) return callback(null, true);

      // Allow all origins in development
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'Pragma',
      'Expires',
      'X-Requested-With',
      'Accept'
    ],
    exposedHeaders: ['Cache-Control', 'Pragma', 'Expires'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
  }));

  app.use(express.json());
  app.use(requestContext);

  // Health checks (no auth required)
  registerHealthRoutes(app);
  registerReadyRoutes(app);

  // Authentication routes (no auth required for login/register)
  registerAuthRoutes(app);

  // Invitation routes (mixed - some require auth, some don't)
  registerInvitationsRoutes(app);

  // Legacy/automation routes (uses API key auth, not JWT)
  registerAppsRoutes(app);
  registerIngestRoutes(app);

  // Screenshot routes (uses API key auth for uploads, public for viewing)
  app.use('/api/screenshots', screenshotsRouter);

  // Pattern learning routes (analytics dashboard)
  app.use('/api/pattern-learning', patternLearningRouter);

  // Pattern learning jobs (manual triggers - replaces cron jobs)
  app.use('/api/pattern-learning-jobs', patternLearningJobsRouter);

  // Comparative analysis routes (compare test runs)
  app.use('/api/comparative-analysis', comparativeAnalysisRouter);

  // Comparison history routes (track and manage comparisons)
  app.use('/api/comparison-history', comparisonHistoryRouter);

  // Protected routes (require JWT auth)
  registerOrganizationsRoutes(app);
  registerProjectsRoutes(app);
  registerApplicationsRoutes(app);
  registerRunsRoutes(app);
  registerUsersRoutes(app);
  registerFlakyTestsRoutes(app);

  // Error handler
  app.use(
    (err: any, req: Request, res: Response, _next: NextFunction) => {
      const reqWithCtx = req as RequestWithContext;
      logger.error('Unhandled error in NodeAPI', {
        requestId: reqWithCtx.requestId,
        error: err?.message ?? String(err),
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  );

  return app;
}