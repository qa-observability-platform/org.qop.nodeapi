// src/repositories/projectApiKeys.repository.ts
import { pool } from '../db/pool.js';
import crypto from 'crypto';

export interface ProjectApiKey {
  id: string;
  projectId: string;
  keyHash: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface ProjectWithApiKey {
  projectId: string;
  projectKey: string;
  projectName: string;
  orgId: string;
}

/**
 * Generate a secure API key
 */
export function generateApiKey(): string {
  return `qop_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Create a new API key for a project
 */
export async function createApiKey(
  projectId: string,
  label: string
): Promise<{ apiKey: ProjectApiKey; plainKey: string }> {
  const plainKey = generateApiKey();
  const keyHash = hashApiKey(plainKey);

  const result = await pool.query<{
    id: string;
    project_id: string;
    key_hash: string;
    label: string;
    created_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
  }>(
    `
      INSERT INTO project_api_keys (project_id, key_hash, label)
      VALUES ($1, $2, $3)
      RETURNING
        id,
        project_id,
        key_hash,
        label,
        created_at,
        revoked_at,
        last_used_at
    `,
    [projectId, keyHash, label]
  );

  return {
    apiKey: mapApiKeyRow(result.rows[0]),
    plainKey,
  };
}

/**
 * Find project by API key (validates and returns project context)
 */
export async function findProjectByApiKey(
  apiKey: string
): Promise<ProjectWithApiKey | null> {
  const keyHash = hashApiKey(apiKey);

  const result = await pool.query<{
    project_id: string;
    project_key: string;
    project_name: string;
    org_id: string;
  }>(
    `
      SELECT
        p.id as project_id,
        p.project_key,
        p.name as project_name,
        p.org_id
      FROM project_api_keys pak
      JOIN projects p ON p.id = pak.project_id
      WHERE pak.key_hash = $1
        AND pak.revoked_at IS NULL
      LIMIT 1
    `,
    [keyHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  // Update last_used_at
  await pool.query(
    'UPDATE project_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = $1',
    [keyHash]
  );

  return {
    projectId: result.rows[0].project_id,
    projectKey: result.rows[0].project_key,
    projectName: result.rows[0].project_name,
    orgId: result.rows[0].org_id,
  };
}

/**
 * List all API keys for a project
 */
export async function listApiKeysByProject(
  projectId: string
): Promise<ProjectApiKey[]> {
  const result = await pool.query<{
    id: string;
    project_id: string;
    key_hash: string;
    label: string;
    created_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
  }>(
    `
      SELECT
        id,
        project_id,
        key_hash,
        label,
        created_at,
        revoked_at,
        last_used_at
      FROM project_api_keys
      WHERE project_id = $1
      ORDER BY created_at DESC
    `,
    [projectId]
  );

  return result.rows.map(mapApiKeyRow);
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(id: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE project_api_keys
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND revoked_at IS NULL
    `,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete an API key permanently
 */
export async function deleteApiKey(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM project_api_keys WHERE id = $1', [
    id,
  ]);

  return (result.rowCount ?? 0) > 0;
}

function mapApiKeyRow(row: {
  id: string;
  project_id: string;
  key_hash: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}): ProjectApiKey {
  return {
    id: row.id,
    projectId: row.project_id,
    keyHash: row.key_hash,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}