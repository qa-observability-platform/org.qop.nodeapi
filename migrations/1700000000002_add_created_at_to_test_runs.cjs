/* S2-USx: Add created_at column to test_runs */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('test_runs', {
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Optional: index for sorting/filtering by recent runs
  pgm.createIndex('test_runs', ['created_at'], {
    name: 'ix_test_runs_created_at',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('test_runs', ['created_at'], {
    name: 'ix_test_runs_created_at',
  });
  pgm.dropColumn('test_runs', 'created_at');
};
