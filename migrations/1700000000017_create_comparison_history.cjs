/**
 * Migration: Create comparison_history table
 * Stores saved comparative analysis results between two test runs
 */

exports.up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS comparison_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      current_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
      compare_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
      application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,

      comparison_name VARCHAR(255),
      is_bookmarked BOOLEAN DEFAULT FALSE,
      notes TEXT,
      tags TEXT[],

      comparison_result JSONB,
      risk_score_data JSONB,

      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      view_count INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT unique_comparison_pair UNIQUE (current_run_id, compare_run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_comparison_history_application_id
      ON comparison_history(application_id);
    CREATE INDEX IF NOT EXISTS idx_comparison_history_created_at
      ON comparison_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comparison_history_is_bookmarked
      ON comparison_history(is_bookmarked) WHERE is_bookmarked = TRUE;
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_comparison_history_is_bookmarked;
    DROP INDEX IF EXISTS idx_comparison_history_created_at;
    DROP INDEX IF EXISTS idx_comparison_history_application_id;
    DROP TABLE IF EXISTS comparison_history;
  `);
};
