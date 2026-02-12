// src/repositories/apiKeys.repository.ts
import { pool } from '../db/pool.js';
import { hashApiKey } from '../utils/apiKey.js';

export interface ResolvedApplication {
  applicationId: string;
  orgId: string;
  appKey: string;
  applicationName: string;
}

/**
 * Given a raw API key, hash it and resolve the linked application.
 */
export async function findApplicationByApiKey(
  rawKey: string
): Promise<ResolvedApplication | null> {
  const keyHash = hashApiKey(rawKey);

  const result = await pool.query<{
    application_id: string;
    org_id: string;
    app_key: string;
    application_name: string;
  }>(
    `
      SELECT
        aak.application_id,
        apps.org_id,
        apps.app_key,
        apps.name AS application_name
      FROM application_api_keys aak
      JOIN applications apps ON apps.id = aak.application_id
      WHERE aak.key_hash = $1
        AND aak.revoked_at IS NULL
      LIMIT 1
    `,
    [keyHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    applicationId: row.application_id,
    orgId: row.org_id,
    appKey: row.app_key,
    applicationName: row.application_name,
  };
}

/**
 * Update last_used_at when an API key is used.
 */
export async function markApiKeyUsed(
  rawKey: string
): Promise<void> {
  const keyHash = hashApiKey(rawKey);

  await pool.query(
    `
      UPDATE application_api_keys
      SET last_used_at = NOW()
      WHERE key_hash = $1
    `,
    [keyHash]
  );
}
