// src/repositories/organizations.repository.ts
import { pool } from '../db/pool.js';

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationWithStats extends Organization {
  projectCount: number;
  applicationCount: number;
  totalRuns: number;
}

/**
 * Find organization by ID
 */
export async function findOrganizationById(
  id: string
): Promise<Organization | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, name, created_at, updated_at
      FROM organizations
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows.length > 0 ? mapOrganizationRow(result.rows[0]) : null;
}

/**
 * List all organizations with stats
 */
export async function listOrganizations(): Promise<OrganizationWithStats[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    project_count: string;
    application_count: string;
    total_runs: string;
  }>(
    `
      SELECT
        o.id,
        o.name,
        o.created_at,
        o.updated_at,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT a.id) as application_count,
        COUNT(DISTINCT tr.id) as total_runs
      FROM organizations o
      LEFT JOIN projects p ON p.org_id = o.id
      LEFT JOIN applications a ON a.project_id = p.id
      LEFT JOIN test_runs tr ON tr.application_id = a.id
      GROUP BY o.id, o.created_at, o.updated_at
      ORDER BY o.name ASC
    `
  );

  return result.rows.map((row) => ({
    ...mapOrganizationRow(row),
    projectCount: parseInt(row.project_count, 10),
    applicationCount: parseInt(row.application_count, 10),
    totalRuns: parseInt(row.total_runs, 10),
  }));
}

function mapOrganizationRow(row: {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): Organization {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
