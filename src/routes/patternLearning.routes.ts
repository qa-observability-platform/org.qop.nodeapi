/**
 * Pattern Learning API Routes
 *
 * Endpoints for pattern insights dashboard:
 * - Statistics overview
 * - Top performing patterns
 * - Learning progress over time
 * - Cost savings metrics
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/pattern-learning/statistics/:applicationId
 * Get pattern statistics for an application
 */
router.get('/statistics/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const timeRange = (req.query.timeRange as string) || '30d';

    // Calculate date range
    const days = parseInt(timeRange.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await pool.query(
      `
      SELECT
        COUNT(DISTINCT eps.id) as total_patterns,
        COUNT(DISTINCT CASE WHEN ps.status = 'active' THEN ps.id END) as active_solutions,
        COUNT(DISTINCT CASE WHEN ps.status = 'deprecated' THEN ps.id END) as deprecated_solutions,
        COALESCE(
          (
            SELECT SUM(cached_responses_used)::FLOAT / NULLIF(SUM(cached_responses_used + ai_responses_used), 0) * 100
            FROM pattern_learning_analytics
            WHERE application_id = $1
              AND period_start >= $2
          ),
          0
        ) as cache_hit_rate,
        COALESCE(
          (
            SELECT AVG(pattern_accuracy_rate)
            FROM pattern_learning_analytics
            WHERE application_id = $1
              AND period_start >= $2
          ),
          0
        ) as avg_accuracy
      FROM error_pattern_signatures eps
      LEFT JOIN proven_solutions ps ON ps.pattern_signature_id = eps.id
      WHERE eps.application_id = $1
        AND eps.created_at >= $2
      `,
      [applicationId, startDate]
    );

    const statistics = {
      totalPatterns: parseInt(result.rows[0]?.total_patterns || 0),
      activeSolutions: parseInt(result.rows[0]?.active_solutions || 0),
      deprecatedSolutions: parseInt(result.rows[0]?.deprecated_solutions || 0),
      cacheHitRate: parseFloat(result.rows[0]?.cache_hit_rate || 0),
      avgAccuracy: parseFloat(result.rows[0]?.avg_accuracy || 0),
    };

    res.json(statistics);
  } catch (error) {
    logger.error('Error fetching pattern statistics', { error });
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /api/pattern-learning/top-patterns/:applicationId
 * Get top performing patterns with their solutions
 */
router.get('/top-patterns/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const limit = parseInt((req.query.limit as string) || '10');

    const result = await pool.query(
      `
      SELECT
        eps.id,
        eps.pattern_type,
        eps.error_message_pattern,
        eps.occurrence_count,
        ps.success_rate,
        ps.times_successful,
        ps.times_failed,
        ps.confidence_score,
        ps.avg_response_time_ms
      FROM error_pattern_signatures eps
      INNER JOIN proven_solutions ps ON ps.pattern_signature_id = eps.id
      WHERE eps.application_id = $1
        AND ps.status = 'active'
        AND ps.times_successful > 0
      ORDER BY
        ps.success_rate DESC,
        ps.times_successful DESC,
        ps.confidence_score DESC
      LIMIT $2
      `,
      [applicationId, limit]
    );

    const patterns = result.rows.map((row) => ({
      id: row.id,
      patternType: row.pattern_type,
      errorMessagePattern: row.error_message_pattern,
      occurrenceCount: parseInt(row.occurrence_count),
      successRate: parseFloat(row.success_rate),
      timesSuccessful: parseInt(row.times_successful),
      timesFailed: parseInt(row.times_failed),
      confidenceScore: parseFloat(row.confidence_score),
      avgResponseTime: parseFloat(row.avg_response_time_ms || 0),
    }));

    res.json({ patterns });
  } catch (error) {
    logger.error('Error fetching top patterns', { error });
    res.status(500).json({ error: 'Failed to fetch top patterns' });
  }
});

/**
 * GET /api/pattern-learning/progress/:applicationId
 * Get learning progress over time (weekly aggregation)
 */
router.get('/progress/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const timeRange = (req.query.timeRange as string) || '30d';

    // Calculate date range
    const days = parseInt(timeRange.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await pool.query(
      `
      SELECT
        period_start,
        period_end,
        cached_responses_used,
        cached_solutions_successful,
        ai_api_calls_saved,
        pattern_accuracy_rate,
        (ai_api_calls_saved * 0.01) as cost_savings
      FROM pattern_learning_analytics
      WHERE application_id = $1
        AND period_start >= $2
      ORDER BY period_start ASC
      `,
      [applicationId, startDate]
    );

    const progress = result.rows.map((row) => ({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      cachedResponsesUsed: parseInt(row.cached_responses_used),
      cachedSolutionsSuccessful: parseInt(row.cached_solutions_successful),
      aiApiCallsSaved: parseInt(row.ai_api_calls_saved),
      patternAccuracyRate: parseFloat(row.pattern_accuracy_rate),
      costSavings: parseFloat(row.cost_savings),
    }));

    res.json({ progress });
  } catch (error) {
    logger.error('Error fetching learning progress', { error });
    res.status(500).json({ error: 'Failed to fetch learning progress' });
  }
});

/**
 * GET /api/pattern-learning/cost-metrics/:applicationId
 * Get cost savings and performance metrics
 */
router.get('/cost-metrics/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const timeRange = (req.query.timeRange as string) || '30d';

    // Calculate date range
    const days = parseInt(timeRange.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await pool.query(
      `
      SELECT
        SUM(ai_api_calls_saved) as total_api_calls_saved,
        SUM(ai_api_calls_saved * 0.01) as estimated_cost_savings,
        AVG(
          CASE
            WHEN cached_responses_used > 0
            THEN (SELECT AVG(avg_response_time_ms) FROM proven_solutions WHERE pattern_signature_id IN (SELECT id FROM error_pattern_signatures WHERE application_id = $1))
            ELSE NULL
          END
        ) as avg_cached_response_time,
        2500.0 as avg_ai_response_time
      FROM pattern_learning_analytics
      WHERE application_id = $1
        AND period_start >= $2
      `,
      [applicationId, startDate]
    );

    const row = result.rows[0];
    const avgCachedResponseTime = parseFloat(row.avg_cached_response_time || 100);
    const avgAiResponseTime = parseFloat(row.avg_ai_response_time || 2500);

    const costMetrics = {
      totalApiCallsSaved: parseInt(row.total_api_calls_saved || 0),
      estimatedCostSavings: parseFloat(row.estimated_cost_savings || 0),
      avgCachedResponseTime,
      avgAiResponseTime,
      timeEfficiencyGain: avgAiResponseTime / avgCachedResponseTime,
    };

    res.json(costMetrics);
  } catch (error) {
    logger.error('Error fetching cost metrics', { error });
    res.status(500).json({ error: 'Failed to fetch cost metrics' });
  }
});

export default router;
