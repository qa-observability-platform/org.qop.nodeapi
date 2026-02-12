// src/repositories/users.repository.ts
import { pool } from '../db/pool.js';
import type { User, UserWithRoles, RegisterInput } from '../types/auth.js';
import type { RoleAssignment, UserRole } from '../types/roles.js';

export interface CreateUserInput extends RegisterInput {
  passwordHash: string;
  emailVerificationToken?: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const result = await pool.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_email_verified: boolean;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        email_verification_token,
        email_verification_expires
      )
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
      RETURNING
        id,
        email,
        first_name,
        last_name,
        is_email_verified,
        is_active,
        last_login_at,
        created_at,
        updated_at
    `,
    [
      input.email,
      input.passwordHash,
      input.firstName ?? null,
      input.lastName ?? null,
      input.emailVerificationToken ?? null,
    ]
  );

  return mapUserRow(result.rows[0]);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_email_verified: boolean;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        email,
        first_name,
        last_name,
        is_email_verified,
        is_active,
        last_login_at,
        created_at,
        updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email]
  );

  return result.rows.length > 0 ? mapUserRow(result.rows[0]) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await pool.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_email_verified: boolean;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        email,
        first_name,
        last_name,
        is_email_verified,
        is_active,
        last_login_at,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows.length > 0 ? mapUserRow(result.rows[0]) : null;
}

export async function getUserPasswordHash(userId: string): Promise<string | null> {
  const result = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );

  return result.rows.length > 0 ? result.rows[0].password_hash : null;
}

export async function updateLastLogin(userId: string): Promise<void> {
  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [userId]
  );
}

export async function verifyUserEmail(token: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE users
      SET is_email_verified = true,
          email_verification_token = NULL,
          email_verification_expires = NULL
      WHERE email_verification_token = $1
        AND email_verification_expires > NOW()
        AND is_email_verified = false
    `,
    [token]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function setPasswordResetToken(
  email: string,
  token: string
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE users
      SET password_reset_token = $1,
          password_reset_expires = NOW() + INTERVAL '1 hour'
      WHERE email = $2
        AND is_active = true
    `,
    [token, email]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function resetPassword(
  token: string,
  newPasswordHash: string
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE users
      SET password_hash = $1,
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE password_reset_token = $2
        AND password_reset_expires > NOW()
    `,
    [newPasswordHash, token]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updatePassword(
  userId: string,
  newPasswordHash: string
): Promise<void> {
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [newPasswordHash, userId]
  );
}

export async function getUserRoles(userId: string): Promise<RoleAssignment[]> {
  const roles: RoleAssignment[] = [];

  // Get organization roles
  const orgRoles = await pool.query<{
    role: string;
    org_id: string;
  }>(
    `
      SELECT role, org_id
      FROM user_organizations
      WHERE user_id = $1
    `,
    [userId]
  );

  orgRoles.rows.forEach(row => {
    roles.push({
      role: row.role as UserRole,
      scope: 'ORGANIZATION',
      scopeId: row.org_id,
    });
  });

  // Get project roles
  const projectRoles = await pool.query<{
    role: string;
    project_id: string;
  }>(
    `
      SELECT role, project_id
      FROM user_projects
      WHERE user_id = $1
    `,
    [userId]
  );

  projectRoles.rows.forEach(row => {
    roles.push({
      role: row.role as UserRole,
      scope: 'PROJECT',
      scopeId: row.project_id,
    });
  });

  // Check if user is SYS_ADMIN (you can add a column to users table or check a special table)
  // For now, we'll check if user has a specific email pattern or a separate table
  // Placeholder: Check if user is in a sys_admins table (you'd create this)

  return roles;
}

export async function getUserWithRoles(userId: string): Promise<UserWithRoles | null> {
  const user = await findUserById(userId);
  if (!user) return null;

  const roles = await getUserRoles(userId);

  return {
    ...user,
    roles,
  };
}

export async function addUserToOrganization(
  userId: string,
  orgId: string,
  role: UserRole,
  invitedBy?: string
): Promise<void> {
  await pool.query(
    `
      INSERT INTO user_organizations (user_id, org_id, role, invited_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, org_id) DO UPDATE
      SET role = EXCLUDED.role
    `,
    [userId, orgId, role, invitedBy ?? null]
  );
}

export async function addUserToProject(
  userId: string,
  projectId: string,
  role: UserRole,
  invitedBy?: string
): Promise<void> {
  await pool.query(
    `
      INSERT INTO user_projects (user_id, project_id, role, invited_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, project_id) DO UPDATE
      SET role = EXCLUDED.role
    `,
    [userId, projectId, role, invitedBy ?? null]
  );
}

export async function removeUserFromOrganization(
  userId: string,
  orgId: string
): Promise<void> {
  await pool.query(
    'DELETE FROM user_organizations WHERE user_id = $1 AND org_id = $2',
    [userId, orgId]
  );
}

export async function removeUserFromProject(
  userId: string,
  projectId: string
): Promise<void> {
  await pool.query(
    'DELETE FROM user_projects WHERE user_id = $1 AND project_id = $2',
    [userId, projectId]
  );
}

export async function updateUserRole(
  userId: string,
  scope: 'ORGANIZATION' | 'PROJECT',
  scopeId: string,
  newRole: UserRole
): Promise<void> {
  if (scope === 'ORGANIZATION') {
    await pool.query(
      'UPDATE user_organizations SET role = $1 WHERE user_id = $2 AND org_id = $3',
      [newRole, userId, scopeId]
    );
  } else {
    await pool.query(
      'UPDATE user_projects SET role = $1 WHERE user_id = $2 AND project_id = $3',
      [newRole, userId, scopeId]
    );
  }
}

export async function getUserOrganizations(userId: string): Promise<{
  id: string;
  name: string;
  role: UserRole;
}[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    role: string;
  }>(
    `
      SELECT o.id, o.name, uo.role
      FROM organizations o
      JOIN user_organizations uo ON uo.org_id = o.id
      WHERE uo.user_id = $1
      ORDER BY o.name
    `,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    role: row.role as UserRole,
  }));
}

function mapUserRow(row: {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_email_verified: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    isEmailVerified: row.is_email_verified,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };



  
  
}

