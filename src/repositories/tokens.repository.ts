// src/repositories/tokens.repository.ts
/**
 * Refresh Tokens Repository
 * 
 * Purpose: Manages refresh token lifecycle in database
 * - Create new refresh tokens
 * - Validate refresh tokens
 * - Revoke tokens on logout
 * - Clean up expired tokens
 * 
 * Why: Refresh tokens need persistence for security
 */

import { pool } from '../db/pool.js';

export interface RefreshToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Create a new refresh token
 * Expires in 7 days by default
 */
export async function createRefreshToken(
  userId: string,
  token: string,
  expiresInDays: number = 7
): Promise<RefreshToken> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    token: string;
    expires_at: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '${expiresInDays} days')
      RETURNING id, user_id, token, expires_at, created_at, revoked_at
    `,
    [userId, token]
  );

  return mapTokenRow(result.rows[0]);
}

/**
 * Find a valid (not expired, not revoked) refresh token
 */
export async function findValidRefreshToken(
  token: string
): Promise<RefreshToken | null> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    token: string;
    expires_at: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `
      SELECT id, user_id, token, expires_at, created_at, revoked_at
      FROM refresh_tokens
      WHERE token = $1
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1
    `,
    [token]
  );

  return result.rows.length > 0 ? mapTokenRow(result.rows[0]) : null;
}

/**
 * Revoke a refresh token (used on logout or token refresh)
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token = $1 AND revoked_at IS NULL
    `,
    [token]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Revoke all refresh tokens for a user (used when password changes)
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await pool.query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
    `,
    [userId]
  );
}

/**
 * Clean up expired tokens (run as a scheduled job)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await pool.query(
    'DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL \'30 days\''
  );

  return result.rowCount ?? 0;
}

function mapTokenRow(row: {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}