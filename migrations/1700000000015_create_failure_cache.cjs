/**
 * Migration: Create Failure Cache Table
 *
 * This migration creates a multi-level caching system for AI analysis results
 * to avoid redundant API calls and reduce costs by 60-70%.
 *
 * Cache Levels:
 * - L1: Exact Match Cache (1 hour TTL) - Same error, same test
 * - L2: Similar Failure Cache (24 hour TTL) - Same error pattern, different test
 * - L3: Category Cache (7 day TTL) - Generic templates by category + framework
 *
 * Expected Hit Rate: 60-70% for mature test suites
 * Cost Savings: 60-70% reduction in AI API calls
 */

exports.up = async (pgm) => {
  console.log('⏫ Creating failure cache table...');

  // Create failure_cache table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS failure_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Cache Key
      error_signature VARCHAR(64) NOT NULL,  -- MD5 hash of normalized error pattern
      framework VARCHAR(50) NOT NULL,        -- selenium, puppeteer, playwright, cypress
      cache_level VARCHAR(2) NOT NULL,       -- L1, L2, L3

      -- Analysis Results (cached)
      category VARCHAR(50),
      root_cause TEXT,
      suggested_fix TEXT,
      severity VARCHAR(20),
      confidence INTEGER,
      is_flaky BOOLEAN DEFAULT FALSE,
      model_used VARCHAR(100),

      -- Cache Management
      expires_at TIMESTAMP NOT NULL,
      hit_count INTEGER DEFAULT 0,           -- How many times this cache entry was used
      last_used_at TIMESTAMP,
      is_template BOOLEAN DEFAULT FALSE,      -- True for L3 category templates

      -- Timestamps
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      -- Composite unique constraint
      CONSTRAINT unique_cache_entry UNIQUE (error_signature, framework, cache_level)
    );
  `);

  console.log('✅ failure_cache table created');

  // Create indexes for performance
  console.log('⏫ Creating indexes...');

  pgm.sql(`
    -- Primary lookup index (L1/L2 cache)
    CREATE INDEX IF NOT EXISTS idx_failure_cache_signature_framework
    ON failure_cache(error_signature, framework, cache_level);

    -- L3 category lookup index
    CREATE INDEX IF NOT EXISTS idx_failure_cache_category
    ON failure_cache(category, framework, cache_level)
    WHERE is_template = true;

    -- Expiration cleanup index
    CREATE INDEX IF NOT EXISTS idx_failure_cache_expires_at
    ON failure_cache(expires_at);

    -- Popular cache entries (for analytics)
    CREATE INDEX IF NOT EXISTS idx_failure_cache_hit_count
    ON failure_cache(hit_count DESC);

    -- Last used (for LRU eviction)
    CREATE INDEX IF NOT EXISTS idx_failure_cache_last_used
    ON failure_cache(last_used_at DESC);
  `);

  console.log('✅ Indexes created');

  // Create updated_at trigger
  console.log('⏫ Creating trigger...');

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_failure_cache_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trigger_failure_cache_updated_at ON failure_cache;

    CREATE TRIGGER trigger_failure_cache_updated_at
      BEFORE UPDATE ON failure_cache
      FOR EACH ROW
      EXECUTE FUNCTION update_failure_cache_updated_at();
  `);

  console.log('✅ Trigger created');

  // Add comments for documentation
  pgm.sql(`
    COMMENT ON TABLE failure_cache IS 'Multi-level cache for AI analysis results to reduce API calls by 60-70%';
    COMMENT ON COLUMN failure_cache.error_signature IS 'MD5 hash of normalized error message (removes line numbers, paths, timestamps)';
    COMMENT ON COLUMN failure_cache.cache_level IS 'L1=exact match (1h), L2=similar (24h), L3=category template (7d)';
    COMMENT ON COLUMN failure_cache.hit_count IS 'Number of times this cache entry was reused';
    COMMENT ON COLUMN failure_cache.is_template IS 'True for L3 generic category templates';
  `);

  console.log('✅ Failure cache migration complete');
};

exports.down = async (pgm) => {
  console.log('⏬ Rolling back failure cache table...');

  // Drop trigger
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_failure_cache_updated_at ON failure_cache;
    DROP FUNCTION IF EXISTS update_failure_cache_updated_at();
  `);

  // Drop indexes
  pgm.sql(`
    DROP INDEX IF EXISTS idx_failure_cache_signature_framework;
    DROP INDEX IF EXISTS idx_failure_cache_category;
    DROP INDEX IF EXISTS idx_failure_cache_expires_at;
    DROP INDEX IF EXISTS idx_failure_cache_hit_count;
    DROP INDEX IF EXISTS idx_failure_cache_last_used;
  `);

  // Drop table
  pgm.sql(`
    DROP TABLE IF EXISTS failure_cache;
  `);

  console.log('✅ Failure cache rollback complete');
};
