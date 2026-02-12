/**
 * =====================================================
 * QOP Scheduled Job: Flaky Test Analysis
 * =====================================================
 *
 * Runs periodically to:
 * 1. Analyze all tests for flakiness
 * 2. Update stability metrics
 * 3. Auto-quarantine highly flaky tests
 * 4. Generate daily/weekly insights
 *
 * Recommended Schedule: Every 6 hours (or after each CI/CD run)
 */

import { Pool } from 'pg';
import FlakyTestDetectionService from '../services/flakyTestDetection.service.js';

export class FlakyTestAnalysisJob {
  private detectionService: FlakyTestDetectionService;

  constructor(private pool: Pool) {
    this.detectionService = new FlakyTestDetectionService(pool);
  }

  /**
   * Main job execution
   */
  async execute(): Promise<void> {
    console.log('[FlakyTestAnalysisJob] Starting flaky test analysis...');

    const startTime = Date.now();
    let stats = {
      applicationsProcessed: 0,
      testsAnalyzed: 0,
      flakyTestsFound: 0,
      testsQuarantined: 0,
      testsReleased: 0,
    };

    try {
      // Step 1: Get all applications
      const apps = await this.getApplications();
      console.log(
        `[FlakyTestAnalysisJob] Found ${apps.length} applications to analyze`
      );

      // Step 2: Analyze each application
      for (const app of apps) {
        try {
          const appStats = await this.analyzeApplication(app.id, app.name);
          stats.applicationsProcessed++;
          stats.testsAnalyzed += appStats.testsAnalyzed;
          stats.flakyTestsFound += appStats.flakyTestsFound;
          stats.testsQuarantined += appStats.testsQuarantined;
          stats.testsReleased += appStats.testsReleased;
        } catch (error) {
          console.error(
            `[FlakyTestAnalysisJob] Error analyzing app ${app.name}:`,
            error
          );
          // Continue with next app
        }
      }

      // Step 3: Generate daily insights
      await this.generateDailyInsights();

      const duration = Date.now() - startTime;
      console.log(
        `[FlakyTestAnalysisJob] Completed in ${duration}ms. Stats:`,
        stats
      );
    } catch (error) {
      console.error('[FlakyTestAnalysisJob] Fatal error:', error);
      throw error;
    }
  }

  /**
   * Analyze a single application
   */
  private async analyzeApplication(
    appId: string,
    appName: string
  ): Promise<{
    testsAnalyzed: number;
    flakyTestsFound: number;
    testsQuarantined: number;
    testsReleased: number;
  }> {
    console.log(`[FlakyTestAnalysisJob] Analyzing application: ${appName}`);

    // Get all test results for this app
    const results = await this.detectionService.analyzeApplication(appId, 30);

    let testsQuarantined = 0;
    let testsReleased = 0;

    // Update metrics and handle quarantine
    for (const result of results) {
      // Update stability metrics
      await this.detectionService.updateStabilityMetrics(
        result.testCaseId,
        result
      );

      // Auto-quarantine if needed
      const wasQuarantined = await this.handleQuarantine(result);
      if (wasQuarantined) {
        testsQuarantined++;
      }

      // Auto-release if stabilized
      const wasReleased = await this.handleAutoRelease(result);
      if (wasReleased) {
        testsReleased++;
      }

      // Log flakiness events if significant
      if (result.flakinessScore > 50) {
        await this.logFlakinessEvent(result);
      }
    }

    const flakyTestsFound = results.filter((r) => r.flakinessScore >= 20).length;

    console.log(
      `[FlakyTestAnalysisJob] ${appName}: ${results.length} tests analyzed, ` +
        `${flakyTestsFound} flaky, ${testsQuarantined} quarantined, ${testsReleased} released`
    );

    return {
      testsAnalyzed: results.length,
      flakyTestsFound,
      testsQuarantined,
      testsReleased,
    };
  }

