// src/repositories/testCases.repository.ts
import { pool } from '../db/pool.js';

export interface TestCaseMaster {
  id: string;
  applicationId: string;
  testKey: string;
}

export interface TestCaseExecution {
  id: string;
  testRunId: string;
  testCaseMasterId: string;
  testKey: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  errorStack: string | null;
  aiAnalysis?: {
    rootCause: string | null;
    suggestedFix: string | null;
    category: string | null;
    severity: string | null;
    confidence: number | null;
    isFlaky: boolean;
  } | null;
}

export async function getOrCreateTestCaseMaster(
  applicationId: string,
  testKey: string
): Promise<TestCaseMaster> {
  const existing = await pool.query<{
    id: string;
    application_id: string;
    test_key: string;
  }>(
    `
      SELECT id, application_id, test_key
      FROM test_case_master
      WHERE application_id = $1
        AND test_key = $2
      LIMIT 1
    `,
    [applicationId, testKey]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: row.id,
      applicationId: row.application_id,
      testKey: row.test_key,
    };
  }

  const inserted = await pool.query<{
    id: string;
    application_id: string;
    test_key: string;
  }>(
    `
      INSERT INTO test_case_master (application_id, test_key)
      VALUES ($1, $2)
      RETURNING id, application_id, test_key
    `,
    [applicationId, testKey]
  );

  const row = inserted.rows[0];
  return {
    id: row.id,
    applicationId: row.application_id,
    testKey: row.test_key,
  };
}

export async function createTestCaseExecution(
  testRunId: string,
  testCaseMasterId: string
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO test_case_executions (
        test_run_id,
        test_case_master_id,
        status
      )
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [testRunId, testCaseMasterId, 'running']
  );

  return result.rows[0].id;
}

export async function completeTestCaseExecution(
  testRunId: string,
  testCaseMasterId: string,
  status: string,
  durationMs?: number,
  errorMessage?: string,
  errorStack?: string
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE test_case_executions
      SET
        status = $3,
        duration_ms = $4,
        error_message = $5,
        error_stack = $6
      WHERE test_run_id = $1
        AND test_case_master_id = $2
        AND status = 'running'
      RETURNING id
    `,
    [
      testRunId,
      testCaseMasterId,
      status,
      durationMs ?? null,
      errorMessage ?? null,
      errorStack ?? null,
    ]
  );

  if (result.rowCount === 0 || result.rows.length === 0) {
    const insertResult = await pool.query<{ id: string }>(
      `
        INSERT INTO test_case_executions (
          test_run_id,
          test_case_master_id,
          status,
          duration_ms,
          error_message,
          error_stack
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        testRunId,
        testCaseMasterId,
        status,
        durationMs ?? null,
        errorMessage ?? null,
        errorStack ?? null,
      ]
    );
    return insertResult.rows[0].id;
  }

  return result.rows[0].id;
}

export async function getTestExecutionsByRunId(
  testRunId: string
): Promise<TestCaseExecution[]> {
  const result = await pool.query<{
    id: string;
    test_run_id: string;
    test_case_master_id: string;
    test_key: string;
    status: string;
    duration_ms: number | null;
    error_message: string | null;
    error_stack: string | null;
    ai_root_cause: string | null;
    ai_suggested_fix: string | null;
    ai_category: string | null;
    ai_severity: string | null;
    ai_confidence: number | null;
    ai_is_flaky: boolean | null;
  }>(
    `
      SELECT
        tce.id,
        tce.test_run_id,
        tce.test_case_master_id,
        tcm.test_key,
        tce.status,
        tce.duration_ms,
        tce.error_message,
        tce.error_stack,
        aia.root_cause AS ai_root_cause,
        aia.suggested_fix AS ai_suggested_fix,
        aia.category AS ai_category,
        aia.severity AS ai_severity,
        aia.confidence AS ai_confidence,
        aia.is_flaky AS ai_is_flaky
      FROM test_case_executions tce
      JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
      LEFT JOIN ai_test_analysis aia ON aia.test_case_execution_id = tce.id
      WHERE tce.test_run_id = $1
      ORDER BY tce.id ASC
    `,
    [testRunId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    testRunId: row.test_run_id,
    testCaseMasterId: row.test_case_master_id,
    testKey: row.test_key,
    status: row.status,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    aiAnalysis: (row.ai_root_cause || row.ai_suggested_fix) ? {
      rootCause: row.ai_root_cause,
      suggestedFix: row.ai_suggested_fix,
      category: row.ai_category,
      severity: row.ai_severity,
      confidence: row.ai_confidence,
      isFlaky: row.ai_is_flaky || false,
    } : null,
  }));
}

export async function getRunExecutionSummary(
  testRunId: string
): Promise<{
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  running: number;
}> {
  const result = await pool.query<{
    status: string;
    count: string;
  }>(
    `
      SELECT
        status,
        COUNT(*) as count
      FROM test_case_executions
      WHERE test_run_id = $1
      GROUP BY status
    `,
    [testRunId]
  );

  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    running: 0,
  };

  for (const row of result.rows) {
    const count = Number.parseInt(row.count, 10);
    summary.total += count;

    const status = row.status.toLowerCase();
    if (status === 'passed') {
      summary.passed = count;
    } else if (status === 'failed') {
      summary.failed = count;
    } else if (status === 'skipped') {
      summary.skipped = count;
    } else if (status === 'running') {
      summary.running = count;
    }
  }

  return summary;
}