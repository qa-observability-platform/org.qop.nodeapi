// src/middleware/rbac.middleware.ts
/**
 * Role-Based Access Control (RBAC) Middleware
 * 
 * Purpose: Enforces permissions on API routes based on user roles
 * - Check if user has required permission for the action
 * - Validate scope (org-level or project-level)
 * - Return 403 Forbidden if unauthorized
 * 
 * Usage: Chain after authenticate middleware
 * Example: app.delete('/projects/:id', authenticate, requirePermission(Permission.PROJECT_DELETE), deleteProject)
 */

import type { Request, Response, NextFunction } from 'express';
import { Permission, hasPermission, hasRole, UserRole } from '../types/roles.js';
import type { RoleScope } from '../types/roles.js';

/**
 * Middleware factory to require a specific permission
 */
export function requirePermission(
  permission: Permission,
  scopeType: RoleScope = 'ORGANIZATION',
  getScopeId?: (req: Request) => string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Get scope ID from request (from params or query)
      let scopeId: string | undefined;
      if (getScopeId) {
        scopeId = getScopeId(req);
      } else if (scopeType === 'ORGANIZATION') {
        scopeId = req.params.orgId || req.query.orgId as string;
      } else if (scopeType === 'PROJECT') {
        scopeId = req.params.projectId || req.query.projectId as string;
      }

      // Check permission
      const authorized = hasPermission(
        req.user.roles,
        permission,
        scopeType,
        scopeId
      );

      if (!authorized) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to perform this action',
          required: permission,
        });
        return;
      }

      next();
    } catch (error: any) {
      console.error('[RBAC Middleware] Authorization check failed:', error.message);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

/**
 * Middleware factory to require a specific role
 */
export function requireRole(
  role: UserRole,
  scopeType: RoleScope = 'ORGANIZATION',
  getScopeId?: (req: Request) => string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      let scopeId: string | undefined;
      if (getScopeId) {
        scopeId = getScopeId(req);
      } else if (scopeType === 'ORGANIZATION') {
        scopeId = req.params.orgId || req.query.orgId as string;
      } else if (scopeType === 'PROJECT') {
        scopeId = req.params.projectId || req.query.projectId as string;
      }

      const authorized = hasRole(req.user.roles, role, scopeType, scopeId);

      if (!authorized) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This action requires ${role} role`,
          required: role,
        });
        return;
      }

      next();
    } catch (error: any) {
      console.error('[RBAC Middleware] Role check failed:', error.message);
      res.status(500).json({ error: 'Role check failed' });
    }
  };
}

/**
 * Middleware to require any of the specified roles
 */
export function requireAnyRole(roles: UserRole[], scopeType: RoleScope = 'ORGANIZATION') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const scopeId = scopeType === 'ORGANIZATION'
        ? req.params.orgId || req.query.orgId as string
        : req.params.projectId || req.query.projectId as string;

      const authorized = roles.some(role =>
        hasRole(req.user!.roles, role, scopeType, scopeId)
      );

      if (!authorized) {
        res.status(403).json({
          error: 'Forbidden',
          message: `This action requires one of these roles: ${roles.join(', ')}`,
          required: roles,
        });
        return;
      }

      next();
    } catch (error: any) {
      console.error('[RBAC Middleware] Role check failed:', error.message);
      res.status(500).json({ error: 'Role check failed' });
    }
  };
}

/**
 * Check if user belongs to organization (has any role in it)
 */
export function requireOrgMembership(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const orgId = req.params.orgId || req.query.orgId as string;
  if (!orgId) {
    res.status(400).json({ error: 'Organization ID required' });
    return;
  }

  const isMember = req.user.roles.some(
    r => r.scope === 'ORGANIZATION' && r.scopeId === orgId
  );

  if (!isMember) {
    res.status(403).json({ error: 'You are not a member of this organization' });
    return;
  }

  next();
}

/**
 * Check if user belongs to project (has any role in it)
 */
export function requireProjectMembership(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const projectId = req.params.projectId || req.query.projectId as string;
  if (!projectId) {
    res.status(400).json({ error: 'Project ID required' });
    return;
  }

  const isMember = req.user.roles.some(
    r => (r.scope === 'PROJECT' && r.scopeId === projectId) ||
         (r.scope === 'ORGANIZATION') // Org members can access all projects
  );

  if (!isMember) {
    res.status(403).json({ error: 'You do not have access to this project' });
    return;
  }

  next();
}