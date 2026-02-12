/**
 * =====================================================
 * QOP Flaky Test Detection Service
 * =====================================================
 *
 * Three-Layer Detection Algorithm:
 * 1. Statistical Analysis (pattern-based)
 * 2. Behavioral Analysis (timing/environment)
 * 3. ML-Powered Prediction (optional, Phase 2)
 *
 * @version 1.0
 */

import { Pool } from 'pg';

// =====================================================
// Types & Interfaces
// =====================================================

export interface TestExecution {
  testCaseId: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  createdAt: Date;
  errorMessage?: string;
  environment?: EnvironmentInfo;
}

export interface EnvironmentInfo {
  browser?: string;
  os?: string;
  nodeVersion?: string;
  ciProvider?: string;
  [key: string]: any;
}

export interface FlakinessResult {
  testCaseId: string;
  flakinessScore: number;
  confidenceLevel: number;
  classification: 'stable' | 'unstable' | 'flaky' | 'highly_flaky';
  pattern: string;
  recommendations: string[];
  rootCauses: RootCause[];
}

export interface RootCause {
  type: 'race_condition' | 'network' | 'resource_leak' | 'environment' | 'timing' | 'unknown';
  confidence: number;
  evidence: string;
}

export interface QuarantineDecision {
  shouldQuarantine: boolean;
  reason: string;
  autoReleaseThreshold?: number;
}

// =====================================================
// Layer 1: Statistical Analysis
// =====================================================

export class StatisticalFlakinessDetector {
  /**
   * Calculate flakiness score based on execution pattern
   * Algorithm:
   * 1. Analyze last N executions (default 30 days)
   * 2. Count status flips (P→F or F→P transitions)
   * 3. Calculate flip rate and adjust for failure rate
   * 4. Apply confidence weighting
   */
  static calculateFlakinessScore(executions: TestExecution[]): {
    score: number;
    confidence: number;
    pattern: string;
  } {
    if (executions.length < 5) {
      return { score: 0, confidence: 0, pattern: 'INSUFFICIENT_DATA' };
    }

    // Sort by creation date (most recent first)
    const sorted = executions.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    // Take last 20 executions for pattern analysis
    const recentExecutions = sorted.slice(0, 20);

    // Build pattern string (P=pass, F=fail, S=skip)
    const pattern = recentExecutions
      .map((e) => {
        if (e.status === 'passed') return 'P';
        if (e.status === 'failed') return 'F';
        return 'S';
      })
      .join('');

    // Count transitions
    let statusFlips = 0;
    for (let i = 1; i < recentExecutions.length; i++) {
      if (recentExecutions[i].status !== recentExecutions[i - 1].status) {
        statusFlips++;
      }
    }

    // Calculate base metrics
    const total = recentExecutions.length;
    const passes = recentExecutions.filter((e) => e.status === 'passed').length;
    const failures = recentExecutions.filter((e) => e.status === 'failed').length;
    const skips = recentExecutions.filter((e) => e.status === 'skipped').length;

    // Edge cases: All same status = stable
    if (passes === total || failures === total) {
      return { score: 0, confidence: 100, pattern };
    }

    // Calculate flip rate (0-1)
    const flipRate = statusFlips / (total - 1);

    // Calculate failure rate (0-1)
    const failureRate = failures / total;

    // Flakiness formula:
    // Base score = flip rate × 100
    // Amplify by failure rate: score × (1 + failure rate)
    // This penalizes tests that flip AND fail often
    const baseScore = flipRate * 100;
    const amplifiedScore = baseScore * (1 + failureRate);

    // Pattern-based adjustments
    let patternAdjustment = 0;

    // Alternating pattern (PFPFPF) = very flaky
    if (this.isAlternatingPattern(pattern)) {
      patternAdjustment += 20;
    }

    // Recent instability (last 5 have flips) = more flaky
    const recentPattern = pattern.slice(0, 5);
    if (this.countFlips(recentPattern) >= 3) {
      patternAdjustment += 15;
    }

    // Calculate final score (capped at 100)
    const finalScore = Math.min(100, amplifiedScore + patternAdjustment);

    // Confidence level based on sample size
    // More executions = higher confidence
    const confidence = Math.min(100, (total / 50) * 100);

    return {
      score: Math.round(finalScore * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      pattern,
    };
  }

  /**
   * Check if pattern is alternating (PFPFPF or FPFPFP)
   */
  private static isAlternatingPattern(pattern: string): boolean {
    if (pattern.length < 4) return false;

    let alternations = 0;
    for (let i = 1; i < Math.min(pattern.length, 10); i++) {
      if (pattern[i] !== pattern[i - 1]) {
        alternations++;
      }
    }

    // If 70%+ are alternations, it's an alternating pattern
    return alternations / Math.min(pattern.length - 1, 9) >= 0.7;
  }

  /**
   * Count status flips in a pattern string
   */
  private static countFlips(pattern: string): number {
    let flips = 0;
    for (let i = 1; i < pattern.length; i++) {
      if (pattern[i] !== pattern[i - 1]) {
        flips++;
      }
    }
    return flips;
  }

  /**
   * Classify test based on flakiness score
   */
  static classify(
    score: number
  ): 'stable' | 'unstable' | 'flaky' | 'highly_flaky' {
    if (score < 20) return 'stable';
    if (score < 50) return 'unstable';
    if (score < 80) return 'flaky';
    return 'highly_flaky';
  }
}

// =====================================================
// Layer 2: Behavioral Analysis
// =====================================================

export class BehavioralFlakinessDetector {
  /**
   * Analyze execution timing patterns to detect race conditions
   */
  static analyzeTimingPatterns(executions: TestExecution[]): RootCause[] {
    const rootCauses: RootCause[] = [];

    if (executions.length < 10) return rootCauses;

    // Calculate duration statistics
    const durations = executions.map((e) => e.durationMs);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = this.calculateVariance(durations);
    const stdDev = Math.sqrt(variance);

    // High variance in execution time = potential race condition
    const coefficientOfVariation = stdDev / avgDuration;

    if (coefficientOfVariation > 0.5) {
      // More than 50% variation
      rootCauses.push({
        type: 'race_condition',
        confidence: Math.min(coefficientOfVariation * 100, 90),
        evidence: `Execution time varies by ${Math.round(coefficientOfVariation * 100)}% (avg: ${Math.round(avgDuration)}ms, std: ${Math.round(stdDev)}ms). Suggests race conditions or timing dependencies.`,
      });
    }

    // Timeout pattern detection
    const timeouts = executions.filter(
      (e) => e.errorMessage?.toLowerCase().includes('timeout')
    );
    if (timeouts.length > executions.length * 0.2) {
      rootCauses.push({
        type: 'timing',
        confidence: (timeouts.length / executions.length) * 100,
        evidence: `${timeouts.length}/${executions.length} executions timed out. Likely network delays or slow resources.`,
      });
    }

    return rootCauses;
  }

