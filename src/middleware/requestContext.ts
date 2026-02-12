// src/middleware/requestContext.ts
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export interface RequestWithContext extends Request {
  requestId?: string;
  startedAt?: number;
}

export function requestContext(
  req: RequestWithContext,
  res: Response,
  next: NextFunction
) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  req.requestId = requestId;
  req.startedAt = startedAt;

  // Attach to res.locals for easy access if needed
  (res.locals as any).requestId = requestId;

  logger.info('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    logger.info('Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
