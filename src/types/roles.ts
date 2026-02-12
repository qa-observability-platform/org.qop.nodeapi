// src/types/roles.ts

export enum UserRole {
  // System Level
  SYS_ADMIN = 'SYS_ADMIN',
  
  // Organization Level
  ORG_OWNER = 'ORG_OWNER',
  ORG_ADMIN = 'ORG_ADMIN',
  
  // Project Level
  PROJECT_ADMIN = 'PROJECT_ADMIN',
  PROJECT_MEMBER = 'PROJECT_MEMBER',
  QA_LEAD = 'QA_LEAD',
  DEVELOPER = 'DEVELOPER',
  
  // Read-Only
  VIEWER = 'VIEWER',
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.SYS_ADMIN]: 100,
  [UserRole.ORG_OWNER]: 90,
  [UserRole.ORG_ADMIN]: 80,
  [UserRole.PROJECT_ADMIN]: 70,
  [UserRole.QA_LEAD]: 60,
  [UserRole.PROJECT_MEMBER]: 50,
  [UserRole.DEVELOPER]: 40,
  [UserRole.VIEWER]: 10,
};

export enum Permission {
  // System
  SYSTEM_MANAGE_ALL = 'system:manage:all',
  
  // Organization
  ORG_DELETE = 'org:delete',
  ORG_UPDATE = 'org:update',
  ORG_MANAGE_BILLING = 'org:manage:billing',
  ORG_MANAGE_USERS = 'org:manage:users',
  ORG_VIEW = 'org:view',
  
  // Projects
  PROJECT_CREATE = 'project:create',
  PROJECT_DELETE = 'project:delete',
  PROJECT_UPDATE = 'project:update',
  PROJECT_VIEW = 'project:view',
  
  // Applications
  APP_CREATE = 'app:create',
  APP_DELETE = 'app:delete',
  APP_UPDATE = 'app:update',
  APP_VIEW = 'app:view',
  
  // API Keys
  API_KEY_CREATE = 'apikey:create',
  API_KEY_DELETE = 'apikey:delete',
  API_KEY_VIEW = 'apikey:view',
  
  // Test Runs
  RUN_TRIGGER = 'run:trigger',
  RUN_VIEW = 'run:view',
  RUN_DELETE = 'run:delete',
  
  // Analytics
  ANALYTICS_VIEW = 'analytics:view',
  ANALYTICS_EXPORT = 'analytics:export',
  
  // Users
  USER_INVITE = 'user:invite',
  USER_REMOVE = 'user:remove',
  USER_UPDATE_ROLE = 'user:update:role',
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SYS_ADMIN]: [Permission.SYSTEM_MANAGE_ALL],
  
  [UserRole.ORG_OWNER]: [
    Permission.ORG_DELETE,
    Permission.ORG_UPDATE,
    Permission.ORG_MANAGE_BILLING,
    Permission.ORG_MANAGE_USERS,
    Permission.ORG_VIEW,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_DELETE,
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_VIEW,
    Permission.APP_CREATE,
    Permission.APP_DELETE,
    Permission.APP_UPDATE,
    Permission.APP_VIEW,
    Permission.API_KEY_CREATE,
    Permission.API_KEY_DELETE,
    Permission.API_KEY_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.RUN_DELETE,
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
    Permission.USER_INVITE,
    Permission.USER_REMOVE,
    Permission.USER_UPDATE_ROLE,
  ],
  
  [UserRole.ORG_ADMIN]: [
    Permission.ORG_UPDATE,
    Permission.ORG_MANAGE_USERS,
    Permission.ORG_VIEW,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_DELETE,
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_VIEW,
    Permission.APP_CREATE,
    Permission.APP_DELETE,
    Permission.APP_UPDATE,
    Permission.APP_VIEW,
    Permission.API_KEY_CREATE,
    Permission.API_KEY_DELETE,
    Permission.API_KEY_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
    Permission.USER_INVITE,
    Permission.USER_REMOVE,
  ],
  
  [UserRole.PROJECT_ADMIN]: [
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_VIEW,
    Permission.APP_CREATE,
    Permission.APP_DELETE,
    Permission.APP_UPDATE,
    Permission.APP_VIEW,
    Permission.API_KEY_CREATE,
    Permission.API_KEY_DELETE,
    Permission.API_KEY_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
    Permission.USER_INVITE,
  ],
  
  [UserRole.QA_LEAD]: [
    Permission.PROJECT_VIEW,
    Permission.APP_UPDATE,
    Permission.APP_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
  ],
  
  [UserRole.PROJECT_MEMBER]: [
    Permission.PROJECT_VIEW,
    Permission.APP_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
  ],
  
  [UserRole.DEVELOPER]: [
    Permission.PROJECT_VIEW,
    Permission.APP_VIEW,
    Permission.RUN_TRIGGER,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
    Permission.API_KEY_VIEW,
  ],
  
  [UserRole.VIEWER]: [
    Permission.PROJECT_VIEW,
    Permission.APP_VIEW,
    Permission.RUN_VIEW,
    Permission.ANALYTICS_VIEW,
  ],
};

export type RoleScope = 'SYSTEM' | 'ORGANIZATION' | 'PROJECT';

export interface RoleAssignment {
  role: UserRole;
  scope: RoleScope;
  scopeId: string | null;
}

export const ORGANIZATION_ROLES = [
  UserRole.ORG_OWNER,
  UserRole.ORG_ADMIN,
];

export const PROJECT_ROLES = [
  UserRole.PROJECT_ADMIN,
  UserRole.PROJECT_MEMBER,
  UserRole.QA_LEAD,
  UserRole.DEVELOPER,
  UserRole.VIEWER,
];

export function hasPermission(
  userRoles: RoleAssignment[],
  requiredPermission: Permission,
  scope: RoleScope,
  scopeId?: string
): boolean {
  // SYS_ADMIN has all permissions
  if (userRoles.some(r => r.role === UserRole.SYS_ADMIN)) {
    return true;
  }

  // Find relevant roles for the scope
  const relevantRoles = userRoles.filter(r => {
    if (r.scope === 'SYSTEM') return true;
    if (scope === 'ORGANIZATION' && r.scope === 'ORGANIZATION' && r.scopeId === scopeId) return true;
    if (scope === 'PROJECT' && r.scope === 'PROJECT' && r.scopeId === scopeId) return true;
    // Organization roles inherit to all projects within that org
    if (scope === 'PROJECT' && r.scope === 'ORGANIZATION') return true;
    return false;
  });

  // Check if any relevant role has the required permission
  return relevantRoles.some(roleAssignment => {
    const permissions = ROLE_PERMISSIONS[roleAssignment.role];
    return permissions.includes(requiredPermission);
  });
}

export function hasRole(
  userRoles: RoleAssignment[],
  requiredRole: UserRole,
  scope: RoleScope,
  scopeId?: string
): boolean {
  return userRoles.some(r => {
    if (r.role === requiredRole) {
      if (scope === 'SYSTEM') return r.scope === 'SYSTEM';
      if (scope === 'ORGANIZATION') return r.scope === 'ORGANIZATION' && r.scopeId === scopeId;
      if (scope === 'PROJECT') return r.scope === 'PROJECT' && r.scopeId === scopeId;
    }
    return false;
  });
}