  /**
   * Analyze environment correlation to detect environment-specific issues
   */
  static analyzeEnvironmentCorrelation(
    executions: TestExecution[]
  ): RootCause[] {
    const rootCauses: RootCause[] = [];

    // Group by environment attributes
    const envGroups: { [key: string]: { passed: number; failed: number } } = {};

    executions.forEach((e) => {
      if (!e.environment) return;

      // Check browser correlation
      if (e.environment.browser) {
        const key = `browser:${e.environment.browser}`;
        if (!envGroups[key]) envGroups[key] = { passed: 0, failed: 0 };
        if (e.status === 'passed') envGroups[key].passed++;
        if (e.status === 'failed') envGroups[key].failed++;
      }

      // Check OS correlation
      if (e.environment.os) {
        const key = `os:${e.environment.os}`;
        if (!envGroups[key]) envGroups[key] = { passed: 0, failed: 0 };
        if (e.status === 'passed') envGroups[key].passed++;
        if (e.status === 'failed') envGroups[key].failed++;
      }

      // Check CI provider correlation
      if (e.environment.ciProvider) {
        const key = `ci:${e.environment.ciProvider}`;
        if (!envGroups[key]) envGroups[key] = { passed: 0, failed: 0 };
        if (e.status === 'passed') envGroups[key].passed++;
        if (e.status === 'failed') envGroups[key].failed++;
      }
    });

    // Analyze correlations
    Object.entries(envGroups).forEach(([key, stats]) => {
      const total = stats.passed + stats.failed;
      if (total < 5) return; // Not enough data

      const failureRate = stats.failed / total;

      // If one environment has >70% failures, it's likely environment-specific
      if (failureRate > 0.7) {
        rootCauses.push({
          type: 'environment',
          confidence: failureRate * 100,
          evidence: `Test fails ${Math.round(failureRate * 100)}% of the time on ${key.split(':')[1]} (${stats.failed}/${total} failures). Likely environment-specific issue.`,
        });
      }
    });

    return rootCauses;
  }

  /**
   * Analyze error messages for patterns
   */
  static analyzeErrorPatterns(executions: TestExecution[]): RootCause[] {
    const rootCauses: RootCause[] = [];

    const failures = executions.filter((e) => e.status === 'failed');
    if (failures.length === 0) return rootCauses;

    // Common error patterns
    const patterns = {
      network: /network|connection|dns|socket|econnrefused|timeout/i,
      resource_leak: /memory|heap|out of memory|resource/i,
      race_condition: /race|concurrent|async|promise|await/i,
    };

    Object.entries(patterns).forEach(([type, regex]) => {
      const matches = failures.filter((e) =>
        e.errorMessage ? regex.test(e.errorMessage) : false
      );

      if (matches.length > failures.length * 0.3) {
        rootCauses.push({
          type: type as RootCause['type'],
          confidence: (matches.length / failures.length) * 100,
          evidence: `${matches.length}/${failures.length} failures match "${type}" pattern in error messages.`,
        });
      }
    });

    return rootCauses;
  }

