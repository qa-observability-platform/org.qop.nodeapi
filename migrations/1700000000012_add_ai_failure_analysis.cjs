/**
 * Migration: Add AI Failure Analysis Table
 *
 * This migration creates a table to store AI-powered analysis of test failures,
 * timeouts, and skipped tests using Claude AI.
 *
 * Features:
 * - Stores analysis results for each test execution
 * - Links to test_case_executions table
 * - Caches analysis to avoid redundant AI calls
 * - Supports both real-time and batch analysis
 */

exports.up = async (pgm) => {
  console.log('⏫ Creating AI failure analysis table...');

  // Create test_failure_analysis table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS test_failure_analysis (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_execution_id UUID NOT NULL REFERENCES test_case_executions(id) ON DELETE CASCADE,

      -- Analysis metadata
      analyzed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      model_version VARCHAR(100),
      analysis_duration_ms INTEGER,

      -- Categorization
      category VARCHAR(50) NOT NULL,
      -- Categories: assertion, selector, network, timeout, environment, race_condition, flaky, skipped, other

      -- AI Analysis Results
      root_cause TEXT,
      recommendation TEXT,
      severity VARCHAR(20),
      -- Severity: critical, high, medium, low

      -- Confidence and Flags
      confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
      is_flaky BOOLEAN DEFAULT FALSE,
      is_timeout BOOLEAN DEFAULT FALSE,
      is_skipped BOOLEAN DEFAULT FALSE,

      -- Additional context
      previous_failure_count INTEGER DEFAULT 0,
      pattern_detected BOOLEAN DEFAULT FALSE,

      -- Raw AI response (for debugging and improvement)
      raw_response JSONB,

      -- Error handling
      analysis_error TEXT,
      from_cache BOOLEAN DEFAULT FALSE,

      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Index for fast lookups by test execution
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_failure_analysis_test_execution
    ON test_failure_analysis(test_case_execution_id)
  `);

  // Index for category filtering
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_failure_analysis_category
    ON test_failure_analysis(category)
  `);

  // Index for flaky test detection
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_failure_analysis_flaky
    ON test_failure_analysis(is_flaky)
    WHERE is_flaky = TRUE
  `);

  // Index for severity filtering
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_failure_analysis_severity
    ON test_failure_analysis(severity)
  `);

  // Composite index for analysis queries
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_failure_analysis_execution_category
    ON test_failure_analysis(test_case_execution_id, category, analyzed_at DESC)
  `);

  console.log('✅ AI failure analysis table created successfully');
};

exports.down = async (pgm) => {
  console.log('⏬ Dropping AI failure analysis table...');

  pgm.sql('DROP INDEX IF EXISTS idx_failure_analysis_execution_category');
  pgm.sql('DROP INDEX IF EXISTS idx_failure_analysis_severity');
  pgm.sql('DROP INDEX IF EXISTS idx_failure_analysis_flaky');
  pgm.sql('DROP INDEX IF EXISTS idx_failure_analysis_category');
  pgm.sql('DROP INDEX IF EXISTS idx_failure_analysis_test_execution');
  pgm.sql('DROP TABLE IF EXISTS test_failure_analysis');

  console.log('✅ AI failure analysis table dropped');
};
