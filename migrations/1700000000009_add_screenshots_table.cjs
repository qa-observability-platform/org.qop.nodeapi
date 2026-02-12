/* Add screenshots table for storing test failure screenshots */

exports.shorthands = undefined;

/**
 * Up: create screenshots table
 */
exports.up = (pgm) => {
  // Create screenshots table
  pgm.createTable('screenshots', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    test_case_execution_id: {
      type: 'uuid',
      notNull: true,
      references: 'test_case_executions',
      onDelete: 'cascade',
    },
    file_name: {
      type: 'varchar(255)',
      notNull: true,
    },
    file_path: {
      type: 'text',
      notNull: true,
      comment: 'Relative path or S3 key for the screenshot'
    },
    mime_type: {
      type: 'varchar(50)',
      notNull: true,
      default: 'image/png',
    },
    file_size: {
      type: 'integer',
      notNull: false,
      comment: 'Size in bytes'
    },
    screenshot_type: {
      type: 'varchar(50)',
      notNull: true,
      default: 'failure',
      comment: 'Type: failure, step, custom'
    },
    storage_type: {
      type: 'varchar(20)',
      notNull: true,
      default: 'local',
      comment: 'Storage location: local, s3, azure, gcs'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create index for fast lookup by execution
  pgm.createIndex('screenshots', ['test_case_execution_id']);

  // Create index for created_at for cleanup/archival jobs
  pgm.createIndex('screenshots', ['created_at']);
};

/**
 * Down: drop screenshots table
 */
exports.down = (pgm) => {
  pgm.dropTable('screenshots');
};
