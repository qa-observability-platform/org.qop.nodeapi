/**
 * Pattern Learning Repository
 *
 * Database operations for pattern learning system:
 * - Proven solutions CRUD
 * - Solution outcome tracking
 * - Pattern analytics
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/**
 * Proven solution record
 */
export interface ProvenSolution {
  id: string;
  pattern_signature_id: string;
  application_id: string;
  solution_hash: string;
  suggested_fix: string;
  root_cause_analysis?: string;
  fix_category?: string;
  original_ai_provider?: string;
  original_ai_model?: string;
  original_confidence?: number;
  times_suggested: number;
  times_successful: number;
  times_failed: number;
  success_rate: number;
  confidence_score: number;
  status: 'active' | 'deprecated' | 'superseded';
  avg_resolution_time_ms?: number;
  first_success_at?: Date;
  last_success_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Solution outcome tracking record
 */
export interface SolutionOutcomeTracking {
  id: string;
  test_case_master_id: string;
  failed_execution_id: string;
  ai_analysis_id?: string;
  pattern_signature_id?: string;
  proven_solution_id?: string;
  solution_shown_at: Date;
  solution_source: 'fresh_ai' | 'cached_pattern' | 'hybrid';
  was_cached: boolean;
  next_execution_id?: string;
  next_execution_status?: string;
  resolution_successful?: boolean;
  test_key: string;
  application_id: string;
}

export class PatternLearningRepository {
  /**
   * Get best proven solution for a pattern
   *
   * @param patternId - Pattern signature ID
   * @returns Best solution or null
   */
  async getBestSolution(patternId: string): Promise<ProvenSolution | null> {
    try {
      const result = await pool.query<ProvenSolution>(
        `
        SELECT * FROM proven_solutions
        WHERE pattern_signature_id = $1
          AND status = 'active'
        ORDER BY
          confidence_score DESC,
          success_rate DESC,
          times_successful DESC
        LIMIT 1
        `,
        [patternId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting best solution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        patternId
      });
      return null;
    }
  }

  /**
   * Save or update proven solution
   *
   * @param data - Solution data
   * @returns Solution ID
   */
  async saveProvenSolution(data: {
    pattern_signature_id: string;
    application_id: string;
    suggested_fix: string;
    root_cause_analysis?: string;
    fix_category?: string;
    original_ai_provider: string;
    original_ai_model: string;
    original_confidence: number;
  }): Promise<string> {
    try {
      // Generate solution hash
      const crypto = await import('crypto');
      const solutionHash = crypto
        .createHash('sha256')
        .update(data.suggested_fix)
        .digest('hex');

      const result = await pool.query(
        `
        INSERT INTO proven_solutions (
          pattern_signature_id, application_id, solution_hash,
          suggested_fix, root_cause_analysis, fix_category,
          original_ai_provider, original_ai_model, original_confidence,
          times_suggested, confidence_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)
        ON CONFLICT (pattern_signature_id, solution_hash)
        DO UPDATE SET
          times_suggested = proven_solutions.times_suggested + 1,
          updated_at = NOW()
        RETURNING id
        `,
        [
          data.pattern_signature_id,
          data.application_id,
          solutionHash,
          data.suggested_fix,
          data.root_cause_analysis || null,
          data.fix_category || null,
          data.original_ai_provider,
          data.original_ai_model,
          data.original_confidence,
          data.original_confidence  // Initial confidence_score = original AI confidence
        ]
      );

      const solutionId = result.rows[0].id;

      logger.debug('Proven solution saved', {
        solution_id: solutionId,
        pattern_id: data.pattern_signature_id,
        fix_category: data.fix_category
      });

      return solutionId;
    } catch (error) {
      logger.error('Error saving proven solution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pattern_id: data.pattern_signature_id
      });
      throw error;
    }
  }

  /**
   * Create solution outcome tracking record
   *
   * @param data - Tracking data
   * @returns Tracking ID
   */
  async createOutcomeTracking(data: {
    test_case_master_id: string;
    failed_execution_id: string;
    ai_analysis_id?: string;
    pattern_signature_id?: string;
    proven_solution_id?: string;
    solution_source: 'fresh_ai' | 'cached_pattern' | 'hybrid';
    was_cached: boolean;
    test_key: string;
    application_id: string;
  }): Promise<string> {
    try {
      const result = await pool.query(
        `
        INSERT INTO solution_outcome_tracking (
          test_case_master_id, failed_execution_id, ai_analysis_id,
          pattern_signature_id, proven_solution_id, solution_source,
          was_cached, test_key, application_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        `,
        [
          data.test_case_master_id,
          data.failed_execution_id,
          data.ai_analysis_id || null,
          data.pattern_signature_id || null,
          data.proven_solution_id || null,
          data.solution_source,
          data.was_cached,
          data.test_key,
          data.application_id
        ]
      );

      const trackingId = result.rows[0].id;

      logger.debug('Outcome tracking created', {
        tracking_id: trackingId,
        test_key: data.test_key,
        solution_source: data.solution_source
      });

      return trackingId;
    } catch (error) {
      logger.error('Error creating outcome tracking', {
        error: error instanceof Error ? error.message : 'Unknown error',
        test_key: data.test_key
      });
      throw error;
    }
  }

