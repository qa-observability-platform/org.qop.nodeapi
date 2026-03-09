// src/types/roles.ts

export enum UserRole {
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

export type RoleScope = 'SYSTEM' | 'ORGANIZATION' | 'PROJECT';

export interface RoleAssignment {
  role: UserRole;
  scope: RoleScope;
  scopeId: string | null;
}
