/**
 * Pattern Learning Feedback Job
 *
 * Runs every 5 minutes to:
 * - Link pending outcome tracking to new test executions
 * - Mark stale outcomes (no execution after 7 days)
 * - Update proven solution statistics
 *
 * This job handles the feedback loop that makes the system learn over time.
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import { logger } from '../utils/logger.js';
import { pool } from '../db/pool.js';
import { patternLearningRepository } from '../repositories/patternLearning.repository.js';

export class PatternLearningFeedbackJob {
  private intervalId: NodeJS.Timeout | null = null;
  private runIntervalMs: number = 5 * 60 * 1000; // 5 minutes

  /**
   * Start the job (runs every 5 minutes)
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Pattern learning feedback job already running');
      return;
    }

    logger.info('🧠 Starting pattern learning feedback job', {
      interval_ms: this.runIntervalMs,
    });

    // Run immediately on start
    this.run().catch((error) => {
      logger.error('Initial pattern learning feedback job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Pattern learning feedback job failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, this.runIntervalMs);
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Pattern learning feedback job stopped');
    }
  }

  /**
   * Main job execution
   */
  async run(): Promise<void> {
    const startTime = Date.now();

    logger.info('🔄 Running pattern learning feedback job...');

    try {
      // Step 1: Find pending outcomes that now have executions
      const pendingOutcomes = await this._findPendingOutcomesWithExecutions();

      logger.info('📊 Found pending outcomes with new executions', {
        count: pendingOutcomes.length,
      });

      // Step 2: Process each outcome
      let successCount = 0;
      let failureCount = 0;

      for (const outcome of pendingOutcomes) {
        try {
          await this._processOutcome(outcome);
          successCount++;
        } catch (error) {
          failureCount++;
          logger.error('Failed to process outcome', {
            tracking_id: outcome.tracking_id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Step 3: Mark stale outcomes (no execution after 7 days)
      const staleCount = await patternLearningRepository.markStaleOutcomes();

      // Step 4: Auto-deprecate underperforming solutions
      const deprecatedCount = await patternLearningRepository.deprecateUnderperforming();

      const durationMs = Date.now() - startTime;

      logger.info('✅ Pattern learning feedback job complete', {
        duration_ms: durationMs,
        outcomes_processed: successCount,
        outcomes_failed: failureCount,
        stale_marked: staleCount,
        solutions_deprecated: deprecatedCount,
      });
    } catch (error) {
      logger.error('Pattern learning feedback job error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Find pending outcome tracking records that now have new executions
   */
  private async _findPendingOutcomesWithExecutions(): Promise<any[]> {
    const result = await pool.query(`
      SELECT
        sot.id as tracking_id,
        sot.test_case_master_id,
        sot.failed_execution_id,
        sot.proven_solution_id,
        sot.pattern_signature_id,
        sot.solution_shown_at,
        tce_failed.created_at as failed_at,
        tce_next.id as next_execution_id,
        tce_next.status as next_status,
        tce_next.created_at as next_execution_at
      FROM solution_outcome_tracking sot
      JOIN test_case_executions tce_failed ON tce_failed.id = sot.failed_execution_id
      LEFT JOIN LATERAL (
        SELECT id, status, created_at
        FROM test_case_executions
        WHERE test_case_master_id = sot.test_case_master_id
          AND created_at > sot.solution_shown_at
          AND status IN ('passed', 'failed', 'skipped')
        ORDER BY created_at ASC
        LIMIT 1
      ) tce_next ON true
      WHERE sot.next_execution_id IS NULL
        AND tce_next.id IS NOT NULL
    `);

    return result.rows;
  }

  /**
   * Process a single outcome
   * Note: The PostgreSQL trigger will handle updating proven_solutions stats
   */
  private async _processOutcome(outcome: any): Promise<void> {
    const isSuccess = outcome.next_status === 'passed';
    const timeToResolution = new Date(outcome.next_execution_at).getTime() - new Date(outcome.failed_at).getTime();

    // The trigger will automatically update proven_solutions when we update the outcome tracking
    // We just need to update the outcome tracking record

    logger.debug('📝 Updating outcome tracking', {
      tracking_id: outcome.tracking_id,
      next_execution_id: outcome.next_execution_id,
      next_status: outcome.next_status,
      is_success: isSuccess,
    });

    // Note: This update will fire the detect_pattern_outcome() trigger
    // which will update proven_solutions statistics automatically
    await pool.query(
      `
      UPDATE solution_outcome_tracking
      SET
        next_execution_id = $2,
        next_execution_status = $3,
        next_execution_at = $4,
        outcome_detected_at = NOW(),
        time_to_next_execution_ms = $5,
        resolution_successful = $6,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        outcome.tracking_id,
        outcome.next_execution_id,
        outcome.next_status,
        outcome.next_execution_at,
        timeToResolution,
        isSuccess,
      ]
    );

    logger.info(`${isSuccess ? '✅' : '❌'} Outcome detected`, {
      tracking_id: outcome.tracking_id,
      result: isSuccess ? 'SUCCESS' : 'FAILED',
      time_to_resolution_ms: timeToResolution,
    });
  }
}

// Singleton instance
export const patternLearningFeedbackJob = new PatternLearningFeedbackJob();
