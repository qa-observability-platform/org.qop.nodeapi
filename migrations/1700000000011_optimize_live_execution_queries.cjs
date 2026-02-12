/**
 * Migration: Optimize Live Execution Queries
 *
 * This migration adds database indexes to optimize the live execution system
 * that supports multi-execution broadcasting.
 *
 * Performance optimizations:
 * 1. Index on (run_id) for fast applicationId lookup during broadcasts
 * 2. Index on (application_id, status) for efficient live-executions API
 * 3. Composite index for common query patterns
 */

exports.up = async (pgm) => {
  console.log('⏫ Adding indexes for live execution optimization...');

  // Index for fast runId -> applicationId lookups (used in WebSocket broadcasting)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_test_runs_run_id
    ON test_runs(run_id)
  `);

  // Composite index for live executions query
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_test_runs_app_status
    ON test_runs(application_id, status)
    WHERE status IN ('running', 'in_progress')
  `);

  // Index for test executions by run and status (for real-time stats)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_test_case_executions_run_status
    ON test_case_executions(test_run_id, status)
  `);

  console.log('✅ Live execution indexes created successfully');
};

exports.down = async (pgm) => {
  console.log('⏬ Removing live execution indexes...');

  pgm.sql('DROP INDEX IF EXISTS idx_test_runs_run_id');
  pgm.sql('DROP INDEX IF EXISTS idx_test_runs_app_status');
  pgm.sql('DROP INDEX IF EXISTS idx_test_case_executions_run_status');

  console.log('✅ Live execution indexes removed');
};
