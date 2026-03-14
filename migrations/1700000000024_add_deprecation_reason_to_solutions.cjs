// Migration: Add deprecation_reason to proven_solutions

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('proven_solutions', {
    deprecation_reason: {
      type: 'text',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('proven_solutions', 'deprecation_reason');
};
