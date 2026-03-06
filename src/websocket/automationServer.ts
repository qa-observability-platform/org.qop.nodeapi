// src/websocket/automationServer.ts (Modified - Key Changes)
import { WebSocketServer, WebSocket } from 'ws';
import { findProjectByApiKey } from '../repositories/projectApiKeys.repository.js';
import { verifySessionToken } from '../services/auth.service.js';
import { pool } from '../db/pool.js';
import {
  getOrCreateTestRun,
  updateTestRunStatus,
} from '../repositories/testRuns.repository.js';
import {
  getOrCreateTestCaseMaster,
  createTestCaseExecution,
  completeTestCaseExecution,
} from '../repositories/testCases.repository.js';
import { logger } from '../utils/logger.js';
import {
  broadcastTestUpdate,
  broadcastRunSummary,
} from './liveServer.js';
import { aiAnalysisClient } from '../services/aiAnalysisClient.js';

type IngestClient = {
  socket: WebSocket;
  projectId: string;
  projectKey: string;
  applicationId: string;
  orgId: string;
  appKey: string;
  applicationName: string;
  runnerType: string;
};

type IngestEventBase = {
  event: string;
  runId: string;
  timestamp?: string;
  [key: string]: unknown;
};

export function setupAutomationWebSocket() {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  wss.on('connection', async (socket, req) => {
    let client: IngestClient | null = null;

    // Disable idle timeout - keep connection alive for long test runs
    socket.on('ping', () => socket.pong());

    // Send periodic pings to keep connection alive
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 30000); // Every 30 seconds

    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const sessionToken = url.searchParams.get('sessionToken') ?? undefined;
      const apiKey = url.searchParams.get('apiKey') ?? undefined;
      const projectKey = url.searchParams.get('projectKey') ?? undefined;
      const appKey = url.searchParams.get('appKey') ?? undefined;
      const runnerType = url.searchParams.get('runnerType') ?? 'playwright';

      let projectId: string;
      let resolvedProjectKey: string;
      let orgId: string;

      if (sessionToken) {
        // NEW MODE: session token from POST /auth/validate-key
        try {
          const session = verifySessionToken(sessionToken);
          projectId = session.projectId;
          resolvedProjectKey = session.projectKey;
          orgId = session.orgId;
        } catch (err) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid or expired session token',
            })
          );
          socket.close();
          return;
        }

        if (!appKey) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Missing appKey',
            })
          );
          socket.close();
          return;
        }
      } else if (apiKey && projectKey && appKey) {
        // LEGACY MODE: apiKey + projectKey + appKey query params
        const project = await findProjectByApiKey(apiKey);
        if (!project || project.projectKey !== projectKey) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid credentials or project mismatch',
            })
          );
          socket.close();
          return;
        }
        projectId = project.projectId;
        resolvedProjectKey = project.projectKey;
        orgId = project.orgId;
      } else {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Missing authentication. Provide sessionToken or apiKey+projectKey+appKey',
          })
        );
        socket.close();
        return;
      }

      // Find or create application
      const appResult = await pool.query<{
        id: string;
        name: string;
        runner_type: string;
      }>(
        `
          SELECT id, name, runner_type
          FROM applications
          WHERE project_id = $1 AND app_key = $2
          LIMIT 1
        `,
        [projectId, appKey]
      );

      let applicationId: string;
      let applicationName: string;
      let appRunnerType: string;

      if (appResult.rows.length === 0) {
        // Auto-create application
        const createResult = await pool.query<{
          id: string;
          name: string;
          runner_type: string;
        }>(
          `
            INSERT INTO applications (
              project_id,
              org_id,
              name,
              app_key,
              runner_type
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, name, runner_type
          `,
          [projectId, orgId, appKey, appKey, runnerType]
        );

        applicationId = createResult.rows[0].id;
        applicationName = createResult.rows[0].name;
        appRunnerType = createResult.rows[0].runner_type;

        logger.info('Auto-created application', { applicationId, appKey });
      } else {
        applicationId = appResult.rows[0].id;
        applicationName = appResult.rows[0].name;
        appRunnerType = appResult.rows[0].runner_type;
      }

      // Validate runner type matches
      if (appRunnerType !== runnerType) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: `Runner type mismatch. Expected: ${appRunnerType}, Got: ${runnerType}`,
          })
        );
        socket.close();
        return;
      }

      client = {
        socket,
        projectId,
        projectKey: resolvedProjectKey,
        applicationId,
        orgId,
        appKey,
        applicationName,
        runnerType,
      };

      logger.info('Ingest WS connected', {
        projectKey: resolvedProjectKey,
        appKey,
        runnerType,
      });

      socket.on('message', async (raw) => {
        if (!client) return;

        try {
          const msg = JSON.parse(raw.toString()) as IngestEventBase;

          if (!msg.event || !msg.runId) {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Missing event or runId' })
            );
            return;
          }

          switch (msg.event) {
            case 'run_started':
              await handleRunStarted(client, msg);
              break;
            case 'run_finished':
              await handleRunFinished(client, msg);
              break;
            case 'test_started':
              await handleTestStarted(client, msg);
              break;
            case 'test_finished': {
              const executionId = await handleTestFinished(client, msg);
              // Send ack with execution ID for screenshot upload
              socket.send(
                JSON.stringify({
                  type: 'ack',
                  event: msg.event,
                  runId: msg.runId,
                  testId: msg.testId,
                  executionId
                })
              );
              return; // Early return to avoid duplicate ack
            }
            default:
              socket.send(
                JSON.stringify({
                  type: 'error',
                  message: `Unknown event: ${msg.event}`,
                })
              );
              return;
          }

          socket.send(
            JSON.stringify({ type: 'ack', event: msg.event, runId: msg.runId })
          );
        } catch (err: any) {
          logger.error('Ingest WS message error', { error: err?.message });
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Failed to process: ' + (err?.message || 'Unknown error') })
            );
          }
        }
      });

      socket.on('close', () => {
        clearInterval(pingInterval);
        if (client) {
          logger.info('Ingest WS disconnected', {
            projectKey: client.projectKey,
            appKey: client.appKey,
          });
        }
      });

      socket.on('error', (err) => {
        logger.error('Ingest WS error', { error: (err as any)?.message });
      });
    } catch (err: any) {
      logger.error('Ingest WS connection failed', {
        error: err,
        message: err?.message || 'Unknown error',
        stack: err?.stack
      });
      socket.send(
        JSON.stringify({ type: 'error', message: 'Connection failed: ' + (err?.message || 'Unknown error') })
      );
      socket.close();
    }
  });

  logger.info('Ingest WS server initialized');
  return wss;
}

