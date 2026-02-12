// Migration: User Preferences

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme VARCHAR(20) DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'system')),
      date_format VARCHAR(20) DEFAULT 'YYYY-MM-DD',
      time_format VARCHAR(10) DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),
      default_time_range VARCHAR(20) DEFAULT '7d',
      timezone VARCHAR(100) DEFAULT 'UTC',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    COMMENT ON TABLE user_preferences IS 'User-specific UI and display preferences';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS user_preferences CASCADE;`);
};
