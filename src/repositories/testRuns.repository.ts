// src/repositories/testRuns.repository.ts (Modified - Add runner_type and timing)

import { pool } from "../db/pool";

export interface NewTestRunInput {
  applicationId: string;
  runId: string;
  status: string;
  runnerType?: string;
  branch?: string;
  commitSha?: string;
  ciBuildNumber?: string;
  environment?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface TestRun {
  id: string;
  applicationId: string;
  runId: string;
  status: string;
  runnerType: string | null;
  jobNumber: number | null;
  jobPrefix: string | null;
  branch: string | null;
  commitSha: string | null;
  ciBuildNumber: string | null;
  environment: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export async function createTestRun(
  input: NewTestRunInput
): Promise<TestRun> {
  // Clean up stale runs (older than 5 minutes) before creating new run
  await pool.query(
    `
      UPDATE test_runs
      SET status = 'completed', finished_at = NOW()
      WHERE status IN ('running', 'in_progress')
        AND created_at < NOW() - INTERVAL '5 minutes'
    `
  );

  // Generate job number if runner_type is provided
  let jobNumber: number | null = null;
  let jobPrefix: string | null = null;

  if (input.runnerType) {
    const jobResult = await pool.query<{ job_number: number; job_prefix: string }>(
      `
        SELECT
          get_next_job_number($1, $2) as job_number,
          get_job_prefix($2) as job_prefix
      `,
      [input.applicationId, input.runnerType]
    );
    jobNumber = jobResult.rows[0].job_number;
    jobPrefix = jobResult.rows[0].job_prefix;
  }

  const result = await pool.query<{
    id: string;
    application_id: string;
    run_id: string;
    status: string;
    runner_type: string | null;
    job_number: number | null;
    job_prefix: string | null;
    branch: string | null;
    commit_sha: string | null;
    ci_build_number: string | null;
    environment: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
  }>(
    `
      INSERT INTO test_runs (
        application_id,
        run_id,
        status,
        runner_type,
        job_number,
        job_prefix,
        branch,
        commit_sha,
        ci_build_number,
        environment,
        started_at,
        finished_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id,
        application_id,
        run_id,
        status,
        runner_type,
        job_number,
        job_prefix,
        branch,
        commit_sha,
        ci_build_number,
        environment,
        started_at,
        finished_at,
        created_at
    `,
    [
      input.applicationId,
      input.runId,
      input.status,
      input.runnerType ?? null,
      jobNumber,
      jobPrefix,
      input.branch ?? null,
      input.commitSha ?? null,
      input.ciBuildNumber ?? null,
      input.environment ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
    ]
  );

  const row = result.rows[0];

  return {
    id: row.id,
    applicationId: row.application_id,
    runId: row.run_id,
    status: row.status,
    runnerType: row.runner_type,
    jobNumber: row.job_number,
    jobPrefix: row.job_prefix,
    branch: row.branch,
    commitSha: row.commit_sha,
    ciBuildNumber: row.ci_build_number,
    environment: row.environment,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export async function findTestRunByRunId(
  applicationId: string,
  runId: string,
  runnerType?: string
): Promise<TestRun | null> {
  let query = `
    SELECT
      id,
      application_id,
      run_id,
      status,
      runner_type,
      job_number,
      job_prefix,
      branch,
      commit_sha,
      ci_build_number,
      environment,
      started_at,
      finished_at,
      created_at
    FROM test_runs
    WHERE application_id = $1
      AND run_id = $2
  `;

  const params: any[] = [applicationId, runId];

  // If runner_type is provided, filter by it too
  if (runnerType) {
    query += ` AND runner_type = $3`;
    params.push(runnerType);
  }

  query += ` LIMIT 1`;

  const result = await pool.query<{
    id: string;
    application_id: string;
    run_id: string;
    status: string;
    runner_type: string | null;
    job_number: number | null;
    job_prefix: string | null;
    branch: string | null;
    commit_sha: string | null;
    ci_build_number: string | null;
    environment: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
  }>(query, params);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  return {
    id: row.id,
    applicationId: row.application_id,
    runId: row.run_id,
    status: row.status,
    runnerType: row.runner_type,
    jobNumber: row.job_number,
    jobPrefix: row.job_prefix,
    branch: row.branch,
    commitSha: row.commit_sha,
    ciBuildNumber: row.ci_build_number,
    environment: row.environment,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export async function getOrCreateTestRun(
  input: NewTestRunInput
): Promise<TestRun> {
  const existing = await findTestRunByRunId(
    input.applicationId,
    input.runId,
    input.runnerType
  );

  if (existing) {
    // Update the existing run with new status and metadata
    const result = await pool.query<{
      id: string;
      application_id: string;
      run_id: string;
      status: string;
      runner_type: string | null;
      job_number: number | null;
      job_prefix: string | null;
      branch: string | null;
      commit_sha: string | null;
      ci_build_number: string | null;
      environment: string | null;
      started_at: string | null;
      finished_at: string | null;
      created_at: string;
    }>(
      `
        UPDATE test_runs
        SET
          status = $2,
          started_at = COALESCE($3, started_at),
          branch = COALESCE($4, branch),
          commit_sha = COALESCE($5, commit_sha),
          ci_build_number = COALESCE($6, ci_build_number),
          environment = COALESCE($7, environment),
          finished_at = NULL
        WHERE id = $1
        RETURNING
          id,
          application_id,
          run_id,
          status,
          runner_type,
          job_number,
          job_prefix,
          branch,
          commit_sha,
          ci_build_number,
          environment,
          started_at,
          finished_at,
          created_at
      `,
      [
        existing.id,
        input.status,
        input.startedAt ?? null,
        input.branch ?? null,
        input.commitSha ?? null,
        input.ciBuildNumber ?? null,
        input.environment ?? null,
      ]
    );

    const row = result.rows[0];

    return {
      id: row.id,
      applicationId: row.application_id,
      runId: row.run_id,
      status: row.status,
      runnerType: row.runner_type,
      jobNumber: row.job_number,
      jobPrefix: row.job_prefix,
      branch: row.branch,
      commitSha: row.commit_sha,
      ciBuildNumber: row.ci_build_number,
      environment: row.environment,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
    };
  }

  return createTestRun(input);
}

export async function updateTestRunStatus(
  id: string,
  status: string
): Promise<void> {
  await pool.query(
    `
      UPDATE test_runs
      SET status = $2, finished_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [id, status]
  );
}

export interface TestRunSummary {
  id: string;
  applicationId: string;
  applicationName: string;
  appKey: string;
  runId: string;
  status: string;
  runnerType: string | null;
  jobNumber: number | null;
  jobPrefix: string | null;
  branch: string | null;
  commitSha: string | null;
  ciBuildNumber: string | null;
  environment: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export async function listRecentTestRuns(
  limit: number = 20
): Promise<TestRunSummary[]> {
  const result = await pool.query<{
    id: string;
    application_id: string;
    run_id: string;
    status: string;
    runner_type: string | null;
    job_number: number | null;
    job_prefix: string | null;
    branch: string | null;
    commit_sha: string | null;
    ci_build_number: string | null;
    environment: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    application_name: string;
    app_key: string;
  }>(
    `
      SELECT
        tr.id,
        tr.application_id,
        tr.run_id,
        tr.status,
        tr.runner_type,
        tr.job_number,
        tr.job_prefix,
        tr.branch,
        tr.commit_sha,
        tr.ci_build_number,
        tr.environment,
        tr.started_at,
        tr.finished_at,
        tr.created_at,
        apps.name AS application_name,
        apps.app_key
      FROM test_runs tr
      JOIN applications apps ON apps.id = tr.application_id
      ORDER BY tr.created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    applicationName: row.application_name,
    appKey: row.app_key,
    runId: row.run_id,
    status: row.status,
    runnerType: row.runner_type,
    jobNumber: row.job_number,
    jobPrefix: row.job_prefix,
    branch: row.branch,
    commitSha: row.commit_sha,
    ciBuildNumber: row.ci_build_number,
    environment: row.environment,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }));
}

export async function getTestRunById(
  id: string
): Promise<TestRunSummary | null> {
  const result = await pool.query<{
    id: string;
    application_id: string;
    run_id: string;
    status: string;
    runner_type: string | null;
    job_number: number | null;
    job_prefix: string | null;
    branch: string | null;
    commit_sha: string | null;
    ci_build_number: string | null;
    environment: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    application_name: string;
    app_key: string;
  }>(
    `
      SELECT
        tr.id,
        tr.application_id,
        tr.run_id,
        tr.status,
        tr.runner_type,
        tr.job_number,
        tr.job_prefix,
        tr.branch,
        tr.commit_sha,
        tr.ci_build_number,
        tr.environment,
        tr.started_at,
        tr.finished_at,
        tr.created_at,
        apps.name AS application_name,
        apps.app_key
      FROM test_runs tr
      JOIN applications apps ON apps.id = tr.application_id
      WHERE tr.id = $1
      LIMIT 1
    `,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  return {
    id: row.id,
    applicationId: row.application_id,
    applicationName: row.application_name,
    appKey: row.app_key,
    runId: row.run_id,
    status: row.status,
    runnerType: row.runner_type,
    jobNumber: row.job_number,
    jobPrefix: row.job_prefix,
    branch: row.branch,
    commitSha: row.commit_sha,
    ciBuildNumber: row.ci_build_number,
    environment: row.environment,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

/**
 * Get applicationId from runId - Used for WebSocket broadcasting
 * This is a lightweight query to support multi-execution broadcasting
 */
export async function getApplicationIdByRunId(
  runId: string
): Promise<string | null> {
  const result = await pool.query<{ application_id: string }>(
    `
      SELECT application_id
      FROM test_runs
      WHERE run_id = $1
      LIMIT 1
    `,
    [runId]
  );

  if (result.rows.length === 0) return null;

  return result.rows[0].application_id;
}