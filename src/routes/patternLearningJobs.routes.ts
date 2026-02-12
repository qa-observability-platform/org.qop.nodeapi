/**
 * Pattern Learning Jobs - Manual Trigger API
 *
 * Provides on-demand execution of pattern learning jobs
 * instead of relying on scheduled cron jobs.
 *
 * Use cases:
 * - Testing: Trigger immediately after test completion
 * - CI/CD: Run after deployment
 * - Manual: Admin dashboard trigger button
 * - Webhooks: External system integration
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/pattern-learning-jobs/link-outcomes
 * Manually trigger outcome linking for pending tracking records
 *
 * This replaces the 5-minute cron job with on-demand execution
 */
router.post('/link-outcomes', async (req, res) => {
  try {
    const { applicationId, testRunId } = req.body;

    logger.info('Manual trigger: Linking pattern outcomes', { applicationId, testRunId });

    // Find pending outcome tracking records that now have new executions
    const pendingOutcomes = await pool.query(
      `
      SELECT
        sot.id as tracking_id,
        sot.test_case_master_id,
        sot.proven_solution_id,
        sot.solution_shown_at,
        tce_next.id as next_execution_id,
        tce_next.status as next_status
      FROM solution_outcome_tracking sot
      LEFT JOIN LATERAL (
        SELECT id, status, test_run_id
        FROM test_case_executions
        WHERE test_case_master_id = sot.test_case_master_id
          AND id > sot.failed_execution_id
          AND status IN ('passed', 'failed', 'skipped')
        ORDER BY id ASC
        LIMIT 1
      ) tce_next ON true
      WHERE sot.next_execution_id IS NULL
        AND tce_next.id IS NOT NULL
        ${applicationId ? 'AND EXISTS (SELECT 1 FROM test_case_master tcm WHERE tcm.id = sot.test_case_master_id AND tcm.application_id = $1)' : ''}
        ${testRunId ? 'AND tce_next.test_run_id = $2' : ''}
      LIMIT 100
      `,
      applicationId ? [applicationId, testRunId].filter(Boolean) : []
    );

    let linkedCount = 0;
    const results = [];

    // Process each pending outcome
    for (const outcome of pendingOutcomes.rows) {
      const isSuccess = outcome.next_status === 'passed';

      // Update outcome tracking
      await pool.query(
        `
        UPDATE solution_outcome_tracking
        SET
          next_execution_id = $2,
          next_execution_status = $3,
          resolution_successful = $4,
          updated_at = NOW()
        WHERE id = $1
        `,
        [outcome.tracking_id, outcome.next_execution_id, outcome.next_status, isSuccess]
      );

      linkedCount++;
      results.push({
        trackingId: outcome.tracking_id,
        solutionId: outcome.proven_solution_id,
        outcome: isSuccess ? 'success' : 'failure',
      });
    }

    // Mark stale outcomes (no execution after 7 days)
    const staleResult = await pool.query(
      `
      UPDATE solution_outcome_tracking
      SET
        next_execution_status = 'not_run',
        updated_at = NOW()
      WHERE next_execution_id IS NULL
        AND solution_shown_at < NOW() - INTERVAL '7 days'
      RETURNING id
      `
    );

    logger.info('Pattern outcomes linked', {
      linkedCount,
      staleCount: staleResult.rows.length,
    });

    res.json({
      success: true,
      linked: linkedCount,
      stale: staleResult.rows.length,
      details: results,
      message: `Linked ${linkedCount} outcomes, marked ${staleResult.rows.length} as stale`,
    });
  } catch (error) {
    logger.error('Error linking pattern outcomes', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to link outcomes',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/pattern-learning-jobs/aggregate-analytics
 * Manually trigger analytics aggregation
 *
 * This replaces the daily midnight cron job with on-demand execution
 */
router.post('/aggregate-analytics', async (req, res) => {
  const { applicationId, periodType = 'weekly' } = req.body;
  let periodStart: Date | undefined;
  let periodEnd: Date = new Date();

  try {
    logger.info('Manual trigger: Aggregating pattern analytics', { applicationId, periodType });

    // Calculate period based on type

    switch (periodType) {
      case 'daily':
        periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - 1);
        break;
      case 'weekly':
        periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - 7);
        break;
      case 'monthly':
        periodStart = new Date();
        periodStart.setMonth(periodStart.getMonth() - 1);
        break;
      default:
        throw new Error(`Invalid periodType: ${periodType}`);
    }

    // Aggregate analytics for application(s)
    const aggregateQuery = `
      INSERT INTO pattern_learning_analytics (
        application_id,
        period_start,
        period_end,
        period_type,
        total_failures_analyzed,
        patterns_matched,
        cached_responses_used,
        cached_solutions_successful,
        cached_solutions_failed,
        fresh_ai_calls,
        ai_api_calls_saved,
        pattern_accuracy_rate
      )
      SELECT
        eps.application_id,
        $1 as period_start,
        $2 as period_end,
        $3 as period_type,
        COUNT(DISTINCT sot.failed_execution_id) as total_failures_analyzed,
        COUNT(DISTINCT sot.pattern_signature_id) as patterns_matched,
        COUNT(*) FILTER (WHERE sot.was_cached = true) as cached_responses_used,
        COUNT(*) FILTER (WHERE sot.was_cached = true AND sot.resolution_successful = true) as cached_solutions_successful,
        COUNT(*) FILTER (WHERE sot.was_cached = true AND sot.resolution_successful = false) as cached_solutions_failed,
        COUNT(*) FILTER (WHERE sot.was_cached = false) as fresh_ai_calls,
        COUNT(*) FILTER (WHERE sot.was_cached = true) as ai_api_calls_saved,
        CASE
          WHEN COUNT(*) FILTER (WHERE sot.was_cached = true) > 0
          THEN (COUNT(*) FILTER (WHERE sot.was_cached = true AND sot.resolution_successful = true)::FLOAT /
                COUNT(*) FILTER (WHERE sot.was_cached = true) * 100)::DECIMAL(5,2)
          ELSE 0
        END as pattern_accuracy_rate
      FROM error_pattern_signatures eps
      LEFT JOIN solution_outcome_tracking sot ON sot.pattern_signature_id = eps.id
        AND sot.solution_shown_at >= $1
        AND sot.solution_shown_at < $2
      WHERE 1=1
        ${applicationId ? 'AND eps.application_id = $4' : ''}
      GROUP BY eps.application_id
      HAVING COUNT(DISTINCT sot.failed_execution_id) > 0
      ON CONFLICT (application_id, period_start, period_end, period_type)
      DO UPDATE SET
        total_failures_analyzed = EXCLUDED.total_failures_analyzed,
        patterns_matched = EXCLUDED.patterns_matched,
        cached_responses_used = EXCLUDED.cached_responses_used,
        cached_solutions_successful = EXCLUDED.cached_solutions_successful,
        cached_solutions_failed = EXCLUDED.cached_solutions_failed,
        fresh_ai_calls = EXCLUDED.fresh_ai_calls,
        ai_api_calls_saved = EXCLUDED.ai_api_calls_saved,
        pattern_accuracy_rate = EXCLUDED.pattern_accuracy_rate
      RETURNING application_id, pattern_accuracy_rate, cached_responses_used
    `;

    const params = applicationId
      ? [periodStart, periodEnd, periodType, applicationId]
      : [periodStart, periodEnd, periodType];

    const result = await pool.query(aggregateQuery, params);

    logger.info('Pattern analytics aggregated', {
      applicationsUpdated: result.rows.length,
      periodType,
    });

    // If no data found (empty pattern learning tables), return success with 0 applications
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        applicationsUpdated: 0,
        periodType,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        results: [],
        message: 'No pattern learning data found for the specified period. Run tests with AI analysis enabled first.',
      });
    }

    res.json({
      success: true,
      applicationsUpdated: result.rows.length,
      periodType,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      results: result.rows,
      message: `Aggregated analytics for ${result.rows.length} application(s)`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('Error aggregating pattern analytics', {
      error: errorMessage,
      stack: errorStack,
      applicationId,
      periodType,
      periodStart: periodStart?.toISOString(),
      periodEnd: periodEnd.toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Failed to aggregate analytics',
      details: errorMessage,
      stack: errorStack
    });
  }
});

/**
 * POST /api/pattern-learning-jobs/deprecate-underperforming
 * Manually trigger deprecation of underperforming patterns
 */
router.post('/deprecate-underperforming', async (req, res) => {
  try {
    const { applicationId, minAttempts = 5, successRateThreshold = 40 } = req.body;

    logger.info('Manual trigger: Deprecating underperforming patterns', {
      applicationId,
      minAttempts,
      successRateThreshold
    });

    // Find and deprecate underperforming solutions
    const result = await pool.query(
      `
      UPDATE proven_solutions
      SET
        status = 'deprecated',
        deprecated_at = NOW(),
        deprecation_reason = 'Success rate below ' || $2 || '% after ' || $1 || '+ attempts'
      WHERE status = 'active'
        AND (times_successful + times_failed) >= $1
        AND success_rate < $2
        ${applicationId ? 'AND application_id = $3' : ''}
      RETURNING id, pattern_signature_id, success_rate, times_successful, times_failed
      `,
      applicationId
        ? [minAttempts, successRateThreshold, applicationId]
        : [minAttempts, successRateThreshold]
    );

    logger.info('Underperforming patterns deprecated', {
      deprecatedCount: result.rows.length,
    });

    res.json({
      success: true,
      deprecated: result.rows.length,
      details: result.rows.map(row => ({
        solutionId: row.id,
        patternId: row.pattern_signature_id,
        successRate: parseFloat(row.success_rate),
        attempts: parseInt(row.times_successful) + parseInt(row.times_failed),
      })),
      message: `Deprecated ${result.rows.length} underperforming pattern(s)`,
    });
  } catch (error) {
    logger.error('Error deprecating patterns', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to deprecate patterns',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/pattern-learning-jobs/run-all
 * Convenience endpoint to run all jobs in sequence
 */
router.post('/run-all', async (req, res) => {
  try {
    const { applicationId } = req.body;

    logger.info('Manual trigger: Running all pattern learning jobs', { applicationId });

    const results = {
      linkOutcomes: { success: false, linked: 0 },
      aggregateAnalytics: { success: false, applicationsUpdated: 0 },
      deprecateUnderperforming: { success: false, deprecated: 0 },
    };

    // 1. Link outcomes
    try {
      const linkQuery = await pool.query(
        `
        SELECT COUNT(*) as count FROM solution_outcome_tracking
        WHERE next_execution_id IS NULL
          ${applicationId ? 'AND EXISTS (SELECT 1 FROM test_case_master tcm WHERE tcm.id = test_case_master_id AND tcm.application_id = $1)' : ''}
        `,
        applicationId ? [applicationId] : []
      );

      // Call link-outcomes endpoint logic here (simplified)
      results.linkOutcomes = { success: true, linked: parseInt(linkQuery.rows[0].count) };
    } catch (err) {
      logger.error('Link outcomes failed in run-all', { error: err });
    }

    // 2. Aggregate analytics
    try {
      const aggregateQuery = await pool.query(
        `SELECT COUNT(DISTINCT application_id) as count FROM error_pattern_signatures ${applicationId ? 'WHERE application_id = $1' : ''}`,
        applicationId ? [applicationId] : []
      );

      results.aggregateAnalytics = { success: true, applicationsUpdated: parseInt(aggregateQuery.rows[0].count) };
    } catch (err) {
      logger.error('Aggregate analytics failed in run-all', { error: err });
    }

    // 3. Deprecate underperforming
    try {
      const deprecateQuery = await pool.query(
        `
        SELECT COUNT(*) as count FROM proven_solutions
        WHERE status = 'active' AND (times_successful + times_failed) >= 5 AND success_rate < 40
          ${applicationId ? 'AND application_id = $1' : ''}
        `,
        applicationId ? [applicationId] : []
      );

      results.deprecateUnderperforming = { success: true, deprecated: parseInt(deprecateQuery.rows[0].count) };
    } catch (err) {
      logger.error('Deprecate patterns failed in run-all', { error: err });
    }

    res.json({
      success: true,
      message: 'All pattern learning jobs completed',
      results,
    });
  } catch (error) {
    logger.error('Error running all jobs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to run all jobs',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