  /**
   * Calculate variance of an array
   */
  private static calculateVariance(values: number[]): number {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
}

// =====================================================
// Layer 3: Quarantine Decision Engine
// =====================================================

export class QuarantineDecisionEngine {
  /**
   * Decide if a test should be quarantined
   */
  static shouldQuarantine(result: FlakinessResult): QuarantineDecision {
    const { flakinessScore, classification, confidenceLevel } = result;

    // Rule 1: Highly flaky tests with high confidence = immediate quarantine
    if (classification === 'highly_flaky' && confidenceLevel > 70) {
      return {
        shouldQuarantine: true,
        reason: `Test is highly flaky (score: ${flakinessScore}) with high confidence (${confidenceLevel}%). Quarantining to prevent CI/CD disruption.`,
        autoReleaseThreshold: 20, // Release when score drops below 20
      };
    }

    // Rule 2: Flaky tests with alternating pattern = quarantine
    if (result.pattern.includes('PFPFP') || result.pattern.includes('FPFPF')) {
      return {
        shouldQuarantine: true,
        reason: `Test exhibits alternating pass/fail pattern (${result.pattern.slice(0, 10)}). Indicates severe instability.`,
        autoReleaseThreshold: 30,
      };
    }

    // Rule 3: Recent spike in flakiness (last 5 runs have 4+ flips)
    const recentPattern = result.pattern.slice(0, 5);
    const recentFlips = this.countFlips(recentPattern);
    if (recentFlips >= 4) {
      return {
        shouldQuarantine: true,
        reason: `Recent spike in instability: ${recentFlips} status changes in last 5 runs (${recentPattern}). Temporary quarantine recommended.`,
        autoReleaseThreshold: 25,
      };
    }

    // Rule 4: No quarantine, but monitor
    return {
      shouldQuarantine: false,
      reason: `Test is ${classification} but doesn't meet quarantine threshold yet.`,
    };
  }

  /**
   * Generate actionable recommendations
   */
  static generateRecommendations(result: FlakinessResult): string[] {
    const recommendations: string[] = [];

    // Based on classification
    if (result.classification === 'highly_flaky') {
      recommendations.push(
        '🚨 Quarantine this test immediately to prevent CI/CD pipeline failures'
      );
    }

    // Based on root causes
    result.rootCauses.forEach((cause) => {
      switch (cause.type) {
        case 'race_condition':
          recommendations.push(
            '⏱️ Add explicit waits or use retry logic to handle race conditions'
          );
          recommendations.push(
            '🔍 Review async/await usage and promise handling'
          );
          break;

        case 'network':
          recommendations.push(
            '🌐 Implement network request mocking or use WireMock/MSW'
          );
          recommendations.push(
            '🔄 Add retry logic with exponential backoff for network calls'
          );
          break;

        case 'resource_leak':
          recommendations.push(
            '🧹 Check for memory leaks - ensure proper cleanup in afterEach hooks'
          );
          recommendations.push(
            '📊 Profile memory usage during test execution'
          );
          break;

        case 'environment':
          recommendations.push(
            '🖥️ Investigate environment-specific configuration (browser, OS, CI provider)'
          );
          recommendations.push(
            '🔧 Standardize test environment across all execution contexts'
          );
          break;

        case 'timing':
          recommendations.push(
            '⏲️ Increase timeout values or optimize slow operations'
          );
          recommendations.push(
            '🚀 Use parallel execution cautiously - may cause resource contention'
          );
          break;
      }
    });

    // Pattern-specific recommendations
    if (result.pattern.includes('PFPFP')) {
      recommendations.push(
        '🔁 Alternating pass/fail pattern suggests non-deterministic behavior'
      );
      recommendations.push(
        '🎲 Check for randomness, timestamps, or external dependencies'
      );
    }

    // Confidence-based recommendations
    if (result.confidenceLevel < 50) {
      recommendations.push(
        '📈 Low confidence - need more test executions for accurate analysis'
      );
    }

    return recommendations;
  }

  private static countFlips(pattern: string): number {
    let flips = 0;
    for (let i = 1; i < pattern.length; i++) {
      if (pattern[i] !== pattern[i - 1]) flips++;
    }
    return flips;
  }
}

// =====================================================
// Main Flaky Test Detection Service
// =====================================================

export class FlakyTestDetectionService {
  constructor(private pool: Pool) {}

