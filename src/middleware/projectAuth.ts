// src/middleware/projectAuth.ts
import type { Request, Response, NextFunction } from 'express';
import { findProjectByApiKey } from '../repositories/projectApiKeys.repository.js';

export interface ProjectContext {
  projectId: string;
  projectKey: string;
  projectName: string;
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      projectContext?: ProjectContext;
    }
  }
}

/**
 * Middleware to validate project-scoped API keys
 * Attaches project context to request
 */
export async function validateProjectApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string || req.query.apiKey as string;

    if (!apiKey) {
      res.status(401).json({ error: 'API key required' });
      return;
    }

    const project = await findProjectByApiKey(apiKey);

    if (!project) {
      res.status(401).json({ error: 'Invalid or revoked API key' });
      return;
    }

    // Attach project context to request
    req.projectContext = {
      projectId: project.projectId,
      projectKey: project.projectKey,
      projectName: project.projectName,
      orgId: project.orgId,
    };

    next();
  } catch (error) {
    console.error('Project auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}