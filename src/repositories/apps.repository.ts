// src/repositories/apps.repository.ts
import { pool } from '../db/pool.js';

export interface Application {
  id: string;
  orgId: string;
  name: string;
  appKey: string;
}

/**
 * Fetch all applications.
 * Later we'll add org-based filtering once auth/RBAC is implemented.
 */
export async function getAllApplications(): Promise<Application[]> {
  const result = await pool.query<{
    id: string;
    org_id: string;
    name: string;
    app_key: string;
  }>(
    `
    SELECT id, org_id, name, app_key
    FROM applications
    ORDER BY name ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    appKey: row.app_key,
  }));
}
