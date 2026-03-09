// src/routes/applications.routes.ts
import type { Express } from 'express';
import { pool } from '../db/pool.js';
import { findProjectByKey } from '../repositories/projects.repository.js';
import { authenticate } from '../middleware/auth.middleware.js';



export function registerApplicationsRoutes(app: Express) {
  /**
   * List applications for a project
   */
  app.get('/projects/:projectKey/applications', authenticate, async (req, res) => {
    try {
      const { projectKey } = req.params;
      const orgId = req.query.orgId as string;

      if (!orgId) {
        return res.status(400).json({ error: 'orgId query param is required' });
      }

      const project = await findProjectByKey(orgId, projectKey);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const result = await pool.query<{
        id: string;
        name: string;
        app_key: string;
        runner_type: string;
        repo_url: string | null;
        framework_version: string | null;
        created_at: string;
      }>(
        `
          SELECT
            id,
            name,
            app_key,
            runner_type,
            repo_url,
            framework_version,
            created_at
          FROM applications
          WHERE project_id = $1
          ORDER BY created_at DESC
        `,
        [project.id]
      );

      const applications = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        appKey: row.app_key,
        runnerType: row.runner_type,
        repoUrl: row.repo_url,
        frameworkVersion: row.framework_version,
        createdAt: row.created_at,
      }));

      res.json({ applications });
    } catch (error) {
      console.error('Failed to list applications:', error);
      res.status(500).json({ error: 'Failed to list applications' });
    }
  });

  /**
   * Get a single application
   */
  app.get('/projects/:projectKey/applications/:appKey', authenticate, async (req, res) => {
    try {
      const { projectKey, appKey } = req.params;
      const orgId = req.query.orgId as string;

      if (!orgId) {
        return res.status(400).json({ error: 'orgId query param is required' });
      }

      const project = await findProjectByKey(orgId, projectKey);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const result = await pool.query<{
        id: string;
        name: string;
        app_key: string;
        runner_type: string;
        repo_url: string | null;
        framework_version: string | null;
        created_at: string;
      }>(
        `
          SELECT
            id,
            name,
            app_key,
            runner_type,
            repo_url,
            framework_version,
            created_at
          FROM applications
          WHERE project_id = $1 AND app_key = $2
          LIMIT 1
        `,
        [project.id, appKey]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const row = result.rows[0];
      const application = {
        id: row.id,
        name: row.name,
        appKey: row.app_key,
        runnerType: row.runner_type,
        repoUrl: row.repo_url,
        frameworkVersion: row.framework_version,
        createdAt: row.created_at,
      };

      res.json({ application });
    } catch (error) {
      console.error('Failed to get application:', error);
      res.status(500).json({ error: 'Failed to get application' });
    }
  });

  /**
   * Get application analytics with accurate test counts
   * Returns:
   * - Unique test case count (from test_case_master)
   * - Latest execution summary
   * - Trend data (daily aggregates)
   */
  app.get('/applications/:appId/analytics', authenticate, async (req, res) => {
    try {
      const { appId } = req.params;
      const { days = '30' } = req.query;
      const daysLimit = Math.min(parseInt(days as string, 10), 90);

      // Get application info with unique test count
      const appQuery = await pool.query<{
        id: string;
        name: string;
        app_key: string;
        runner_type: string;
        project_key: string;
        unique_tests: string;
      }>(
        `
          SELECT
            a.id,
            a.name,
            a.app_key,
            a.runner_type,
            p.project_key,
            COALESCE(COUNT(DISTINCT tcm.id), 0) as unique_tests
          FROM applications a
          JOIN projects p ON p.id = a.project_id
          LEFT JOIN test_case_master tcm ON tcm.application_id = a.id
          WHERE a.id = $1
          GROUP BY a.id, a.name, a.app_key, a.runner_type, p.project_key
        `,
        [appId]
      );

      if (appQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const app = appQuery.rows[0];

      // Get latest execution summary
      const latestRunQuery = await pool.query<{
        run_id: string;
        status: string;
        job_number: number | null;
        job_prefix: string | null;
        started_at: string | null;
        finished_at: string | null;
        total_tests: string;
        passed_tests: string;
        failed_tests: string;
        skipped_tests: string;
      }>(
        `
          SELECT
            tr.id as run_id,
            tr.status,
            tr.job_number,
            tr.job_prefix,
            tr.started_at,
            tr.finished_at,
            COUNT(tce.id) as total_tests,
            COUNT(CASE WHEN tce.status = 'passed' THEN 1 END) as passed_tests,
            COUNT(CASE WHEN tce.status = 'failed' THEN 1 END) as failed_tests,
            COUNT(CASE WHEN tce.status = 'skipped' THEN 1 END) as skipped_tests
          FROM test_runs tr
          LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
          WHERE tr.application_id = $1
          GROUP BY tr.id
          ORDER BY tr.created_at DESC
          LIMIT 1
        `,
        [appId]
      );

      // Get daily trend data
      const trendQuery = await pool.query<{
        execution_date: string;
        total_runs: string;
        total_executions: string;
        passed: string;
        failed: string;
        skipped: string;
      }>(
        `
          SELECT
            DATE(tr.created_at) as execution_date,
            COUNT(DISTINCT tr.id) as total_runs,
            COUNT(tce.id) as total_executions,
            COUNT(CASE WHEN tce.status = 'passed' THEN 1 END) as passed,
            COUNT(CASE WHEN tce.status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN tce.status = 'skipped' THEN 1 END) as skipped
          FROM test_runs tr
          LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
          WHERE tr.application_id = $1
            AND tr.created_at >= NOW() - INTERVAL '1 day' * $2
          GROUP BY DATE(tr.created_at)
          ORDER BY execution_date DESC
        `,
        [appId, daysLimit]
      );

      res.json({
        application: {
          id: app.id,
          name: app.name,
          appKey: app.app_key,
          runnerType: app.runner_type,
          projectKey: app.project_key,
          uniqueTestCount: parseInt(app.unique_tests, 10),
        },
        latestExecution: latestRunQuery.rows.length > 0 ? {
          runId: latestRunQuery.rows[0].run_id,
          status: latestRunQuery.rows[0].status,
          jobNumber: latestRunQuery.rows[0].job_number,
          jobPrefix: latestRunQuery.rows[0].job_prefix,
          startedAt: latestRunQuery.rows[0].started_at,
          finishedAt: latestRunQuery.rows[0].finished_at,
          totalTests: parseInt(latestRunQuery.rows[0].total_tests, 10),
          passedTests: parseInt(latestRunQuery.rows[0].passed_tests, 10),
          failedTests: parseInt(latestRunQuery.rows[0].failed_tests, 10),
          skippedTests: parseInt(latestRunQuery.rows[0].skipped_tests, 10),
        } : null,
        trend: trendQuery.rows.map(row => ({
          date: row.execution_date,
          runs: parseInt(row.total_runs, 10),
          totalExecutions: parseInt(row.total_executions, 10),
          passed: parseInt(row.passed, 10),
          failed: parseInt(row.failed, 10),
          skipped: parseInt(row.skipped, 10),
          passRate: parseInt(row.total_executions, 10) > 0
            ? Math.round((parseInt(row.passed, 10) / parseInt(row.total_executions, 10)) * 100)
            : 0,
        })),
      });
    } catch (error) {
      console.error('Failed to get application analytics:', error);
      res.status(500).json({ error: 'Failed to get application analytics' });
    }
  });

  /**
   * Create a new application in a project
   */
  app.post('/projects/:projectKey/applications', authenticate, async (req, res) => {
    try {
      const { projectKey } = req.params;
      const { name, appKey, runnerType, repoUrl, frameworkVersion } = req.body;
      const orgId = req.query.orgId as string;

      if (!orgId) {
        return res.status(400).json({ error: 'orgId query param is required' });
      }

      if (!name || !appKey || !runnerType) {
        return res
          .status(400)
          .json({ error: 'name, appKey, and runnerType are required' });
      }

      const project = await findProjectByKey(orgId, projectKey);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const result = await pool.query<{
        id: string;
        name: string;
        app_key: string;
        runner_type: string;
        repo_url: string | null;
        framework_version: string | null;
        created_at: string;
      }>(
        `
          INSERT INTO applications (
            project_id,
            org_id,
            name,
            app_key,
            runner_type,
            repo_url,
            framework_version
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            name,
            app_key,
            runner_type,
            repo_url,
            framework_version,
            created_at
        `,
        [
          project.id,
          project.orgId,
          name,
          appKey,
          runnerType,
          repoUrl ?? null,
          frameworkVersion ?? null,
        ]
      );

      const row = result.rows[0];
      const application = {
        id: row.id,
        name: row.name,
        appKey: row.app_key,
        runnerType: row.runner_type,
        repoUrl: row.repo_url,
        frameworkVersion: row.framework_version,
        createdAt: row.created_at,
      };

      res.status(201).json({ application });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'appKey already exists in this project' });
      }
      console.error('Failed to create application:', error);
      res.status(500).json({ error: 'Failed to create application' });
    }
  });
}