  /**
   * Analyze a single test case for flakiness
   */
  async analyzeTest(
    testCaseId: string,
    windowDays: number = 30
  ): Promise<FlakinessResult> {
    // Fetch recent executions from database
    const executions = await this.fetchTestExecutions(testCaseId, windowDays);

    // Layer 1: Statistical analysis
    const stats = StatisticalFlakinessDetector.calculateFlakinessScore(
      executions
    );

    // Layer 2: Behavioral analysis
    const timingCauses =
      BehavioralFlakinessDetector.analyzeTimingPatterns(executions);
    const envCauses =
      BehavioralFlakinessDetector.analyzeEnvironmentCorrelation(executions);
    const errorCauses =
      BehavioralFlakinessDetector.analyzeErrorPatterns(executions);

    const allRootCauses = [...timingCauses, ...envCauses, ...errorCauses];

    // Build result
    const result: FlakinessResult = {
      testCaseId,
      flakinessScore: stats.score,
      confidenceLevel: stats.confidence,
      classification: StatisticalFlakinessDetector.classify(stats.score),
      pattern: stats.pattern,
      rootCauses: allRootCauses,
      recommendations: [],
    };

    // Generate recommendations
    result.recommendations =
      QuarantineDecisionEngine.generateRecommendations(result);

    return result;
  }

  /**
   * Analyze all tests for an application
   */
  async analyzeApplication(
    applicationId: string,
    windowDays: number = 30
  ): Promise<FlakinessResult[]> {
    // Get all test case IDs for this application
    const testCaseIds = await this.fetchTestCaseIds(applicationId);

    // Analyze each test
    const results = await Promise.all(
      testCaseIds.map((id) => this.analyzeTest(id, windowDays))
    );

    // Filter out stable tests (score < 20)
    return results.filter((r) => r.flakinessScore >= 20);
  }

  /**
   * Update stability metrics in database
   */
  async updateStabilityMetrics(
    testCaseId: string,
    result: FlakinessResult
  ): Promise<void> {
    await this.pool.query(
      `
      UPDATE test_stability_metrics
      SET
        flakiness_score = $1,
        confidence_level = $2,
        status = $3,
        flakiness_pattern = $4,
        last_calculated_at = NOW(),
        updated_at = NOW()
      WHERE test_case_id = $5
    `,
      [
        result.flakinessScore,
        result.confidenceLevel,
        result.classification,
        result.pattern,
        testCaseId,
      ]
    );
  }

  /**
   * Auto-quarantine tests that meet criteria
   */
  async autoQuarantine(result: FlakinessResult): Promise<void> {
    const decision = QuarantineDecisionEngine.shouldQuarantine(result);

    if (!decision.shouldQuarantine) return;

    // Insert quarantine record
    await this.pool.query(
      `
      INSERT INTO test_quarantine (
        test_case_id,
        application_id,
        quarantine_reason,
        flakiness_score_at_quarantine,
        auto_release_enabled,
        auto_release_threshold,
        quarantined_by
      )
      SELECT
        $1,
        application_id,
        $2,
        $3,
        true,
        $4,
        NULL -- System quarantine
      FROM test_case_master
      WHERE id = $1
      ON CONFLICT (test_case_id, application_id, status) DO NOTHING
    `,
      [
        result.testCaseId,
        decision.reason,
        result.flakinessScore,
        decision.autoReleaseThreshold,
      ]
    );
  }

  /**
   * Fetch test executions from database
   */
  private async fetchTestExecutions(
    testCaseId: string,
    windowDays: number
  ): Promise<TestExecution[]> {
    const result = await this.pool.query<{
      id: string;
      test_name: string;
      status: string;
      duration_ms: number;
      error_message: string;
      created_at: Date;
      environment_info: any;
    }>(
      `
      SELECT
        tce.id,
        tcm.test_key as test_name,
        tce.status,
        tce.duration_ms,
        tce.error_message
      FROM test_case_executions tce
      JOIN test_case_master tcm ON tcm.id = tce.test_case_master_id
      WHERE tce.test_case_master_id = $1
        AND tce.status IN ('passed', 'failed', 'skipped')
      ORDER BY tce.id DESC
      LIMIT 100
    `,
      [testCaseId]
    );

    return result.rows.map((row, idx) => ({
      testCaseId,
      testName: row.test_name,
      status: row.status as any,
      durationMs: row.duration_ms || 0,
      errorMessage: row.error_message,
      createdAt: new Date(Date.now() - idx * 60000), // Mock timestamps - most recent first
      environment: {},
    }));
  }

  /**
   * Fetch all test case IDs for an application
   */
  private async fetchTestCaseIds(applicationId: string): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM test_case_master WHERE application_id = $1`,
      [applicationId]
    );
    return result.rows.map((row) => row.id);
  }
}

export default FlakyTestDetectionService;
