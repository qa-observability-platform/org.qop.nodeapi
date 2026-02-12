/**
 * Comparative Analysis Routes
 *
 * Allows users to compare test runs and get AI-powered insights
 * on why current run failed vs previous successful runs.
 *
 * Features:
 * - Compare current job vs any previous job
 * - Identify new failures, regressions, flaky tests
 * - AI analysis of failure patterns and root causes
 * - Manual trigger for on-demand analysis
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

/**
 * GET /api/comparative-analysis/jobs/:appId
 * Get list of jobs for an application (for comparison selection)
 */
router.get('/jobs/:appId', async (req, res) => {
  try {
    const { appId } = req.params;
    const { limit = 50 } = req.query;

    logger.info('Fetching jobs for comparative analysis', { appId, limit });

    const result = await pool.query(
      `
      SELECT
        tr.id,
        tr.run_id,
        tr.job_number,
        tr.job_prefix,
        tr.status,
        tr.branch,
        tr.started_at,
        tr.finished_at,
        tr.created_at,
        COUNT(tce.id) as total_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'passed') as passed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'failed') as failed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'skipped') as skipped_tests,
        CASE
          WHEN COUNT(tce.id) > 0
          THEN ROUND((COUNT(tce.id) FILTER (WHERE tce.status = 'passed')::DECIMAL / COUNT(tce.id)) * 100, 2)
          ELSE 0
        END as pass_rate
      FROM test_runs tr
      LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
      WHERE tr.application_id = $1
        AND tr.status IN ('completed', 'failed', 'passed')
      GROUP BY tr.id, tr.run_id, tr.job_number, tr.job_prefix, tr.status,
               tr.branch, tr.started_at, tr.finished_at, tr.created_at
      ORDER BY tr.created_at DESC
      LIMIT $2
      `,
      [appId, limit]
    );

    res.json({
      success: true,
      jobs: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching jobs for comparison', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/comparative-analysis/compare
 * Compare two test runs and get AI-powered insights
 *
 * Body: {
 *   currentRunId: string,
 *   compareRunId: string,
 *   applicationId: string
 * }
 */
router.post('/compare', async (req, res) => {
  try {
    const { currentRunId, compareRunId, applicationId } = req.body;

    console.log('=== Comparative Analysis Request ===');
    console.log('Body:', req.body);
    console.log('currentRunId:', currentRunId);
    console.log('compareRunId:', compareRunId);
    console.log('applicationId:', applicationId);

    if (!currentRunId || !compareRunId || !applicationId) {
      return res.status(400).json({
        success: false,
        error: 'currentRunId, compareRunId, and applicationId are required'
      });
    }

    logger.info('Starting comparative analysis', { currentRunId, compareRunId, applicationId });

    // 1. Fetch current run details
    const currentRunResult = await pool.query(
      `
      SELECT
        tr.id,
        tr.run_id,
        tr.job_number,
        tr.job_prefix,
        tr.status,
        tr.branch,
        tr.started_at,
        tr.finished_at,
        COUNT(tce.id) as total_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'passed') as passed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'failed') as failed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'skipped') as skipped_tests
      FROM test_runs tr
      LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
      WHERE tr.id = $1 AND tr.application_id = $2
      GROUP BY tr.id
      `,
      [currentRunId, applicationId]
    );

    // 2. Fetch compare run details
    const compareRunResult = await pool.query(
      `
      SELECT
        tr.id,
        tr.run_id,
        tr.job_number,
        tr.job_prefix,
        tr.status,
        tr.branch,
        tr.started_at,
        tr.finished_at,
        COUNT(tce.id) as total_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'passed') as passed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'failed') as failed_tests,
        COUNT(tce.id) FILTER (WHERE tce.status = 'skipped') as skipped_tests
      FROM test_runs tr
      LEFT JOIN test_case_executions tce ON tce.test_run_id = tr.id
      WHERE tr.id = $1 AND tr.application_id = $2
      GROUP BY tr.id
      `,
      [compareRunId, applicationId]
    );

    if (currentRunResult.rows.length === 0 || compareRunResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'One or both runs not found'
      });
    }

    const currentRun = currentRunResult.rows[0];
    const compareRun = compareRunResult.rows[0];

    // 3. Get test-level comparison (which tests changed status)
    const testComparisonResult = await pool.query(
      `
      WITH current_tests AS (
        SELECT
          tcm.id as test_id,
          tcm.test_key,
          tcm.test_key as test_name,
          tce.status as current_status,
          tce.error_message as current_error,
          tce.error_stack as current_stack,
          tce.duration_ms as current_duration
        FROM test_case_executions tce
        JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
        WHERE tce.test_run_id = $1
      ),
      compare_tests AS (
        SELECT
          tcm.id as test_id,
          tcm.test_key,
          tcm.test_key as test_name,
          tce.status as compare_status,
          tce.error_message as compare_error,
          tce.error_stack as compare_stack,
          tce.duration_ms as compare_duration
        FROM test_case_executions tce
        JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
        WHERE tce.test_run_id = $2
      )
      SELECT
        COALESCE(ct.test_id, cpt.test_id) as test_id,
        COALESCE(ct.test_key, cpt.test_key) as test_key,
        COALESCE(ct.test_key, cpt.test_key) as test_name,
        ct.current_status,
        ct.current_error,
        ct.current_stack,
        ct.current_duration,
        cpt.compare_status,
        cpt.compare_error,
        cpt.compare_stack,
        cpt.compare_duration,
        CASE
          WHEN ct.current_status IS NULL THEN 'removed'
          WHEN cpt.compare_status IS NULL THEN 'new'
          WHEN ct.current_status = 'failed' AND cpt.compare_status = 'passed' THEN 'regression'
          WHEN ct.current_status = 'passed' AND cpt.compare_status = 'failed' THEN 'fixed'
          WHEN ct.current_status = 'failed' AND cpt.compare_status = 'failed' THEN 'still_failing'
          WHEN ct.current_status = 'passed' AND cpt.compare_status = 'passed' THEN 'still_passing'
          ELSE 'changed'
        END as change_type
      FROM current_tests ct
      FULL OUTER JOIN compare_tests cpt ON ct.test_id = cpt.test_id
      ORDER BY
        CASE
          WHEN ct.current_status = 'failed' AND cpt.compare_status = 'passed' THEN 1  -- Regressions first
          WHEN ct.current_status IS NULL THEN 2  -- Removed tests
          WHEN cpt.compare_status IS NULL THEN 3  -- New tests
          WHEN ct.current_status = 'failed' AND cpt.compare_status = 'failed' THEN 4  -- Still failing
          ELSE 5
        END
      `,
      [currentRunId, compareRunId]
    );

    const testComparison = testComparisonResult.rows;

    // 4. Categorize changes
    const regressions = testComparison.filter(t => t.change_type === 'regression');
    const fixes = testComparison.filter(t => t.change_type === 'fixed');
    const newTests = testComparison.filter(t => t.change_type === 'new');
    const removedTests = testComparison.filter(t => t.change_type === 'removed');
    const stillFailing = testComparison.filter(t => t.change_type === 'still_failing');
    const stillPassing = testComparison.filter(t => t.change_type === 'still_passing');

    // 5. Calculate metrics
    const metrics = {
      currentRun: {
        totalTests: parseInt(currentRun.total_tests),
        passedTests: parseInt(currentRun.passed_tests),
        failedTests: parseInt(currentRun.failed_tests),
        skippedTests: parseInt(currentRun.skipped_tests),
        passRate: currentRun.total_tests > 0
          ? ((parseInt(currentRun.passed_tests) / parseInt(currentRun.total_tests)) * 100).toFixed(2)
          : 0
      },
      compareRun: {
        totalTests: parseInt(compareRun.total_tests),
        passedTests: parseInt(compareRun.passed_tests),
        failedTests: parseInt(compareRun.failed_tests),
        skippedTests: parseInt(compareRun.skipped_tests),
        passRate: compareRun.total_tests > 0
          ? ((parseInt(compareRun.passed_tests) / parseInt(compareRun.total_tests)) * 100).toFixed(2)
          : 0
      },
      changes: {
        regressions: regressions.length,
        fixes: fixes.length,
        newTests: newTests.length,
        removedTests: removedTests.length,
        stillFailing: stillFailing.length,
        stillPassing: stillPassing.length
      }
    };

    // 6. Prepare data for AI analysis (focus on regressions and new failures)
    const failuresToAnalyze = [
      ...regressions.map(t => ({
        testName: t.test_name,
        testKey: t.test_key,
        changeType: 'regression',
        currentError: t.current_error,
        currentStack: t.current_stack,
        previousStatus: t.compare_status
      })),
      ...newTests.filter(t => t.current_status === 'failed').map(t => ({
        testName: t.test_name,
        testKey: t.test_key,
        changeType: 'new_failure',
        currentError: t.current_error,
        currentStack: t.current_stack,
        previousStatus: 'not_existed'
      }))
    ].slice(0, 10); // Limit to 10 most critical failures

    // 7. Call Python AI for comparative analysis (if failures exist)
    let aiInsights = null;
    if (failuresToAnalyze.length > 0) {
      try {
        const aiResponse = await fetch(`${PYTHON_API_URL}/api/comparative-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentRun: {
              jobNumber: currentRun.job_number,
              branch: currentRun.branch,
              totalTests: metrics.currentRun.totalTests,
              failedTests: metrics.currentRun.failedTests,
              passRate: metrics.currentRun.passRate
            },
            compareRun: {
              jobNumber: compareRun.job_number,
              branch: compareRun.branch,
              totalTests: metrics.compareRun.totalTests,
              failedTests: metrics.compareRun.failedTests,
              passRate: metrics.compareRun.passRate
            },
            failures: failuresToAnalyze,
            metrics: metrics.changes
          })
        });

        if (aiResponse.ok) {
          aiInsights = await aiResponse.json();
        } else {
          logger.warn('AI comparative analysis failed', { status: aiResponse.status });
        }
      } catch (aiError) {
        logger.error('Error calling AI for comparative analysis', { error: aiError });
        // Continue without AI insights
      }
    }

    // 8. Return comprehensive comparison
    res.json({
      success: true,
      currentRun: {
        id: currentRun.id,
        runId: currentRun.run_id,
        jobNumber: currentRun.job_number,
        branch: currentRun.branch,
        status: currentRun.status,
        startedAt: currentRun.started_at,
        finishedAt: currentRun.finished_at,
        metrics: metrics.currentRun
      },
      compareRun: {
        id: compareRun.id,
        runId: compareRun.run_id,
        jobNumber: compareRun.job_number,
        branch: compareRun.branch,
        status: compareRun.status,
        startedAt: compareRun.started_at,
        finishedAt: compareRun.finished_at,
        metrics: metrics.compareRun
      },
      changes: metrics.changes,
      regressions: regressions.map(t => ({
        testId: t.test_id,
        testName: t.test_name,
        testKey: t.test_key,
        currentError: t.current_error,
        previousStatus: t.compare_status
      })),
      fixes: fixes.map(t => ({
        testId: t.test_id,
        testName: t.test_name,
        testKey: t.test_key
      })),
      newTests: newTests.map(t => ({
        testId: t.test_id,
        testName: t.test_name,
        testKey: t.test_key,
        status: t.current_status
      })),
      aiInsights: aiInsights || {
        available: false,
        message: failuresToAnalyze.length === 0
          ? 'No failures to analyze'
          : 'AI analysis unavailable'
      }
    });

  } catch (error) {
    logger.error('Error performing comparative analysis', { error });
    console.error('Comparative analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform comparative analysis',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

export default router;
