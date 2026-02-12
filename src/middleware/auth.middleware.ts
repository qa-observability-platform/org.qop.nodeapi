// src/middleware/auth.middleware.ts
/**
 * Authentication Middleware
 * 
 * Purpose: Validates JWT tokens on protected routes
 * - Extract token from Authorization header
 * - Verify JWT signature and expiration
 * - Attach user data to request object
 * - Return 401 if token is invalid
 * 
 * Usage: Add to any route that requires authentication
 * Example: app.get('/api/projects', authenticate, getProjects)
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/auth.service.js';
import type { JwtPayload } from '../types/auth.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware to authenticate requests using JWT
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const payload = verifyAccessToken(token);

    // Attach user to request
    req.user = payload;

    next();
  } catch (error: any) {
    console.error('[Auth Middleware] Authentication failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional authentication - doesn't fail if no token provided
 * Useful for routes that work differently for authenticated vs anonymous users
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyAccessToken(token);
      req.user = payload;
    }
    next();
  } catch (error) {
    // Ignore authentication errors for optional auth
    next();
  }
}