  /**
   * Get pattern learning statistics for an application
   *
   * @param applicationId - Application ID
   * @param periodType - 'daily', 'weekly', 'monthly'
   * @param limit - Number of periods to return
   * @returns Analytics records
   */
  async getPatternAnalytics(
    applicationId: string,
    periodType: 'daily' | 'weekly' | 'monthly' = 'weekly',
    limit: number = 12
  ): Promise<any[]> {
    try {
      const result = await pool.query(
        `
        SELECT * FROM pattern_learning_analytics
        WHERE application_id = $1 AND period_type = $2
        ORDER BY period_start DESC
        LIMIT $3
        `,
        [applicationId, periodType, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting pattern analytics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        applicationId
      });
      return [];
    }
  }

  /**
   * Get top performing patterns for an application
   *
   * @param applicationId - Application ID
   * @param limit - Number of patterns to return
   * @returns Top patterns with solutions
   */
  async getTopPatterns(applicationId: string, limit: number = 10): Promise<any[]> {
    try {
      const result = await pool.query(
        `
        SELECT
          eps.id as pattern_id,
          eps.pattern_type,
          eps.error_message_pattern,
          eps.occurrence_count,
          ps.id as solution_id,
          ps.suggested_fix,
          ps.success_rate,
          ps.times_successful,
          ps.times_failed,
          ps.confidence_score,
          ps.avg_resolution_time_ms
        FROM error_pattern_signatures eps
        JOIN proven_solutions ps ON ps.pattern_signature_id = eps.id
        WHERE eps.application_id = $1
          AND ps.status = 'active'
          AND ps.times_successful >= 3
        ORDER BY ps.success_rate DESC, ps.times_successful DESC
        LIMIT $2
        `,
        [applicationId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting top patterns', {
        error: error instanceof Error ? error.message : 'Unknown error',
        applicationId
      });
      return [];
    }
  }

  /**
   * Get pattern learning statistics overview
   *
   * @param applicationId - Application ID
   * @returns Statistics object
   */
  async getPatternStats(applicationId: string): Promise<{
    total_patterns: number;
    active_solutions: number;
    deprecated_solutions: number;
    avg_success_rate: number;
    cache_hit_rate_7d: number;
  }> {
    try {
      const result = await pool.query(
        `
        WITH stats AS (
          SELECT
            COUNT(DISTINCT eps.id) as total_patterns,
            COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'active') as active_solutions,
            COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'deprecated') as deprecated_solutions,
            AVG(ps.success_rate) FILTER (WHERE ps.status = 'active') as avg_success_rate
          FROM error_pattern_signatures eps
          LEFT JOIN proven_solutions ps ON ps.pattern_signature_id = eps.id
          WHERE eps.application_id = $1
        ),
        cache_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE was_cached = true) as cached_count,
            COUNT(*) as total_count
          FROM solution_outcome_tracking
          WHERE application_id = $1
            AND solution_shown_at > NOW() - INTERVAL '7 days'
        )
        SELECT
          s.total_patterns,
          s.active_solutions,
          s.deprecated_solutions,
          COALESCE(s.avg_success_rate, 0) as avg_success_rate,
          CASE
            WHEN cs.total_count > 0 THEN (cs.cached_count::DECIMAL / cs.total_count * 100)
            ELSE 0
          END as cache_hit_rate_7d
        FROM stats s, cache_stats cs
        `,
        [applicationId]
      );

      return result.rows[0] || {
        total_patterns: 0,
        active_solutions: 0,
        deprecated_solutions: 0,
        avg_success_rate: 0,
        cache_hit_rate_7d: 0
      };
    } catch (error) {
      logger.error('Error getting pattern stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
        applicationId
      });

      return {
        total_patterns: 0,
        active_solutions: 0,
        deprecated_solutions: 0,
        avg_success_rate: 0,
        cache_hit_rate_7d: 0
      };
    }
  }

  /**
   * Mark stale outcome tracking records
   * (No execution after 7 days)
   */
  async markStaleOutcomes(): Promise<number> {
    try {
      const result = await pool.query(
        `
        UPDATE solution_outcome_tracking
        SET
          next_execution_status = 'not_run',
          outcome_detected_at = NOW(),
          notes = 'No execution within 7 days - marked as stale',
          updated_at = NOW()
        WHERE next_execution_id IS NULL
          AND solution_shown_at < NOW() - INTERVAL '7 days'
          AND next_execution_status IS NULL
        `
      );

      const count = result.rowCount || 0;

      if (count > 0) {
        logger.info('Marked stale outcome tracking records', { count });
      }

      return count;
    } catch (error) {
      logger.error('Error marking stale outcomes', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Auto-deprecate underperforming solutions
   * (Success rate < 40% with at least 5 attempts)
   */
  async deprecateUnderperforming(): Promise<number> {
    try {
      const result = await pool.query(
        `
        UPDATE proven_solutions
        SET
          status = 'deprecated',
          deprecated_at = NOW(),
          deprecation_reason = 'Success rate below 40% threshold'
        WHERE status = 'active'
          AND success_rate < 40.00
          AND (times_successful + times_failed) >= 5
        `
      );

      const count = result.rowCount || 0;

      if (count > 0) {
        logger.info('Auto-deprecated underperforming solutions', { count });
      }

      return count;
    } catch (error) {
      logger.error('Error deprecating underperforming solutions', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }
}

// Singleton instance
export const patternLearningRepository = new PatternLearningRepository();
