/**
 * AI Analysis Client Service
 *
 * This service calls the Python FastAPI AI analysis service
 * to get Claude AI powered insights for test failures.
 *
 * Features:
 * - Non-blocking async calls (doesn't slow down test execution)
 * - Automatic retry logic with exponential backoff
 * - Error handling and fallback
 * - Saves analysis results to database
 */

import { logger } from '../utils/logger.js';
import { pool } from '../db/pool.js';
import { broadcastAIAnalysis } from '../websocket/liveServer.js';
import { errorPatternMatcher } from './errorPatternMatcher.js';
import { patternLearningRepository } from '../repositories/patternLearning.repository.js';

interface AnalyzeFailureRequest {
  test_key: string;
  error_message: string;
  stack_trace?: string;
  test_code?: string;
  duration_ms?: number;
  runner_type: string;
  previous_failures?: Array<{
    failed_at: string;
    error_message: string;
    duration_ms?: number;
  }>;
}

interface AnalysisResponse {
  available: boolean;
  category: string;
  root_cause?: string;
  recommendation?: string;
  severity?: string;
  confidence?: number;
  is_flaky?: boolean;
  analyzed_at?: string;
  model?: string;
  from_cache: boolean;
  estimated_fix_time?: string;
  related_issues?: string[];
  error?: string;
}

interface SaveAnalysisParams {
  testCaseExecutionId: string;
  analysis: AnalysisResponse;
  analysisDurationMs: number;
}

class AIAnalysisClient {
  private baseURL: string;
  private enabled: boolean;
  private maxRetries: number = 2;
  private retryDelay: number = 1000; // 1 second
  private timeout: number = 15000; // 15 second timeout

  constructor() {
    // Python API base URL (FastAPI)
    this.baseURL = process.env.PYTHON_API_URL || 'http://localhost:8000';
    this.enabled = process.env.AI_ANALYSIS_ENABLED !== 'false'; // enabled by default

    logger.info(`AI Analysis Client initialized`, {
      baseURL: this.baseURL,
      enabled: this.enabled,
    });
  }

