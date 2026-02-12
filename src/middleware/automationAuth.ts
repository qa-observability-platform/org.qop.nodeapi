// src/middleware/automationAuth.ts
import type { NextFunction, Request, Response } from 'express';
import {
  findApplicationByApiKey,
  markApiKeyUsed,
  type ResolvedApplication,
} from '../repositories/apiKeys.repository.js';

export interface AutomationRequest extends Request {
  application?: ResolvedApplication;
}

/**
 * Middleware to authenticate automation clients via x-api-key.
 */
export async function automationAuth(
  req: AutomationRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const headerKey =
      req.header('x-api-key') ||
      req.header('X-API-Key') ||
      null;

    if (!headerKey) {
      return res.status(401).json({
        error: 'Missing API key',
      });
    }

    const resolved = await findApplicationByApiKey(headerKey);
    if (!resolved) {
      return res.status(401).json({
        error: 'Invalid API key',
      });
    }

    // Attach application context to request
    req.application = resolved;

    // Fire-and-forget last_used_at update
    void markApiKeyUsed(headerKey).catch((err) => {
      console.error('Failed to mark API key usage:', err);
    });

    return next();
  } catch (err) {
    console.error('automationAuth error:', err);
    return res.status(500).json({
      error: 'Failed to authenticate API key',
    });
  }
}
