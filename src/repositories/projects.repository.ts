// src/repositories/projects.repository.ts
import { pool } from '../db/pool.js';

export interface Project {
  id: string;
  orgId: string;
  projectKey: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  orgId: string;
  projectKey: string;
  name: string;
  description?: string;
  repoUrl?: string;
  defaultBranch?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  repoUrl?: string;
  defaultBranch?: string;
}

export interface ProjectWithStats extends Project {
  applicationCount: number;
  totalRuns: number;
  lastRunAt: string | null;
}

/**
 * Create a new project
 */
export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const result = await pool.query<{
    id: string;
    org_id: string;
    project_key: string;
    name: string;
    description: string | null;
    repo_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO projects (
        org_id,
        project_key,
        name,
        description,
        repo_url,
        default_branch
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        org_id,
        project_key,
        name,
        description,
        repo_url,
        default_branch,
        created_at,
        updated_at
    `,
    [
      input.orgId,
      input.projectKey,
      input.name,
      input.description ?? null,
      input.repoUrl ?? null,
      input.defaultBranch ?? 'main',
    ]
  );

  return mapProjectRow(result.rows[0]);
}

/**
 * Find project by org and project key
 */
export async function findProjectByKey(
  orgId: string,
  projectKey: string
): Promise<Project | null> {
  const result = await pool.query<{
    id: string;
    org_id: string;
    project_key: string;
    name: string;
    description: string | null;
    repo_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        org_id,
        project_key,
        name,
        description,
        repo_url,
        default_branch,
        created_at,
        updated_at
      FROM projects
      WHERE org_id = $1 AND project_key = $2
      LIMIT 1
    `,
    [orgId, projectKey]
  );

  return result.rows.length > 0 ? mapProjectRow(result.rows[0]) : null;
}

/**
 * Find project by ID
 */
export async function findProjectById(id: string): Promise<Project | null> {
  const result = await pool.query<{
    id: string;
    org_id: string;
    project_key: string;
    name: string;
    description: string | null;
    repo_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        org_id,
        project_key,
        name,
        description,
        repo_url,
        default_branch,
        created_at,
        updated_at
      FROM projects
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows.length > 0 ? mapProjectRow(result.rows[0]) : null;
}

/**
 * List all projects for an organization with stats
 */
export async function listProjectsByOrg(
  orgId: string
): Promise<ProjectWithStats[]> {
  const result = await pool.query<{
    id: string;
    org_id: string;
    project_key: string;
    name: string;
    description: string | null;
    repo_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
    application_count: string;
    total_runs: string;
    last_run_at: string | null;
  }>(
    `
      SELECT
        p.id,
        p.org_id,
        p.project_key,
        p.name,
        p.description,
        p.repo_url,
        p.default_branch,
        p.created_at,
        p.updated_at,
        COUNT(DISTINCT a.id) as application_count,
        COUNT(DISTINCT tr.id) as total_runs,
        MAX(tr.created_at) as last_run_at
      FROM projects p
      LEFT JOIN applications a ON a.project_id = p.id
      LEFT JOIN test_runs tr ON tr.application_id = a.id
      WHERE p.org_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `,
    [orgId]
  );

  return result.rows.map((row) => ({
    ...mapProjectRow(row),
    applicationCount: parseInt(row.application_count, 10),
    totalRuns: parseInt(row.total_runs, 10),
    lastRunAt: row.last_run_at,
  }));
}

/**
 * Update project
 */
export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramCount++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramCount++}`);
    values.push(input.description);
  }
  if (input.repoUrl !== undefined) {
    fields.push(`repo_url = $${paramCount++}`);
    values.push(input.repoUrl);
  }
  if (input.defaultBranch !== undefined) {
    fields.push(`default_branch = $${paramCount++}`);
    values.push(input.defaultBranch);
  }

  if (fields.length === 0) {
    return findProjectById(id);
  }

  fields.push(`updated_at = $${paramCount++}`);
  values.push(new Date().toISOString());
  values.push(id);

  const result = await pool.query<{
    id: string;
    org_id: string;
    project_key: string;
    name: string;
    description: string | null;
    repo_url: string | null;
    default_branch: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      UPDATE projects
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING
        id,
        org_id,
        project_key,
        name,
        description,
        repo_url,
        default_branch,
        created_at,
        updated_at
    `,
    values
  );

  return result.rows.length > 0 ? mapProjectRow(result.rows[0]) : null;
}

/**
 * Delete project (cascades to applications and runs)
 */
export async function deleteProject(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if project key is available in org
 */
export async function isProjectKeyAvailable(
  orgId: string,
  projectKey: string
): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM projects WHERE org_id = $1 AND project_key = $2',
    [orgId, projectKey]
  );
  return parseInt(result.rows[0].count, 10) === 0;
}

function mapProjectRow(row: {
  id: string;
  org_id: string;
  project_key: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: row.id,
    orgId: row.org_id,
    projectKey: row.project_key,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}