async function handleRunStarted(client: IngestClient, msg: IngestEventBase) {
  const { runId, branch, commitSha, ciBuildNumber, environment, status } =
    msg as any;

  await getOrCreateTestRun({
    applicationId: client.applicationId,
    runId,
    status: status || 'running',
    runnerType: client.runnerType,
    branch,
    commitSha,
    ciBuildNumber,
    environment,
    startedAt: new Date().toISOString(),
  });

  logger.info('Ingest: run_started', {
    runId,
    runnerType: client.runnerType,
    projectKey: client.projectKey,
  });
}

async function handleRunFinished(client: IngestClient, msg: IngestEventBase) {
  const { runId, status } = msg as any;

  const run = await getOrCreateTestRun({
    applicationId: client.applicationId,
    runId,
    status: status || 'completed',
    runnerType: client.runnerType,
  });

  // Calculate actual test counts from test_case_executions
  const statsResult = await pool.query<{
    total_tests: string;
    passed_tests: string;
    failed_tests: string;
    skipped_tests: string;
    timeout_tests: string;
  }>(
    `
      SELECT
        COUNT(*)::text as total_tests,
        COUNT(*) FILTER (WHERE status = 'passed')::text as passed_tests,
        COUNT(*) FILTER (WHERE status = 'failed')::text as failed_tests,
        COUNT(*) FILTER (WHERE status = 'skipped')::text as skipped_tests,
        COUNT(*) FILTER (WHERE status = 'timeout')::text as timeout_tests
      FROM test_case_executions
      WHERE test_run_id = $1
    `,
    [run.id]
  );

  const stats = statsResult.rows[0] || {
    total_tests: '0',
    passed_tests: '0',
    failed_tests: '0',
    skipped_tests: '0',
    timeout_tests: '0',
  };

  // Update run status to completed
  await pool.query(
    `
      UPDATE test_runs
      SET status = $2, finished_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [run.id, status || 'completed']
  );

  // Broadcast final run summary with real counts
  broadcastRunSummary({
    type: 'run_summary',
    runId,
    status: status || 'completed',
    totalTests: parseInt(stats.total_tests),
    passedTests: parseInt(stats.passed_tests),
    failedTests: parseInt(stats.failed_tests),
    skippedTests: parseInt(stats.skipped_tests),
    timeoutTests: parseInt(stats.timeout_tests),
    timestamp: new Date().toISOString(),
  });

  // Broadcast final status for all tests in this run (for UI updates)
  const testsResult = await pool.query<{
    id: string;
    status: string;
    duration_ms: number;
    error_message: string | null;
  }>(
    `
      SELECT
        tce.id,
        tce.status,
        tce.duration_ms,
        tce.error_message
      FROM test_case_executions tce
      JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
      WHERE tce.test_run_id = $1
    `,
    [run.id]
  );

  // Broadcast each test's final status
  for (const test of testsResult.rows) {
    const masterResult = await pool.query<{ test_key: string }>(
      `
        SELECT tcm.test_key
        FROM test_case_executions tce
        JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
        WHERE tce.id = $1
      `,
      [test.id]
    );

    if (masterResult.rows.length > 0) {
      broadcastTestUpdate({
        type: 'ui_update',
        runId,
        testCaseExecutionId: test.id,
        testKey: masterResult.rows[0].test_key,
        status: test.status,
        durationMs: test.duration_ms,
        errorMessage: test.error_message || undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  logger.info('Ingest: run_finished', {
    runId,
    totalTests: stats.total_tests,
    passed: stats.passed_tests,
    failed: stats.failed_tests,
  });
}

function buildTestKey(msg: any): string {
  const { file, title, testId } = msg;
  if (!file || !title) return testId;

  const filename = file.split(/[\\/]/).pop() || file;
  return `${filename}:${title}`;
}

async function handleTestStarted(client: IngestClient, msg: IngestEventBase) {
  const { runId } = msg as any;

  const run = await getOrCreateTestRun({
    applicationId: client.applicationId,
    runId,
    status: 'running',
    runnerType: client.runnerType,
  });

  const testKey = buildTestKey(msg);
  const master = await getOrCreateTestCaseMaster(client.applicationId, testKey);
  const executionId = await createTestCaseExecution(run.id, master.id);

  broadcastTestUpdate({
    type: 'ui_update',
    runId,
    testCaseExecutionId: executionId,
    testKey,
    status: 'running',
    timestamp: new Date().toISOString(),
  });

  logger.info('Ingest: test_started', { runId, testKey });
}

async function handleTestFinished(client: IngestClient, msg: IngestEventBase) {
  const { runId, status, durationMs, error } = msg as any;

  const run = await getOrCreateTestRun({
    applicationId: client.applicationId,
    runId,
    status: 'running',
    runnerType: client.runnerType,
  });

  const testKey = buildTestKey(msg);
  const master = await getOrCreateTestCaseMaster(client.applicationId, testKey);

  const errorMessage = error?.message;
  const errorStack = error?.stack;

  const executionId = await completeTestCaseExecution(
    run.id,
    master.id,
    status || 'completed',
    durationMs,
    errorMessage,
    errorStack
  );

  broadcastTestUpdate({
    type: 'ui_update',
    runId,
    testCaseExecutionId: executionId,
    testKey,
    status: status || 'completed',
    durationMs,
    errorMessage,
    timestamp: new Date().toISOString(),
  });

  logger.info('Ingest: test_finished', { runId, testKey, status, executionId });

  // 🤖 Trigger AI analysis for failures, timeouts, and skipped tests (async, non-blocking)
  if (status === 'failed' || status === 'timeout' || status === 'skipped') {
    aiAnalysisClient.analyzeFailureAsync({
      runId,
      testCaseExecutionId: executionId,
      testKey,
      errorMessage: errorMessage || 'No error message provided',
      stackTrace: errorStack,
      durationMs,
      runnerType: client.runnerType,
    }).catch((err) => {
      logger.error('AI analysis trigger failed', {
        testKey,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });
  }

  // Return execution ID to reporter for screenshot upload
  return executionId;
}