  /**
   * Check if AI analysis is enabled and available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.baseURL}/api/ai-analysis/health`, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data.ai_available === true;
    } catch (error) {
      logger.warn('AI service health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Analyze a test failure asynchronously
   * This is fire-and-forget - doesn't block test execution
   */
  async analyzeFailureAsync(params: {
    runId: string;
    testCaseExecutionId: string;
    testKey: string;
    errorMessage: string;
    stackTrace?: string;
    durationMs?: number;
    runnerType: string;
  }): Promise<void> {
    // Fire and forget - don't await
    this._analyzeAndSave(params).catch((error) => {
      logger.error('Background AI analysis failed', {
        testKey: params.testKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  /**
   * Internal method to analyze and save (with retries)
   */
  private async _analyzeAndSave(params: {
    runId: string;
    testCaseExecutionId: string;
    testKey: string;
    errorMessage: string;
    stackTrace?: string;
    durationMs?: number;
    runnerType: string;
  }): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('🤖 Starting AI analysis', {
        testKey: params.testKey.substring(0, 50),
        testCaseExecutionId: params.testCaseExecutionId,
      });

      // Get previous failures for pattern detection
      const previousFailures = await this._getPreviousFailures(params.testKey);

      // Build request
      const request: AnalyzeFailureRequest = {
        test_key: params.testKey,
        error_message: params.errorMessage,
        stack_trace: params.stackTrace,
        duration_ms: params.durationMs,
        runner_type: params.runnerType,
        previous_failures: previousFailures,
      };

      // Call Python API with retries
      const analysis = await this._callWithRetry<AnalysisResponse>(
        '/api/ai-analysis/analyze-failure',
        request
      );

      const analysisDurationMs = Date.now() - startTime;

      // Save to database
      const aiAnalysisId = await this._saveAnalysisToDb({
        testCaseExecutionId: params.testCaseExecutionId,
        analysis,
        analysisDurationMs,
      });

      // ==========================================
      // PATTERN LEARNING: Save pattern after AI analysis
      // ==========================================
      if (analysis.available && !analysis.from_cache) {
        await this._savePatternLearning({
          testCaseExecutionId: params.testCaseExecutionId,
          testKey: params.testKey,
          errorMessage: params.errorMessage,
          errorStack: params.stackTrace,
          runnerType: params.runnerType,
          durationMs: params.durationMs,
          analysis,
          aiAnalysisId,
        }).catch((error) => {
          // Don't fail analysis if pattern saving fails
          logger.warn('Failed to save pattern learning data', {
            error: error instanceof Error ? error.message : 'Unknown error',
            testKey: params.testKey.substring(0, 50),
          });
        });
      }

      // Broadcast analysis results to WebSocket clients
      await broadcastAIAnalysis({
        runId: params.runId,
        testCaseExecutionId: params.testCaseExecutionId,
        testKey: params.testKey,
        analysis: {
          category: analysis.category,
          root_cause: analysis.root_cause,
          recommendation: analysis.recommendation,
          severity: analysis.severity,
          confidence: analysis.confidence,
          is_flaky: analysis.is_flaky,
        },
      });

      logger.info('✅ AI analysis complete and broadcasted', {
        testKey: params.testKey.substring(0, 50),
        category: analysis.category,
        severity: analysis.severity,
        confidence: analysis.confidence,
        fromCache: analysis.from_cache,
        durationMs: analysisDurationMs,
      });
    } catch (error) {
      const analysisDurationMs = Date.now() - startTime;

      logger.error('❌ AI analysis failed', {
        testKey: params.testKey.substring(0, 50),
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: analysisDurationMs,
      });

      // Save error to database
      await this._saveAnalysisError({
        testCaseExecutionId: params.testCaseExecutionId,
        errorMessage: error instanceof Error ? error.message : 'Analysis failed',
        analysisDurationMs,
      });
    }
  }

  /**
   * Call API with exponential backoff retry
   */
  private async _callWithRetry<T>(
    endpoint: string,
    data: any,
    retryCount: number = 0
  ): Promise<T> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount);
        logger.warn(`AI API call failed, retrying in ${delay}ms...`, {
          endpoint,
          retryCount,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this._callWithRetry<T>(endpoint, data, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Get previous failures for pattern detection
   */
  private async _getPreviousFailures(
    testKey: string
  ): Promise<Array<{ failed_at: string; error_message: string; duration_ms?: number }>> {
    try {
      const result = await pool.query(
        `
        SELECT
          tce.updated_at as failed_at,
          tce.error_message,
          tce.duration_ms
        FROM test_case_executions tce
        WHERE tce.test_key = $1
          AND tce.status = 'failed'
          AND tce.updated_at > NOW() - INTERVAL '30 days'
        ORDER BY tce.updated_at DESC
        LIMIT 10
        `,
        [testKey]
      );

      return result.rows.map((row) => ({
        failed_at: row.failed_at.toISOString(),
        error_message: row.error_message || 'No error message',
        duration_ms: row.duration_ms,
      }));
    } catch (error) {
      logger.error('Failed to fetch previous failures', {
        testKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Save analysis results to database
   */
  private async _saveAnalysisToDb(params: SaveAnalysisParams): Promise<string | null> {
    const { testCaseExecutionId, analysis, analysisDurationMs } = params;

    try {
      const result = await pool.query(
        `
        INSERT INTO ai_test_analysis (
          test_case_execution_id,
          category,
          root_cause,
          suggested_fix,
          severity,
          confidence,
          is_flaky,
          model_used,
          analyzed_at,
          analysis_duration_ms,
          estimated_fix_time,
          related_issues,
          raw_response
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12
        )
        ON CONFLICT (test_case_execution_id)
        DO UPDATE SET
          category = EXCLUDED.category,
          root_cause = EXCLUDED.root_cause,
          suggested_fix = EXCLUDED.suggested_fix,
          severity = EXCLUDED.severity,
          confidence = EXCLUDED.confidence,
          is_flaky = EXCLUDED.is_flaky,
          model_used = EXCLUDED.model_used,
          analyzed_at = EXCLUDED.analyzed_at,
          analysis_duration_ms = EXCLUDED.analysis_duration_ms,
          estimated_fix_time = EXCLUDED.estimated_fix_time,
          related_issues = EXCLUDED.related_issues,
          raw_response = EXCLUDED.raw_response,
          updated_at = NOW()
        RETURNING id
        `,
        [
          testCaseExecutionId,
          analysis.category,
          analysis.root_cause || null,
          analysis.recommendation || null,
          analysis.severity || null,
          analysis.confidence || null,
          analysis.is_flaky || false,
          analysis.model || 'unknown',
          analysisDurationMs,
          analysis.estimated_fix_time || null,
          analysis.related_issues ? JSON.stringify(analysis.related_issues) : null,
          JSON.stringify(analysis),
        ]
      );

      const aiAnalysisId = result.rows[0]?.id || null;

      logger.debug('💾 Analysis saved to database', {
        testCaseExecutionId,
        category: analysis.category,
        aiAnalysisId,
      });

      return aiAnalysisId;
    } catch (error) {
      logger.error('Failed to save analysis to database', {
        testCaseExecutionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Save pattern learning data after AI analysis
   * Creates error signature, proven solution, and outcome tracking
   */
  private async _savePatternLearning(params: {
    testCaseExecutionId: string;
    testKey: string;
    errorMessage: string;
    errorStack?: string;
    runnerType: string;
    durationMs?: number;
    analysis: AnalysisResponse;
    aiAnalysisId: string | null;
  }): Promise<void> {
    try {
      // 1. Get test_case_master_id and application_id from execution
      const executionData = await pool.query(
        `
        SELECT tcm.id as test_case_master_id, tcm.application_id
        FROM test_case_executions tce
        JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
        WHERE tce.id = $1
        `,
        [params.testCaseExecutionId]
      );

      if (executionData.rows.length === 0) {
        throw new Error('Test case execution not found');
      }

      const { test_case_master_id, application_id } = executionData.rows[0];

      // 2. Extract error signature
      const signature = await errorPatternMatcher.extractErrorSignature({
        error_message: params.errorMessage,
        error_stack: params.errorStack,
        runner_type: params.runnerType,
        duration_ms: params.durationMs,
        test_key: params.testKey,
        application_id,
      });

      // 3. Save pattern signature
      const patternId = await errorPatternMatcher.savePatternSignature(
        signature,
        application_id,
        params.analysis.category,
        params.analysis.severity
      );

      logger.debug('🧠 Pattern signature saved', {
        pattern_id: patternId,
        pattern_type: signature.pattern_type,
        test_key: params.testKey.substring(0, 50),
      });

      // 4. Save proven solution (starts unproven, will learn over time)
      const solutionId = await patternLearningRepository.saveProvenSolution({
        pattern_signature_id: patternId,
        application_id,
        suggested_fix: params.analysis.recommendation || params.analysis.root_cause || '',
        root_cause_analysis: params.analysis.root_cause,
        fix_category: params.analysis.category,
        original_ai_provider: params.analysis.model?.includes('claude') ? 'claude' : 'openai',
        original_ai_model: params.analysis.model || 'unknown',
        original_confidence: params.analysis.confidence || 50,
      });

      logger.debug('💡 Proven solution saved', {
        solution_id: solutionId,
        pattern_id: patternId,
      });

      // 5. Create outcome tracking record (will be linked when test runs again)
      await patternLearningRepository.createOutcomeTracking({
        test_case_master_id,
        failed_execution_id: params.testCaseExecutionId,
        ai_analysis_id: params.aiAnalysisId || undefined,
        pattern_signature_id: patternId,
        proven_solution_id: solutionId,
        solution_source: 'fresh_ai',
        was_cached: false,
        test_key: params.testKey,
        application_id,
      });

      logger.info('🎯 Pattern learning data saved successfully', {
        test_key: params.testKey.substring(0, 50),
        pattern_type: signature.pattern_type,
      });
    } catch (error) {
      logger.error('Failed to save pattern learning data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        testKey: params.testKey.substring(0, 50),
      });
      // Re-throw so caller can handle
      throw error;
    }
  }

  /**
   * Save analysis error to database
   */
  private async _saveAnalysisError(params: {
    testCaseExecutionId: string;
    errorMessage: string;
    analysisDurationMs: number;
  }): Promise<void> {
    try {
      await pool.query(
        `
        INSERT INTO ai_test_analysis (
          test_case_execution_id,
          category,
          analyzed_at,
          analysis_duration_ms,
          analysis_error
        ) VALUES (
          $1, 'error', NOW(), $2, $3
        )
        ON CONFLICT (test_case_execution_id)
        DO UPDATE SET
          category = 'error',
          analysis_error = EXCLUDED.analysis_error,
          analysis_duration_ms = EXCLUDED.analysis_duration_ms,
          updated_at = NOW()
        `,
        [params.testCaseExecutionId, params.analysisDurationMs, params.errorMessage]
      );
    } catch (error) {
      logger.error('Failed to save analysis error to database', {
        testCaseExecutionId: params.testCaseExecutionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get analysis for a test case execution (for API/WebSocket)
   */
  async getAnalysis(testCaseExecutionId: string): Promise<AnalysisResponse | null> {
    try {
      const result = await pool.query(
        `
        SELECT
          category,
          root_cause,
          suggested_fix as recommendation,
          severity,
          confidence,
          is_flaky,
          model_used as model,
          analyzed_at,
          analysis_error
        FROM ai_test_analysis
        WHERE test_case_execution_id = $1
        `,
        [testCaseExecutionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        available: true,
        category: row.category,
        root_cause: row.root_cause,
        recommendation: row.recommendation,
        severity: row.severity,
        confidence: row.confidence,
        is_flaky: row.is_flaky,
        model: row.model,
        from_cache: false, // No longer tracking from_cache in new schema
        analyzed_at: row.analyzed_at?.toISOString(),
        error: row.analysis_error,
      };
    } catch (error) {
      logger.error('Failed to get analysis from database', {
        testCaseExecutionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}

// Singleton instance
export const aiAnalysisClient = new AIAnalysisClient();
