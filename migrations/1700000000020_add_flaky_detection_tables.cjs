// Migration: Add flaky test detection tables
// Creates: test_stability_metrics, test_quarantine, flakiness_events, flakiness_insights

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Test stability metrics (one row per test case, updated each analysis run)
    CREATE TABLE IF NOT EXISTS test_stability_metrics (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_id        UUID NOT NULL REFERENCES test_case_master(id) ON DELETE CASCADE,
      application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      flakiness_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
      confidence_level    NUMERIC(5,2) NOT NULL DEFAULT 0,
      status              VARCHAR(20) NOT NULL DEFAULT 'stable'
                            CHECK (status IN ('stable', 'flaky', 'quarantined')),
      flakiness_pattern   TEXT,
      last_calculated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (test_case_id, application_id)
    );

    -- 2. Test quarantine (tracks active/resolved quarantine decisions)
    CREATE TABLE IF NOT EXISTS test_quarantine (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_id                UUID NOT NULL REFERENCES test_case_master(id) ON DELETE CASCADE,
      application_id              UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      status                      VARCHAR(20) NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'resolved')),
      quarantine_reason           TEXT NOT NULL,
      flakiness_score_at_quarantine NUMERIC(5,2),
      auto_release_enabled        BOOLEAN NOT NULL DEFAULT true,
      auto_release_threshold      NUMERIC(5,2) NOT NULL DEFAULT 20,
      quarantined_by              UUID REFERENCES users(id) ON DELETE SET NULL,
      resolved_at                 TIMESTAMPTZ,
      resolved_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
      resolution_notes            TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (test_case_id, application_id, status)
    );

    -- 3. Flakiness events (audit log of flaky behavior occurrences)
    CREATE TABLE IF NOT EXISTS flakiness_events (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_case_id        UUID NOT NULL REFERENCES test_case_master(id) ON DELETE CASCADE,
      test_run_id         UUID REFERENCES test_runs(id) ON DELETE SET NULL,
      execution_id        UUID REFERENCES test_case_executions(id) ON DELETE SET NULL,
      event_type          VARCHAR(50) NOT NULL,
      current_status      VARCHAR(20),
      failure_reason      TEXT,
      environment_info    TEXT,
      suspected_root_cause VARCHAR(100),
      confidence          NUMERIC(5,2) DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 4. Flakiness insights (daily/weekly/monthly aggregates per application)
    CREATE TABLE IF NOT EXISTS flakiness_insights (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id          UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      period_start            DATE NOT NULL,
      period_end              DATE NOT NULL,
      period_type             VARCHAR(20) NOT NULL DEFAULT 'daily'
                                CHECK (period_type IN ('daily', 'weekly', 'monthly')),
      total_flaky_tests       INTEGER NOT NULL DEFAULT 0,
      total_quarantined_tests INTEGER NOT NULL DEFAULT 0,
      avg_flakiness_score     NUMERIC(5,2) DEFAULT 0,
      tests_became_flaky      INTEGER DEFAULT 0,
      tests_became_stable     INTEGER DEFAULT 0,
      flakiness_trend         VARCHAR(20),
      top_flaky_tests         JSONB,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (application_id, period_start, period_end, period_type)
    );

    -- Indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_stability_metrics_application ON test_stability_metrics(application_id);
    CREATE INDEX IF NOT EXISTS idx_stability_metrics_score ON test_stability_metrics(flakiness_score DESC);
    CREATE INDEX IF NOT EXISTS idx_quarantine_status ON test_quarantine(test_case_id, status);
    CREATE INDEX IF NOT EXISTS idx_flakiness_events_test ON flakiness_events(test_case_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_flakiness_insights_app ON flakiness_insights(application_id, period_start DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS flakiness_insights;
    DROP TABLE IF EXISTS flakiness_events;
    DROP TABLE IF EXISTS test_quarantine;
    DROP TABLE IF EXISTS test_stability_metrics;
  `);
};
