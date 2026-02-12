/**
 * =====================================================
 * QOP Flaky Test Detection API Routes
 * =====================================================
 */

import { Request, Response, Express } from 'express';
import { pool } from '../db/pool.js';
import FlakyTestDetectionService from '../services/flakyTestDetection.service.js';

export function registerFlakyTestsRoutes(app: Express) {
  const detectionService = new FlakyTestDetectionService(pool);

  /**
   * GET /api/flaky-tests/application/:appId
   * Get all flaky tests for an application
   */
  app.get('/api/flaky-tests/application/:appId', async (req: Request, res: Response) => {
    try {
      const { appId } = req.params;
      const { days = '30', minScore = '20' } = req.query;

      const results = await detectionService.analyzeApplication(
        appId,
        parseInt(days as string)
      );

      // Filter by minimum score
      const filtered = results.filter(
        (r) => r.flakinessScore >= parseFloat(minScore as string)
      );

      // Sort by flakiness score descending
      const sorted = filtered.sort((a, b) => b.flakinessScore - a.flakinessScore);

      res.json({
        applicationId: appId,
        totalTests: sorted.length,
        highlyFlaky: sorted.filter((r) => r.classification === 'highly_flaky')
          .length,
        flaky: sorted.filter((r) => r.classification === 'flaky').length,
        unstable: sorted.filter((r) => r.classification === 'unstable').length,
        tests: sorted,
      });
    } catch (error) {
      console.error('Failed to get flaky tests:', error);
      res.status(500).json({ error: 'Failed to get flaky tests' });
    }
  });

  /**
   * GET /api/flaky-tests/test/:testCaseId
   * Get flakiness analysis for a specific test
   */
  app.get('/api/flaky-tests/test/:testCaseId', async (req: Request, res: Response) => {
    try {
      const { testCaseId } = req.params;
      const { days = '30' } = req.query;

      const result = await detectionService.analyzeTest(
        testCaseId,
        parseInt(days as string)
      );

      res.json(result);
    } catch (error) {
      console.error('Failed to analyze test:', error);
      res.status(500).json({ error: 'Failed to analyze test' });
    }
  });

  /**
   * POST /api/flaky-tests/test/:testCaseId/quarantine
   * Manually quarantine a test
   */
  app.post(
    '/api/flaky-tests/test/:testCaseId/quarantine',
    async (req: Request, res: Response) => {
      try {
        const { testCaseId } = req.params;
        const { reason, userId } = req.body;

        if (!reason) {
          return res.status(400).json({ error: 'Reason is required' });
        }

        // Get current flakiness score
        const analysis = await detectionService.analyzeTest(testCaseId);

        await pool.query(
          `
        INSERT INTO test_quarantine (
          test_case_id,
          application_id,
          quarantine_reason,
          flakiness_score_at_quarantine,
          quarantined_by
        )
        SELECT
          $1,
          application_id,
          $2,
          $3,
          $4
        FROM test_case_master
        WHERE id = $1
        ON CONFLICT (test_case_id, application_id, status) DO UPDATE
        SET
          quarantine_reason = EXCLUDED.quarantine_reason,
          flakiness_score_at_quarantine = EXCLUDED.flakiness_score_at_quarantine,
          quarantined_by = EXCLUDED.quarantined_by,
          updated_at = NOW()
      `,
          [testCaseId, reason, analysis.flakinessScore, userId || null]
        );

        res.json({ success: true, message: 'Test quarantined successfully' });
      } catch (error) {
        console.error('Failed to quarantine test:', error);
        res.status(500).json({ error: 'Failed to quarantine test' });
      }
    }
  );

  /**
   * DELETE /api/flaky-tests/test/:testCaseId/quarantine
   * Release a test from quarantine
   */
  app.delete(
    '/api/flaky-tests/test/:testCaseId/quarantine',
    async (req: Request, res: Response) => {
      try {
        const { testCaseId } = req.params;
        const { userId, notes } = req.body;

        await pool.query(
          `
        UPDATE test_quarantine
        SET
          status = 'resolved',
          resolved_at = NOW(),
          resolved_by = $2,
          resolution_notes = $3,
          updated_at = NOW()
        WHERE test_case_id = $1
          AND status = 'active'
      `,
          [testCaseId, userId || null, notes || 'Manually released']
        );

        res.json({ success: true, message: 'Test released from quarantine' });
      } catch (error) {
        console.error('Failed to release test:', error);
        res.status(500).json({ error: 'Failed to release test' });
      }
    }
  );

  /**
   * GET /api/flaky-tests/application/:appId/insights
   * Get flakiness insights for an application
   */
  app.get(
    '/api/flaky-tests/application/:appId/insights',
    async (req: Request, res: Response) => {
      try {
        const { appId } = req.params;
        const { period = 'weekly' } = req.query;

        const result = await pool.query(
          `
        SELECT
          period_start,
          period_end,
          total_flaky_tests,
          total_quarantined_tests,
          avg_flakiness_score,
          tests_became_flaky,
          tests_became_stable,
          flakiness_trend,
          top_flaky_tests
        FROM flakiness_insights
        WHERE application_id = $1
          AND period_type = $2
        ORDER BY period_start DESC
        LIMIT 12
      `,
          [appId, period]
        );

        res.json({
          applicationId: appId,
          period,
          insights: result.rows,
        });
      } catch (error) {
        console.error('Failed to get insights:', error);
        res.status(500).json({ error: 'Failed to get insights' });
      }
    }
  );

  /**
   * GET /api/flaky-tests/application/:appId/overview
   * Get overview dashboard data
   */
  app.get(
    '/api/flaky-tests/application/:appId/overview',
    async (req: Request, res: Response) => {
      try {
        const { appId } = req.params;

        const result = await pool.query(
          `
        SELECT
          total_tests,
          highly_flaky_tests,
          moderately_flaky_tests,
          quarantined_tests,
          avg_flakiness_score,
          max_flakiness_score
        FROM v_application_flakiness_overview
        WHERE application_id = $1
      `,
          [appId]
        );

        if (result.rows.length === 0) {
          return res.json({
            applicationId: appId,
            totalTests: 0,
            highlyFlakyTests: 0,
            moderatelyFlakyTests: 0,
            quarantinedTests: 0,
            avgFlakinessScore: 0,
            maxFlakinessScore: 0,
          });
        }

        const row = result.rows[0];
        res.json({
          applicationId: appId,
          totalTests: parseInt(row.total_tests, 10),
          highlyFlakyTests: parseInt(row.highly_flaky_tests, 10),
          moderatelyFlakyTests: parseInt(row.moderately_flaky_tests, 10),
          quarantinedTests: parseInt(row.quarantined_tests, 10),
          avgFlakinessScore: parseFloat(row.avg_flakiness_score || 0),
          maxFlakinessScore: parseFloat(row.max_flakiness_score || 0),
        });
      } catch (error) {
        console.error('Failed to get overview:', error);
        res.status(500).json({ error: 'Failed to get overview' });
      }
    }
  );

  /**
   * POST /api/flaky-tests/analyze-all
   * Trigger analysis for all applications (admin only)
   */
  app.post('/api/flaky-tests/analyze-all', async (_req: Request, res: Response) => {
    try {
      // Get all applications
      const apps = await pool.query<{ id: string }>(
        'SELECT id FROM applications'
      );

      let processed = 0;
      let quarantined = 0;

      for (const app of apps.rows) {
        const results = await detectionService.analyzeApplication(app.id);

        for (const result of results) {
          // Update metrics
          await detectionService.updateStabilityMetrics(
            result.testCaseId,
            result
          );

          // Auto-quarantine if needed
          await detectionService.autoQuarantine(result);

          if (result.classification === 'highly_flaky' || result.classification === 'flaky') {
            quarantined++;
          }
        }

        processed++;
      }

      res.json({
        success: true,
        applicationsProcessed: processed,
        testsQuarantined: quarantined,
      });
    } catch (error) {
      console.error('Failed to analyze all:', error);
      res.status(500).json({ error: 'Failed to analyze all applications' });
    }
  });

  /**
   * GET /api/flaky-tests/quarantined
   * Get all quarantined tests across all applications
   */
  app.get('/api/flaky-tests/quarantined', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT
          tq.id,
          tq.test_case_id,
          tcm.test_key as test_name,
          tq.application_id,
          a.name as application_name,
          tq.quarantined_at,
          tq.quarantine_reason,
          tq.flakiness_score_at_quarantine,
          tq.status,
          tsm.flakiness_score as current_flakiness_score
        FROM test_quarantine tq
        JOIN test_case_master tcm ON tcm.id = tq.test_case_id
        JOIN applications a ON a.id = tq.application_id
        LEFT JOIN test_stability_metrics tsm ON tsm.test_case_id = tq.test_case_id
        WHERE tq.status = 'active'
        ORDER BY tq.quarantined_at DESC
      `);

      res.json({
        totalQuarantined: result.rows.length,
        tests: result.rows,
      });
    } catch (error) {
      console.error('Failed to get quarantined tests:', error);
      res.status(500).json({ error: 'Failed to get quarantined tests' });
    }
  });

}
