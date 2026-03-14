// Migration: Add deprecated_at to proven_solutions
// Required by pattern learning deprecation job

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('proven_solutions', {
    deprecated_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('proven_solutions', 'deprecated_at');
};
