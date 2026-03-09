// src/routes/runs.routes.ts (Modified)
import type { Express } from 'express';
import {
  listRecentTestRuns,
  getTestRunById,
} from '../repositories/testRuns.repository.js';
import {
  getTestExecutionsByRunId,
  getRunExecutionSummary,
} from '../repositories/testCases.repository.js';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.middleware.js';



export function registerRunsRoutes(app: Express) {
  /**
   * List recent runs with optional filters
   * Supports: projectKey, appKey, runnerType, status, limit
   */
  app.get('/runs', authenticate, async (req, res) => {
    try {
      const {
        projectKey,
        appKey,
        runnerType,
        status,
        limit: limitRaw,
      } = req.query;

      const limit = limitRaw
        ? Math.min(parseInt(limitRaw as string, 10), 200)
        : 50;

      // Build dynamic query based on filters
      let query = `
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
          apps.app_key,
          p.project_key,
          COUNT(tce.id) as total_tests,
          COUNT(CASE WHEN tce.status = 'passed' THEN 1 END) as passed_tests,
          COUNT(CASE WHEN tce.status = 'failed' THEN 1 END) as failed_tests,
          COUNT(CASE WHEN tce.status = 'skipped' THEN 1 END) as skipped_tests
        FROM test_runs tr
        JOIN applications apps ON apps.id = tr.application_id
        JOIN projects p ON p.id = apps.project_id
        LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramCount = 1;

      if (projectKey) {
        query += ` AND p.project_key = $${paramCount++}`;
        params.push(projectKey);
      }

      if (appKey) {
        query += ` AND apps.app_key = $${paramCount++}`;
        params.push(appKey);
      }

      if (runnerType) {
        query += ` AND tr.runner_type = $${paramCount++}`;
        params.push(runnerType);
      }

      if (status) {
        query += ` AND tr.status = $${paramCount++}`;
        params.push(status);
      }

      query += `
        GROUP BY
          tr.id, tr.application_id, tr.run_id, tr.status, tr.runner_type,
          tr.job_number, tr.job_prefix, tr.branch, tr.commit_sha,
          tr.ci_build_number, tr.environment, tr.started_at, tr.finished_at,
          tr.created_at, apps.name, apps.app_key, p.project_key
        ORDER BY tr.created_at DESC
        LIMIT $${paramCount}`;
      params.push(limit);

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
        project_key: string;
        total_tests: string;
        passed_tests: string;
        failed_tests: string;
        skipped_tests: string;
      }>(query, params);

      const runs = result.rows.map((row) => ({
        id: row.id,
        applicationId: row.application_id,
        applicationName: row.application_name,
        appKey: row.app_key,
        projectKey: row.project_key,
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
        totalTests: parseInt(row.total_tests, 10),
        passedTests: parseInt(row.passed_tests, 10),
        failedTests: parseInt(row.failed_tests, 10),
        skippedTests: parseInt(row.skipped_tests, 10),
      }));

      res.json({ runs });
    } catch (error) {
      console.error('Failed to fetch runs:', error);
      res.status(500).json({ error: 'Failed to fetch runs' });
    }
  });

  /**
   * Get single run by ID
   */
  app.get('/runs/:id', authenticate, async (req, res) => {
    try {
      const run = await getTestRunById(req.params.id);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }
      res.json({ run });
    } catch (error) {
      console.error('Failed to fetch run:', error);
      res.status(500).json({ error: 'Failed to fetch run' });
    }
  });

  /**
   * Get test executions for a run
   */
  app.get('/runs/:id/executions', authenticate, async (req, res) => {
    try {
      const run = await getTestRunById(req.params.id);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      const executions = await getTestExecutionsByRunId(req.params.id);
      res.json({ executions });
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  /**
   * Get run summary (stats)
   */
  app.get('/runs/:id/summary', authenticate, async (req, res) => {
    try {
      const run = await getTestRunById(req.params.id);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      const summary = await getRunExecutionSummary(req.params.id);
      res.json({ summary });
    } catch (error) {
      console.error('Failed to fetch summary:', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  /**
   * Get dashboard data grouped by Application → Framework → Date → Job
   * Returns hierarchical structure for dashboard view
   */
  app.get('/dashboard/grouped-runs', authenticate, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const daysLimit = Math.min(parseInt(days as string, 10), 90);

      const query = `
        SELECT
          apps.id AS application_id,
          apps.name AS application_name,
          apps.app_key,
          p.project_key,
          tr.runner_type,
          tr.job_prefix,
          tr.job_number,
          DATE(tr.created_at) AS execution_date,
          tr.id AS run_id,
          tr.run_id AS run_identifier,
          tr.status,
          tr.branch,
          tr.commit_sha,
          tr.ci_build_number,
          tr.environment,
          tr.started_at,
          tr.finished_at,
          tr.created_at,
          COUNT(te.id) AS total_tests,
          COUNT(CASE WHEN te.status = 'passed' THEN 1 END) AS passed_tests,
          COUNT(CASE WHEN te.status = 'failed' THEN 1 END) AS failed_tests,
          COUNT(CASE WHEN te.status = 'skipped' THEN 1 END) AS skipped_tests
        FROM test_runs tr
        JOIN applications apps ON apps.id = tr.application_id
        JOIN projects p ON p.id = apps.project_id
        LEFT JOIN test_case_executions te ON te.test_run_id = tr.id
        WHERE tr.created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY
          apps.id, apps.name, apps.app_key, p.project_key,
          tr.runner_type, tr.job_prefix, tr.job_number,
          DATE(tr.created_at), tr.id, tr.run_id, tr.status,
          tr.branch, tr.commit_sha, tr.ci_build_number,
          tr.environment, tr.started_at, tr.finished_at, tr.created_at
        ORDER BY
          apps.name ASC,
          tr.runner_type ASC,
          execution_date DESC,
          tr.job_number DESC,
          tr.created_at DESC
      `;

      const result = await pool.query(query, [daysLimit]);

      // Group data hierarchically
      const grouped: any = {};

      result.rows.forEach((row) => {
        const appKey = row.application_id;
        const runnerType = row.runner_type || 'unknown';
        const date = row.execution_date;

        // Initialize application
        if (!grouped[appKey]) {
          grouped[appKey] = {
            applicationId: row.application_id,
            applicationName: row.application_name,
            appKey: row.app_key,
            projectKey: row.project_key,
            frameworks: {},
          };
        }

        // Initialize framework
        if (!grouped[appKey].frameworks[runnerType]) {
          grouped[appKey].frameworks[runnerType] = {
            runnerType,
            dates: {},
          };
        }

        // Initialize date
        if (!grouped[appKey].frameworks[runnerType].dates[date]) {
          grouped[appKey].frameworks[runnerType].dates[date] = {
            date,
            jobs: {},
          };
        }

        // Initialize job
        const jobKey = `${row.job_prefix}-${row.job_number}`;
        if (!grouped[appKey].frameworks[runnerType].dates[date].jobs[jobKey]) {
          grouped[appKey].frameworks[runnerType].dates[date].jobs[jobKey] = {
            jobPrefix: row.job_prefix,
            jobNumber: row.job_number,
            jobId: jobKey,
            runs: [],
          };
        }

        // Add run details
        grouped[appKey].frameworks[runnerType].dates[date].jobs[jobKey].runs.push({
          runId: row.run_id,
          runIdentifier: row.run_identifier,
          status: row.status,
          branch: row.branch,
          commitSha: row.commit_sha,
          ciBuildNumber: row.ci_build_number,
          environment: row.environment,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          createdAt: row.created_at,
          totalTests: parseInt(row.total_tests, 10),
          passedTests: parseInt(row.passed_tests, 10),
          failedTests: parseInt(row.failed_tests, 10),
          skippedTests: parseInt(row.skipped_tests, 10),
        });
      });

      // Convert nested objects to arrays for easier frontend consumption
      const applications = Object.values(grouped).map((app: any) => ({
        ...app,
        frameworks: Object.values(app.frameworks).map((fw: any) => ({
          ...fw,
          dates: Object.values(fw.dates).map((d: any) => ({
            ...d,
            jobs: Object.values(d.jobs),
          })),
        })),
      }));

      res.json({ applications });
    } catch (error) {
      console.error('Failed to fetch grouped runs:', error);
      res.status(500).json({ error: 'Failed to fetch grouped runs' });
    }
  });

  /**
   * Get day-wise execution summary
   * Returns daily statistics for all test executions
   */
  app.get('/dashboard/day-wise-summary', authenticate, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const daysLimit = Math.min(parseInt(days as string, 10), 90);

      const query = `
        SELECT
          DATE(tr.created_at) AS date,
          tr.runner_type,
          COUNT(DISTINCT CONCAT(tr.job_prefix, '-', tr.job_number)) AS total_jobs,
          COUNT(te.id) AS total_tests,
          COUNT(CASE WHEN te.status = 'passed' THEN 1 END) AS passed_tests,
          COUNT(CASE WHEN te.status = 'failed' THEN 1 END) AS failed_tests,
          COUNT(CASE WHEN te.status = 'skipped' THEN 1 END) AS skipped_tests
        FROM test_runs tr
        LEFT JOIN test_case_executions te ON te.test_run_id = tr.id
        WHERE tr.created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY DATE(tr.created_at), tr.runner_type
        ORDER BY date DESC, tr.runner_type ASC
      `;

      const result = await pool.query(query, [daysLimit]);

      // Group by date
      const dayStatsMap: any = {};

      result.rows.forEach((row) => {
        const date = row.date;
        if (!dayStatsMap[date]) {
          dayStatsMap[date] = {
            date,
            totalJobs: 0,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            passRate: 0,
            frameworks: {},
          };
        }

        const stats = dayStatsMap[date];
        const jobCount = parseInt(row.total_jobs, 10);

        stats.totalJobs += jobCount;
        stats.totalTests += parseInt(row.total_tests, 10);
        stats.passedTests += parseInt(row.passed_tests, 10);
        stats.failedTests += parseInt(row.failed_tests, 10);
        stats.skippedTests += parseInt(row.skipped_tests, 10);
        stats.frameworks[row.runner_type] = (stats.frameworks[row.runner_type] || 0) + jobCount;
      });

      // Calculate pass rates
      const dayWiseStats = Object.values(dayStatsMap).map((stats: any) => ({
        ...stats,
        passRate: stats.totalTests > 0 ? Math.round((stats.passedTests / stats.totalTests) * 100) : 0,
      }));

      res.json({ dayWiseStats });
    } catch (error) {
      console.error('Failed to fetch day-wise summary:', error);
      res.status(500).json({ error: 'Failed to fetch day-wise summary' });
    }
  });

  /**
   * Get dashboard summary with ACCURATE application-level statistics
   * Returns unique test counts per application, not aggregated execution counts
   */
  app.get('/dashboard/app-summary', authenticate, async (req, res) => {
    try {
      const { days = '30' } = req.query;
      const daysLimit = Math.min(parseInt(days as string, 10), 90);

      // CTE: get the most recent run per application (no days filter — always show last run stats)
      // and separately count total runs within the days window
      const query = `
        WITH last_run AS (
          SELECT DISTINCT ON (application_id)
            id, application_id, created_at
          FROM test_runs
          ORDER BY application_id, created_at DESC
        ),
        last_run_stats AS (
          SELECT
            lr.application_id,
            COALESCE(SUM(CASE WHEN tce.status = 'passed' THEN 1 ELSE 0 END), 0) as passed,
            COALESCE(SUM(CASE WHEN tce.status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(CASE WHEN tce.status = 'skipped' THEN 1 ELSE 0 END), 0) as skipped
          FROM last_run lr
          LEFT JOIN test_case_executions tce ON tce.test_run_id = lr.id
          GROUP BY lr.application_id
        )
        SELECT
          a.id as application_id,
          a.name as application_name,
          a.app_key,
          a.runner_type,
          p.project_key,
          COALESCE(COUNT(DISTINCT tcm.id), 0) as unique_test_count,
          COALESCE(COUNT(DISTINCT tr.id), 0) as total_runs,
          MAX(tr.created_at) as last_run_at,
          COALESCE(lrs.passed, 0) as last_run_passed,
          COALESCE(lrs.failed, 0) as last_run_failed,
          COALESCE(lrs.skipped, 0) as last_run_skipped
        FROM applications a
        JOIN projects p ON p.id = a.project_id
        LEFT JOIN test_case_master tcm ON tcm.application_id = a.id
        LEFT JOIN test_runs tr ON tr.application_id = a.id
          AND tr.created_at >= NOW() - INTERVAL '1 day' * $1
        LEFT JOIN last_run_stats lrs ON lrs.application_id = a.id
        GROUP BY a.id, a.name, a.app_key, a.runner_type, p.project_key,
                 lrs.passed, lrs.failed, lrs.skipped
        ORDER BY last_run_at DESC NULLS LAST, a.name ASC
      `;

      const result = await pool.query(query, [daysLimit]);

      const applications = result.rows.map((row) => {
        const passed = parseInt(row.last_run_passed, 10);
        const failed = parseInt(row.last_run_failed, 10);
        const skipped = parseInt(row.last_run_skipped, 10);
        const total = passed + failed + skipped;
        return {
          applicationId: row.application_id,
          applicationName: row.application_name,
          appKey: row.app_key,
          runnerType: row.runner_type,
          projectKey: row.project_key,
          uniqueTestCount: parseInt(row.unique_test_count, 10),
          totalRuns: parseInt(row.total_runs, 10),
          lastRunAt: row.last_run_at,
          stats: {
            totalExecutions: total,
            passed,
            failed,
            skipped,
            passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
          },
        };
      });

      res.json({
        applications,
        summary: {
          totalApplications: applications.length,
          totalUniqueTests: applications.reduce((sum, app) => sum + app.uniqueTestCount, 0),
        },
      });
    } catch (error) {
      console.error('Failed to fetch dashboard summary:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
  });

  /**
   * Get live/running executions only
   * Returns only test runs with status 'running' or 'in_progress'
   */
  app.get('/live-executions', authenticate, async (req, res) => {
    try {
      // First, cleanup stale running tests (older than 5 minutes)
      await pool.query(
        `
          UPDATE test_runs
          SET status = 'completed', finished_at = CURRENT_TIMESTAMP
          WHERE status IN ('running', 'in_progress')
            AND created_at < NOW() - INTERVAL '5 minutes'
        `
      );

      const query = `
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
          apps.app_key,
          p.project_key,
          COUNT(te.id) AS total_tests,
          COUNT(CASE WHEN te.status = 'passed' THEN 1 END) AS passed_tests,
          COUNT(CASE WHEN te.status = 'failed' THEN 1 END) AS failed_tests,
          COUNT(CASE WHEN te.status = 'running' THEN 1 END) AS running_tests,
          COUNT(CASE WHEN te.status = 'skipped' THEN 1 END) AS skipped_tests
        FROM test_runs tr
        JOIN applications apps ON apps.id = tr.application_id
        JOIN projects p ON p.id = apps.project_id
        LEFT JOIN test_case_executions te ON te.test_run_id = tr.id
        WHERE
          tr.status IN ('running', 'in_progress')
          AND tr.created_at > NOW() - INTERVAL '10 minutes'
        GROUP BY
          tr.id, tr.application_id, tr.run_id, tr.status,
          tr.runner_type, tr.job_number, tr.job_prefix,
          tr.branch, tr.commit_sha, tr.ci_build_number,
          tr.environment, tr.started_at, tr.finished_at, tr.created_at,
          apps.name, apps.app_key, p.project_key
        ORDER BY tr.created_at DESC
      `;

      const result = await pool.query(query);

      const liveExecutions = result.rows.map((row) => ({
        id: row.id,
        applicationId: row.application_id,
        applicationName: row.application_name,
        appKey: row.app_key,
        projectKey: row.project_key,
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
        totalTests: parseInt(row.total_tests, 10),
        passedTests: parseInt(row.passed_tests, 10),
        failedTests: parseInt(row.failed_tests, 10),
        runningTests: parseInt(row.running_tests, 10),
        skippedTests: parseInt(row.skipped_tests, 10),
      }));

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json({ liveExecutions, count: liveExecutions.length });
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
      res.status(500).json({ error: 'Failed to fetch live executions' });
    }
  });



  /**
   * NEW: Application-specific runs
   * Returns all runs for a specific application with test counts and failure counts
   */
  app.get('/applications/:appKey/runs', authenticate, async (req, res) => {
    try {
      const { appKey } = req.params;

      const query = `
        SELECT
          tr.id,
          tr.run_id,
          tr.runner_type,
          tr.job_number,
          tr.job_prefix,
          tr.status,
          tr.branch,
          tr.commit_sha,
          tr.started_at,
          tr.finished_at,
          tr.created_at,
          COUNT(tce.id) as total_tests,
          SUM(CASE WHEN tce.status = 'failed' THEN 1 ELSE 0 END) as failed_tests,
          SUM(CASE WHEN tce.status = 'passed' THEN 1 ELSE 0 END) as passed_tests,
          SUM(CASE WHEN tce.status = 'skipped' THEN 1 ELSE 0 END) as skipped_tests
        FROM test_runs tr
        JOIN applications a ON a.id = tr.application_id
        LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
        WHERE a.app_key = $1
        GROUP BY tr.id
        ORDER BY tr.created_at DESC
      `;

      const result = await pool.query(query, [appKey]);

      const runs = result.rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        runnerType: row.runner_type,
        jobNumber: row.job_number,
        jobPrefix: row.job_prefix,
        jobLabel: row.job_prefix && row.job_number ? `${row.job_prefix}-#${row.job_number}` : row.run_id,
        status: row.status,
        branch: row.branch,
        commitSha: row.commit_sha,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        createdAt: row.created_at,
        totalTests: parseInt(row.total_tests, 10),
        failedTests: parseInt(row.failed_tests, 10),
        passedTests: parseInt(row.passed_tests, 10),
        skippedTests: parseInt(row.skipped_tests, 10),
      }));

      res.json({ runs });
    } catch (error) {
      console.error('Failed to fetch application runs:', error);
      res.status(500).json({ error: 'Failed to fetch application runs' });
    }
  });

  /**
   * NEW: Get detailed run information with all test executions
   */
  app.get('/runs/:id/details', authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      // Get run details
      const run = await getTestRunById(id);
      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      // Get all executions with test details
      const executions = await getTestExecutionsByRunId(id);

      res.json({ run, executions });
    } catch (error) {
      console.error('Failed to fetch run details:', error);
      res.status(500).json({ error: 'Failed to fetch run details' });
    }
  });

  /**
   * NEW: Allure-style trend analysis
   * Returns trend data with X-axis (execution runs) and Y-axis (failure metrics)
   */
  app.get('/applications/:appKey/trends', authenticate, async (req, res) => {
    try {
      const { appKey } = req.params;
      const { limit = '20' } = req.query;
      const runLimit = Math.min(parseInt(limit as string, 10), 100);

      const query = `
        SELECT
          tr.id,
          tr.run_id,
          tr.job_prefix,
          tr.job_number,
          tr.created_at,
          COUNT(tce.id) as total_tests,
          SUM(CASE WHEN tce.status = 'passed' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN tce.status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN tce.status = 'skipped' THEN 1 ELSE 0 END) as skipped,
          SUM(CASE WHEN tce.status = 'broken' THEN 1 ELSE 0 END) as broken
        FROM test_runs tr
        JOIN applications a ON a.id = tr.application_id
        LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
        WHERE a.app_key = $1 AND tr.status IN ('completed', 'passed', 'failed')
        GROUP BY tr.id
        ORDER BY tr.created_at DESC
        LIMIT $2
      `;

      const result = await pool.query(query, [appKey, runLimit]);

      // Reverse to show chronological order (oldest to newest)
      const trends = result.rows.reverse().map((row, index) => ({
        executionNumber: index + 1,
        runId: row.id,
        runLabel: row.job_prefix && row.job_number
          ? `${row.job_prefix}-#${row.job_number}`
          : row.run_id.substring(0, 8),
        timestamp: row.created_at,
        total: parseInt(row.total_tests, 10),
        passed: parseInt(row.passed, 10),
        failed: parseInt(row.failed, 10),
        skipped: parseInt(row.skipped, 10),
        broken: parseInt(row.broken, 10),
      }));

      res.json({
        trends,
        meta: {
          xAxis: 'Execution Runs',
          yAxis: 'Test Results Count',
          totalExecutions: trends.length,
        },
      });
    } catch (error) {
      console.error('Failed to fetch trend data:', error);
      res.status(500).json({ error: 'Failed to fetch trend data' });
    }
  });

  /**
   * Cleanup stale running executions
   * Updates test runs stuck in 'running' or 'in_progress' status for more than 5 minutes
   */
  app.post('/cleanup-stale-runs', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE test_runs
          SET status = 'completed', finished_at = CURRENT_TIMESTAMP
          WHERE status IN ('running', 'in_progress')
            AND created_at < NOW() - INTERVAL '5 minutes'
          RETURNING id, run_id, runner_type, created_at
        `
      );

      res.json({
        message: 'Stale runs cleaned up successfully',
        cleaned: result.rowCount,
        runs: result.rows.map((row) => ({
          id: row.id,
          runId: row.run_id,
          runnerType: row.runner_type,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      console.error('Failed to cleanup stale runs:', error);
      res.status(500).json({ error: 'Failed to cleanup stale runs' });
    }
  });
}