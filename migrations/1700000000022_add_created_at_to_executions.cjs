// Migration: Add created_at to test_case_executions
// Required by pattern learning feedback job to order executions chronologically

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('test_case_executions', {
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.createIndex('test_case_executions', ['test_case_master_id', 'created_at'], {
    name: 'idx_tce_master_created_at',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('test_case_executions', ['test_case_master_id', 'created_at'], {
    name: 'idx_tce_master_created_at',
  });
  pgm.dropColumn('test_case_executions', 'created_at');
};
