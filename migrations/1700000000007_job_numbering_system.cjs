// Migration: Job Numbering System for Runner Types

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Add job_number and job_prefix columns to test_runs
    ALTER TABLE test_runs
    ADD COLUMN IF NOT EXISTS job_number INTEGER,
    ADD COLUMN IF NOT EXISTS job_prefix VARCHAR(10);

    -- 2. Create job_counters table
    CREATE TABLE IF NOT EXISTS job_counters (
      application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      runner_type VARCHAR(20) NOT NULL CHECK (runner_type IN ('playwright', 'selenium', 'api')),
      next_number INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (application_id, runner_type)
    );

    -- 3. Create function to get next job number (atomic increment)
    CREATE OR REPLACE FUNCTION get_next_job_number(
      p_application_id UUID,
      p_runner_type VARCHAR(20)
    ) RETURNS INTEGER AS $$
    DECLARE
      v_next_number INTEGER;
    BEGIN
      INSERT INTO job_counters (application_id, runner_type, next_number, updated_at)
      VALUES (p_application_id, p_runner_type, 2, NOW())
      ON CONFLICT (application_id, runner_type)
      DO UPDATE SET
        next_number = job_counters.next_number + 1,
        updated_at = NOW()
      RETURNING next_number - 1 INTO v_next_number;

      RETURN v_next_number;
    END;
    $$ LANGUAGE plpgsql;

    -- 4. Create function to get job prefix for runner type
    CREATE OR REPLACE FUNCTION get_job_prefix(p_runner_type VARCHAR(20))
    RETURNS VARCHAR(10) AS $$
    BEGIN
      RETURN CASE
        WHEN p_runner_type = 'playwright' THEN 'PW'
        WHEN p_runner_type = 'selenium' THEN 'SEL'
        WHEN p_runner_type = 'api' THEN 'API'
        ELSE 'RUN'
      END;
    END;
    $$ LANGUAGE plpgsql;

    -- 5. Create indexes
    CREATE INDEX IF NOT EXISTS idx_test_runs_job_number ON test_runs(application_id, runner_type, job_number DESC);
    CREATE INDEX IF NOT EXISTS idx_job_counters_app_runner ON job_counters(application_id, runner_type);

    -- 6. Add comments
    COMMENT ON TABLE job_counters IS 'Maintains auto-incrementing job numbers per application and runner type';
    COMMENT ON COLUMN test_runs.job_number IS 'Auto-incrementing job number for this runner type (e.g., 1, 2, 3)';
    COMMENT ON COLUMN test_runs.job_prefix IS 'Job prefix based on runner type (PW, SEL, API)';
    COMMENT ON FUNCTION get_next_job_number IS 'Atomically gets next job number for an application + runner type combination';
    COMMENT ON FUNCTION get_job_prefix IS 'Returns job prefix (PW, SEL, API) for a given runner type';
  `);

  // Backfill existing test runs with job numbers
  pgm.sql(`
    DO $$
    DECLARE
      run_record RECORD;
      next_num INTEGER;
      prefix VARCHAR(10);
    BEGIN
      FOR run_record IN
        SELECT id, application_id, runner_type
        FROM test_runs
        WHERE job_number IS NULL AND runner_type IS NOT NULL
        ORDER BY created_at ASC
      LOOP
        next_num := get_next_job_number(run_record.application_id, run_record.runner_type);
        prefix := get_job_prefix(run_record.runner_type);

        UPDATE test_runs
        SET job_number = next_num,
            job_prefix = prefix
        WHERE id = run_record.id;
      END LOOP;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_test_runs_job_number;
    DROP INDEX IF EXISTS idx_job_counters_app_runner;
    DROP FUNCTION IF EXISTS get_next_job_number;
    DROP FUNCTION IF EXISTS get_job_prefix;
    DROP TABLE IF EXISTS job_counters CASCADE;
    ALTER TABLE test_runs DROP COLUMN IF EXISTS job_number;
    ALTER TABLE test_runs DROP COLUMN IF EXISTS job_prefix;
  `);
};