  /**
   * Handle quarantine decision
   */
  private async handleQuarantine(
    result: any
  ): Promise<boolean> {
    try {
      // Check if already quarantined
      const existing = await this.pool.query(
        `SELECT id FROM test_quarantine
         WHERE test_case_id = $1 AND status = 'active'`,
        [result.testCaseId]
      );

      if (existing.rows.length > 0) {
        return false; // Already quarantined
      }

      // Auto-quarantine if needed
      await this.detectionService.autoQuarantine(result);

      // Check if quarantine was created
      const check = await this.pool.query(
        `SELECT id FROM test_quarantine
         WHERE test_case_id = $1 AND status = 'active'`,
        [result.testCaseId]
      );

      return check.rows.length > 0;
    } catch (error) {
      console.error(
        `[FlakyTestAnalysisJob] Error handling quarantine for ${result.testCaseId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Auto-release tests that have stabilized
   */
  private async handleAutoRelease(result: any): Promise<boolean> {
    try {
      // Find active quarantines with auto-release enabled
      const quarantines = await this.pool.query(
        `SELECT id, auto_release_threshold
         FROM test_quarantine
         WHERE test_case_id = $1
           AND status = 'active'
           AND auto_release_enabled = true`,
        [result.testCaseId]
      );

      if (quarantines.rows.length === 0) {
        return false;
      }

      const quarantine = quarantines.rows[0];

      // Check if test has stabilized below threshold
      if (result.flakinessScore < quarantine.auto_release_threshold) {
        await this.pool.query(
          `UPDATE test_quarantine
           SET
             status = 'resolved',
             resolved_at = NOW(),
             resolution_notes = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [
            `Auto-released: Flakiness score dropped to ${result.flakinessScore} (threshold: ${quarantine.auto_release_threshold})`,
            quarantine.id,
          ]
        );

        console.log(
          `[FlakyTestAnalysisJob] Auto-released test ${result.testCaseId} from quarantine`
        );
        return true;
      }

      return false;
    } catch (error) {
      console.error(
        `[FlakyTestAnalysisJob] Error handling auto-release for ${result.testCaseId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Log significant flakiness events
   */
  private async logFlakinessEvent(result: any): Promise<void> {
    try {
      // Get the latest execution for this test
      const latestExec = await this.pool.query(
        `SELECT
          tce.id as execution_id,
          tce.test_run_id,
          tce.status,
          tce.error_message
         FROM test_case_executions tce
         WHERE tce.test_case_master_id = $1
         ORDER BY tce.id DESC
         LIMIT 1`,
        [result.testCaseId]
      );

      if (latestExec.rows.length === 0) return;

      const exec = latestExec.rows[0];

      // Determine event type
      let eventType = 'flaky_detected';
      if (result.pattern.includes('PFPFP')) {
        eventType = 'alternating_pattern';
      } else if (result.rootCauses.some((c: any) => c.type === 'timeout')) {
        eventType = 'timeout_pattern';
      }

      // Determine suspected root cause
      const topRootCause = result.rootCauses[0];

      await this.pool.query(
        `INSERT INTO flakiness_events (
          test_case_id,
          test_run_id,
          execution_id,
          event_type,
          current_status,
          failure_reason,
          environment_info,
          suspected_root_cause,
          confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          result.testCaseId,
          exec.test_run_id,
          exec.execution_id,
          eventType,
          exec.status,
          exec.error_message,
          exec.environment_info,
          topRootCause?.type || 'unknown',
          topRootCause?.confidence || 0,
        ]
      );
    } catch (error) {
      console.error(
        `[FlakyTestAnalysisJob] Error logging flakiness event:`,
        error
      );
    }
  }

  /**
   * Generate daily insights
   */
  private async generateDailyInsights(): Promise<void> {
    console.log('[FlakyTestAnalysisJob] Generating daily insights...');

    try {
      const today = new Date().toISOString().split('T')[0];
      const apps = await this.getApplications();

      for (const app of apps) {
        // Get current metrics
        const metrics = await this.pool.query(
          `SELECT
            COUNT(*) FILTER (WHERE flakiness_score >= 20) as total_flaky,
            COUNT(*) FILTER (WHERE status = 'quarantined') as total_quarantined,
            AVG(flakiness_score) as avg_score
           FROM test_stability_metrics
           WHERE application_id = $1`,
          [app.id]
        );

        const row = metrics.rows[0];

        // Get top flaky tests
        const topFlaky = await this.pool.query(
          `SELECT
            tcm.id,
            tcm.test_key as test_name,
            tsm.flakiness_score
           FROM test_case_master tcm
           JOIN test_stability_metrics tsm ON tsm.test_case_id = tcm.id
           WHERE tcm.application_id = $1
           ORDER BY tsm.flakiness_score DESC
           LIMIT 10`,
          [app.id]
        );

        // Insert daily insight
        await this.pool.query(
          `INSERT INTO flakiness_insights (
            application_id,
            period_start,
            period_end,
            period_type,
            total_flaky_tests,
            total_quarantined_tests,
            avg_flakiness_score,
            top_flaky_tests
          ) VALUES ($1, $2, $2, 'daily', $3, $4, $5, $6)
          ON CONFLICT (application_id, period_start, period_end, period_type)
          DO UPDATE SET
            total_flaky_tests = EXCLUDED.total_flaky_tests,
            total_quarantined_tests = EXCLUDED.total_quarantined_tests,
            avg_flakiness_score = EXCLUDED.avg_flakiness_score,
            top_flaky_tests = EXCLUDED.top_flaky_tests`,
          [
            app.id,
            today,
            parseInt(row.total_flaky, 10) || 0,
            parseInt(row.total_quarantined, 10) || 0,
            parseFloat(row.avg_score) || 0,
            JSON.stringify(topFlaky.rows),
          ]
        );
      }

      console.log(
        '[FlakyTestAnalysisJob] Daily insights generated successfully'
      );
    } catch (error) {
      console.error('[FlakyTestAnalysisJob] Error generating insights:', error);
    }
  }

  /**
   * Get all applications
   */
  private async getApplications(): Promise<{ id: string; name: string }[]> {
    const result = await this.pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM applications ORDER BY name'
    );
    return result.rows;
  }
}

/**
 * Setup cron schedule
 * Usage:
 *   const job = new FlakyTestAnalysisJob(pool);
 *   setInterval(() => job.execute(), 6 * 60 * 60 * 1000); // Every 6 hours
 */
export function scheduleFlakyTestAnalysis(pool: Pool): void {
  const job = new FlakyTestAnalysisJob(pool);

  // Run immediately on startup
  job.execute().catch((error) => {
    console.error('[FlakyTestAnalysisJob] Initial execution failed:', error);
  });

  // Schedule every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    job.execute().catch((error) => {
      console.error('[FlakyTestAnalysisJob] Scheduled execution failed:', error);
    });
  }, SIX_HOURS);

  console.log('[FlakyTestAnalysisJob] Scheduled to run every 6 hours');
}

export default FlakyTestAnalysisJob;
