exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
    -- 1. Drop existing check constraint and add new one including puppeteer and pytest
    ALTER TABLE job_counters DROP CONSTRAINT IF EXISTS job_counters_runner_type_check;
    ALTER TABLE job_counters ADD CONSTRAINT job_counters_runner_type_check
      CHECK (runner_type IN ('playwright', 'selenium', 'api', 'cypress', 'puppeteer', 'pytest'));

    -- 2. Update get_job_prefix function to include Puppeteer and Pytest
    CREATE OR REPLACE FUNCTION get_job_prefix(p_runner_type VARCHAR(20))
    RETURNS VARCHAR(10) AS $$
    BEGIN
      RETURN CASE
        WHEN p_runner_type = 'playwright' THEN 'PW'
        WHEN p_runner_type = 'selenium'   THEN 'SEL'
        WHEN p_runner_type = 'api'        THEN 'API'
        WHEN p_runner_type = 'cypress'    THEN 'CYP'
        WHEN p_runner_type = 'puppeteer'  THEN 'PUP'
        WHEN p_runner_type = 'pytest'     THEN 'PYT'
        ELSE 'RUN'
      END;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
    pgm.sql(`
    -- Revert check constraint
    ALTER TABLE job_counters DROP CONSTRAINT IF EXISTS job_counters_runner_type_check;
    ALTER TABLE job_counters ADD CONSTRAINT job_counters_runner_type_check
      CHECK (runner_type IN ('playwright', 'selenium', 'api', 'cypress'));

    -- Revert function
    CREATE OR REPLACE FUNCTION get_job_prefix(p_runner_type VARCHAR(20))
    RETURNS VARCHAR(10) AS $$
    BEGIN
      RETURN CASE
        WHEN p_runner_type = 'playwright' THEN 'PW'
        WHEN p_runner_type = 'selenium'   THEN 'SEL'
        WHEN p_runner_type = 'api'        THEN 'API'
        WHEN p_runner_type = 'cypress'    THEN 'CYP'
        ELSE 'RUN'
      END;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
