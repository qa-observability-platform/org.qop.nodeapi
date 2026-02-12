/**
 * Migration: Add unique constraint to AI failure analysis
 *
 * Ensures one analysis per test execution
 */

exports.up = async (pgm) => {
  console.log('⏫ Adding unique constraint to test_failure_analysis...');

  pgm.sql(`
    ALTER TABLE test_failure_analysis
    ADD CONSTRAINT unique_test_case_execution
    UNIQUE (test_case_execution_id)
  `);

  console.log('✅ Unique constraint added');
};

exports.down = async (pgm) => {
  console.log('⏬ Removing unique constraint from test_failure_analysis...');

  pgm.sql(`
    ALTER TABLE test_failure_analysis
    DROP CONSTRAINT IF EXISTS unique_test_case_execution
  `);

  console.log('✅ Unique constraint removed');
};
