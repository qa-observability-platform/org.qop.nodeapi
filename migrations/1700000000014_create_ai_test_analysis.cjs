/**
 * Migration: Create AI Test Analysis Table
 *
 * This migration creates a comprehensive table to store AI-powered analysis
 * of test failures using Claude AI (primary) with OpenAI fallback.
 *
 * Features:
 * - Stores detailed root cause analysis and suggested fixes
 * - Links to test_case_executions table with CASCADE delete
 * - Categorizes failures (assertion, timeout, element_not_found, etc.)
 * - Tracks severity, confidence, and flakiness
 * - Supports multiple AI providers (Claude, OpenAI)
 * - Stores raw AI response for debugging
 * - Includes performance indexes
 */

exports.up = async (pgm) => {
  console.log('⏫ Creating AI test analysis table...');

  // Create ai_test_analysis table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_test_analysis (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_execution_id UUID NOT NULL UNIQUE REFERENCES test_case_executions(id) ON DELETE CASCADE,

      -- Analysis Results
      category VARCHAR(50) NOT NULL, -- assertion_failure, timeout, element_not_found, network_error, flaky_test, environment_issue, data_issue, unknown, error
      root_cause TEXT, -- Detailed explanation of why the test failed
      suggested_fix TEXT, -- Specific actionable steps to fix the issue
      severity VARCHAR(20), -- critical, high, medium, low
      confidence INTEGER, -- 0-100
      is_flaky BOOLEAN DEFAULT FALSE,

      -- AI Provider Metadata
      model_used VARCHAR(100), -- e.g., "claude-sonnet-4-5-20250929" or "gpt-4-turbo-preview"
      analyzed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      analysis_duration_ms INTEGER,

      -- Additional Context
      estimated_fix_time VARCHAR(50), -- e.g., "5 minutes", "1 hour", "4 hours"
      related_issues JSONB, -- Array of related problem areas
      raw_response JSONB, -- Full AI response for debugging
      analysis_error TEXT, -- Error message if analysis failed

      -- Timestamps
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✅ ai_test_analysis table created');

  // Create indexes for performance
  console.log('⏫ Creating indexes...');

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_execution_id ON ai_test_analysis(test_case_execution_id);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_category ON ai_test_analysis(category);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_is_flaky ON ai_test_analysis(is_flaky);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_severity ON ai_test_analysis(severity);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_analyzed_at ON ai_test_analysis(analyzed_at DESC);
  `);

  console.log('✅ Indexes created');

  // Create updated_at trigger
  console.log('⏫ Creating trigger...');

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_ai_analysis_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trigger_ai_analysis_updated_at ON ai_test_analysis;

    CREATE TRIGGER trigger_ai_analysis_updated_at
      BEFORE UPDATE ON ai_test_analysis
      FOR EACH ROW
      EXECUTE FUNCTION update_ai_analysis_updated_at();
  `);

  console.log('✅ Trigger created');

  // Add comments for documentation
  pgm.sql(`
    COMMENT ON TABLE ai_test_analysis IS 'AI-powered test failure analysis with root cause and fix suggestions';
    COMMENT ON COLUMN ai_test_analysis.root_cause IS 'AI-generated explanation of why the test failed';
    COMMENT ON COLUMN ai_test_analysis.suggested_fix IS 'AI-generated actionable steps to fix the issue';
    COMMENT ON COLUMN ai_test_analysis.category IS 'Failure category: assertion_failure, timeout, element_not_found, network_error, flaky_test, environment_issue, data_issue, unknown, error';
    COMMENT ON COLUMN ai_test_analysis.model_used IS 'AI model that generated the analysis (e.g., "claude-sonnet-4-5-20250929")';
    COMMENT ON COLUMN ai_test_analysis.confidence IS 'AI confidence in the analysis (0-100)';
  `);

  console.log('✅ AI test analysis migration complete');
};

exports.down = async (pgm) => {
  console.log('⏬ Rolling back AI test analysis table...');

  // Drop trigger
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_ai_analysis_updated_at ON ai_test_analysis;
    DROP FUNCTION IF EXISTS update_ai_analysis_updated_at();
  `);

  // Drop indexes
  pgm.sql(`
    DROP INDEX IF EXISTS idx_ai_analysis_execution_id;
    DROP INDEX IF EXISTS idx_ai_analysis_category;
    DROP INDEX IF EXISTS idx_ai_analysis_is_flaky;
    DROP INDEX IF EXISTS idx_ai_analysis_severity;
    DROP INDEX IF EXISTS idx_ai_analysis_analyzed_at;
  `);

  // Drop table
  pgm.sql(`
    DROP TABLE IF EXISTS ai_test_analysis;
  `);

  console.log('✅ AI test analysis rollback complete');
};
