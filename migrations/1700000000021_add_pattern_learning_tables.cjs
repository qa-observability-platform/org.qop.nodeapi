// Migration: Add pattern learning tables
// Creates: error_pattern_signatures, proven_solutions, solution_outcome_tracking, pattern_learning_analytics

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Error pattern signatures (fingerprints of recurring error types)
    CREATE TABLE IF NOT EXISTS error_pattern_signatures (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id          UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      pattern_hash            VARCHAR(64) NOT NULL,
      pattern_type            VARCHAR(50) NOT NULL,
      error_message_pattern   TEXT,
      error_type              VARCHAR(100),
      stack_trace_signature   TEXT,
      test_context            JSONB,
      category                VARCHAR(50),
      severity                VARCHAR(20),
      occurrence_count        INTEGER NOT NULL DEFAULT 1,
      first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (application_id, pattern_hash)
    );

    -- 2. Proven solutions (AI-generated fixes that have worked before)
    CREATE TABLE IF NOT EXISTS proven_solutions (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_signature_id    UUID NOT NULL REFERENCES error_pattern_signatures(id) ON DELETE CASCADE,
      application_id          UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      solution_hash           VARCHAR(64) NOT NULL,
      suggested_fix           TEXT NOT NULL,
      root_cause_analysis     TEXT,
      fix_category            VARCHAR(50),
      original_ai_provider    VARCHAR(50),
      original_ai_model       VARCHAR(100),
      original_confidence     NUMERIC(5,2),
      times_suggested         INTEGER NOT NULL DEFAULT 0,
      times_successful        INTEGER NOT NULL DEFAULT 0,
      times_failed            INTEGER NOT NULL DEFAULT 0,
      success_rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
      confidence_score        NUMERIC(5,2) NOT NULL DEFAULT 0,
      status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'deprecated', 'superseded')),
      avg_resolution_time_ms  BIGINT,
      first_success_at        TIMESTAMPTZ,
      last_success_at         TIMESTAMPTZ,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (pattern_signature_id, solution_hash)
    );

    -- 3. Solution outcome tracking (did the suggested fix actually work?)
    CREATE TABLE IF NOT EXISTS solution_outcome_tracking (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_master_id     UUID NOT NULL REFERENCES test_case_master(id) ON DELETE CASCADE,
      failed_execution_id     UUID REFERENCES test_case_executions(id) ON DELETE SET NULL,
      ai_analysis_id          UUID,
      pattern_signature_id    UUID REFERENCES error_pattern_signatures(id) ON DELETE SET NULL,
      proven_solution_id      UUID REFERENCES proven_solutions(id) ON DELETE SET NULL,
      solution_shown_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      solution_source         VARCHAR(20) NOT NULL
                                CHECK (solution_source IN ('fresh_ai', 'cached_pattern', 'hybrid')),
      was_cached              BOOLEAN NOT NULL DEFAULT false,
      next_execution_id       UUID REFERENCES test_case_executions(id) ON DELETE SET NULL,
      next_execution_status   VARCHAR(20),
      resolution_successful   BOOLEAN,
      outcome_detected_at     TIMESTAMPTZ,
      test_key                TEXT NOT NULL,
      application_id          UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      notes                   TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 4. Pattern learning analytics (aggregated metrics per period)
    CREATE TABLE IF NOT EXISTS pattern_learning_analytics (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id              UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      period_start                DATE NOT NULL,
      period_end                  DATE NOT NULL,
      period_type                 VARCHAR(20) NOT NULL DEFAULT 'daily'
                                    CHECK (period_type IN ('daily', 'weekly', 'monthly')),
      total_failures_analyzed     INTEGER NOT NULL DEFAULT 0,
      patterns_matched            INTEGER NOT NULL DEFAULT 0,
      cached_responses_used       INTEGER NOT NULL DEFAULT 0,
      cached_solutions_successful INTEGER NOT NULL DEFAULT 0,
      cached_solutions_failed     INTEGER NOT NULL DEFAULT 0,
      fresh_ai_calls              INTEGER NOT NULL DEFAULT 0,
      ai_api_calls_saved          INTEGER NOT NULL DEFAULT 0,
      pattern_accuracy_rate       NUMERIC(5,2) DEFAULT 0,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (application_id, period_start, period_end, period_type)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_error_patterns_app ON error_pattern_signatures(application_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proven_solutions_pattern ON proven_solutions(pattern_signature_id, status);
    CREATE INDEX IF NOT EXISTS idx_outcome_tracking_app ON solution_outcome_tracking(application_id, solution_shown_at DESC);
    CREATE INDEX IF NOT EXISTS idx_outcome_tracking_execution ON solution_outcome_tracking(failed_execution_id);
    CREATE INDEX IF NOT EXISTS idx_pattern_analytics_app ON pattern_learning_analytics(application_id, period_start DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS pattern_learning_analytics;
    DROP TABLE IF EXISTS solution_outcome_tracking;
    DROP TABLE IF EXISTS proven_solutions;
    DROP TABLE IF EXISTS error_pattern_signatures;
  `);
};
