/**
 * Pattern Learning Analytics Job
 *
 * Runs daily at midnight to aggregate pattern learning metrics:
 * - Cache hit rates
 * - Success rates
 * - Cost savings (AI calls avoided)
 * - Learning velocity
 *
 * Populates pattern_learning_analytics table for dashboard display.
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import { logger } from '../utils/logger.js';
import { pool } from '../db/pool.js';

export class PatternLearningAnalyticsJob {
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the job (runs daily at midnight)
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Pattern learning analytics job already running');
      return;
    }

    logger.info('📊 Starting pattern learning analytics job');

    // Calculate milliseconds until next midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    // Run at midnight, then every 24 hours
    setTimeout(() => {
      this.run().catch((error) => {
        logger.error('Initial pattern learning analytics job failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

      // Run every 24 hours after first run
      this.intervalId = setInterval(() => {
        this.run().catch((error) => {
          logger.error('Pattern learning analytics job failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Pattern learning analytics job stopped');
    }
  }

  /**
   * Main job execution
   */
  async run(): Promise<void> {
    const startTime = Date.now();

    logger.info('📈 Running pattern learning analytics aggregation...');

    try {
      // Get all applications
      const applications = await this._getApplications();

      logger.info('Found applications to analyze', {
        count: applications.length,
      });

      // Generate analytics for each application
      for (const app of applications) {
        await this._generateDailyAnalytics(app.id);
      }

      const durationMs = Date.now() - startTime;

      logger.info('✅ Pattern learning analytics aggregation complete', {
        duration_ms: durationMs,
        applications_processed: applications.length,
      });
    } catch (error) {
      logger.error('Pattern learning analytics job error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get all applications
   */
  private async _getApplications(): Promise<Array<{ id: string }>> {
    const result = await pool.query('SELECT id FROM applications');
    return result.rows;
  }

  /**
   * Generate daily analytics for an application
   */
  private async _generateDailyAnalytics(applicationId: string): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = yesterday.toISOString().split('T')[0];

    logger.debug('Generating analytics for application', {
      application_id: applicationId,
      date: yesterdayDate,
    });

    try {
      // Gather metrics
      const stats = await pool.query(
        `
        SELECT
          COUNT(DISTINCT tce.id) FILTER (WHERE tce.status = 'failed') as total_failures_analyzed,
          COUNT(DISTINCT sot.id) FILTER (WHERE sot.pattern_signature_id IS NOT NULL) as patterns_matched,
          COUNT(DISTINCT eps.id) FILTER (WHERE DATE(eps.created_at) = $2) as new_patterns_created,
          COUNT(DISTINCT sot.id) FILTER (WHERE sot.solution_source = 'fresh_ai') as fresh_ai_calls,
          COUNT(DISTINCT sot.id) FILTER (WHERE sot.was_cached = true) as cached_responses_used,
          COUNT(*) FILTER (WHERE sot.was_cached = true AND sot.resolution_successful = true) as cached_successful,
          COUNT(*) FILTER (WHERE sot.was_cached = true AND sot.resolution_successful = false) as cached_failed,
          COUNT(*) FILTER (WHERE sot.solution_source = 'fresh_ai' AND sot.resolution_successful = true) as fresh_ai_successful,
          COUNT(*) FILTER (WHERE sot.solution_source = 'fresh_ai' AND sot.resolution_successful = false) as fresh_ai_failed
        FROM test_case_executions tce
        LEFT JOIN solution_outcome_tracking sot ON sot.failed_execution_id = tce.id
        LEFT JOIN error_pattern_signatures eps ON eps.id = sot.pattern_signature_id
        WHERE tce.application_id = $1
          AND DATE(tce.created_at) = $2
        `,
        [applicationId, yesterdayDate]
      );

      const row = stats.rows[0];

      // Calculate derived metrics
      const aiCallsSaved = parseInt(row.cached_responses_used || 0);
      const costSavedUsd = aiCallsSaved * 0.01; // Estimate $0.01 per AI call
      const cachedTotal = parseInt(row.cached_successful || 0) + parseInt(row.cached_failed || 0);
      const patternAccuracy = cachedTotal > 0
        ? (parseInt(row.cached_successful || 0) / cachedTotal) * 100
        : 0;

      // Insert or update analytics
      await pool.query(
        `
        INSERT INTO pattern_learning_analytics (
          application_id, period_start, period_end, period_type,
          total_failures_analyzed, patterns_matched, new_patterns_created,
          fresh_ai_calls, cached_responses_used, cached_solutions_successful,
          cached_solutions_failed, fresh_ai_successful, fresh_ai_failed,
          ai_api_calls_saved, estimated_cost_saved_usd, pattern_accuracy_rate
        ) VALUES ($1, $2, $2, 'daily', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (application_id, period_start, period_end, period_type)
        DO UPDATE SET
          total_failures_analyzed = EXCLUDED.total_failures_analyzed,
          patterns_matched = EXCLUDED.patterns_matched,
          new_patterns_created = EXCLUDED.new_patterns_created,
          fresh_ai_calls = EXCLUDED.fresh_ai_calls,
          cached_responses_used = EXCLUDED.cached_responses_used,
          cached_solutions_successful = EXCLUDED.cached_solutions_successful,
          cached_solutions_failed = EXCLUDED.cached_solutions_failed,
          fresh_ai_successful = EXCLUDED.fresh_ai_successful,
          fresh_ai_failed = EXCLUDED.fresh_ai_failed,
          ai_api_calls_saved = EXCLUDED.ai_api_calls_saved,
          estimated_cost_saved_usd = EXCLUDED.estimated_cost_saved_usd,
          pattern_accuracy_rate = EXCLUDED.pattern_accuracy_rate
        `,
        [
          applicationId,
          yesterdayDate,
          row.total_failures_analyzed || 0,
          row.patterns_matched || 0,
          row.new_patterns_created || 0,
          row.fresh_ai_calls || 0,
          row.cached_responses_used || 0,
          row.cached_successful || 0,
          row.cached_failed || 0,
          row.fresh_ai_successful || 0,
          row.fresh_ai_failed || 0,
          aiCallsSaved,
          costSavedUsd,
          patternAccuracy,
        ]
      );

      logger.debug('Analytics saved for application', {
        application_id: applicationId,
        date: yesterdayDate,
        cache_hit_rate: row.cached_responses_used,
        pattern_accuracy: patternAccuracy.toFixed(2),
        cost_saved: `$${costSavedUsd.toFixed(2)}`,
      });
    } catch (error) {
      logger.error('Failed to generate analytics for application', {
        application_id: applicationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Generate weekly analytics (called manually or via separate schedule)
   */
  async generateWeeklyAnalytics(applicationId: string): Promise<void> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);

    logger.info('Generating weekly analytics', {
      application_id: applicationId,
      period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    });

    // Aggregate daily data into weekly
    const result = await pool.query(
      `
      SELECT
        SUM(total_failures_analyzed) as total_failures,
        SUM(patterns_matched) as patterns_matched,
        SUM(new_patterns_created) as new_patterns,
        SUM(fresh_ai_calls) as fresh_ai_calls,
        SUM(cached_responses_used) as cached_used,
        SUM(cached_solutions_successful) as cached_successful,
        SUM(cached_solutions_failed) as cached_failed,
        AVG(pattern_accuracy_rate) as avg_accuracy
      FROM pattern_learning_analytics
      WHERE application_id = $1
        AND period_type = 'daily'
        AND period_start >= $2
        AND period_start <= $3
      `,
      [applicationId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
    );

    const data = result.rows[0];

    if (!data || !data.total_failures) {
      logger.warn('No data for weekly analytics', { application_id: applicationId });
      return;
    }

    await pool.query(
      `
      INSERT INTO pattern_learning_analytics (
        application_id, period_start, period_end, period_type,
        total_failures_analyzed, patterns_matched, new_patterns_created,
        fresh_ai_calls, cached_responses_used, cached_solutions_successful,
        cached_solutions_failed, pattern_accuracy_rate, ai_api_calls_saved,
        estimated_cost_saved_usd
      ) VALUES ($1, $2, $3, 'weekly', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (application_id, period_start, period_end, period_type)
      DO UPDATE SET
        total_failures_analyzed = EXCLUDED.total_failures_analyzed,
        patterns_matched = EXCLUDED.patterns_matched,
        new_patterns_created = EXCLUDED.new_patterns_created,
        fresh_ai_calls = EXCLUDED.fresh_ai_calls,
        cached_responses_used = EXCLUDED.cached_responses_used,
        cached_solutions_successful = EXCLUDED.cached_solutions_successful,
        cached_solutions_failed = EXCLUDED.cached_solutions_failed,
        pattern_accuracy_rate = EXCLUDED.pattern_accuracy_rate,
        ai_api_calls_saved = EXCLUDED.ai_api_calls_saved,
        estimated_cost_saved_usd = EXCLUDED.estimated_cost_saved_usd
      `,
      [
        applicationId,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
        data.total_failures || 0,
        data.patterns_matched || 0,
        data.new_patterns || 0,
        data.fresh_ai_calls || 0,
        data.cached_used || 0,
        data.cached_successful || 0,
        data.cached_failed || 0,
        data.avg_accuracy || 0,
        data.cached_used || 0,
        (data.cached_used || 0) * 0.01,
      ]
    );

    logger.info('Weekly analytics generated', {
      application_id: applicationId,
      avg_accuracy: data.avg_accuracy?.toFixed(2),
    });
  }
}

// Singleton instance
export const patternLearningAnalyticsJob = new PatternLearningAnalyticsJob();
