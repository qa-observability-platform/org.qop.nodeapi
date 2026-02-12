/* Add created_at and updated_at timestamps to organizations table */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add created_at column with default value
  pgm.addColumn('organizations', {
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Add updated_at column with default value
  pgm.addColumn('organizations', {
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create a trigger to automatically update updated_at
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = current_timestamp;
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  pgm.sql(`
    CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations');
  pgm.sql('DROP FUNCTION IF EXISTS update_updated_at_column()');
  pgm.dropColumn('organizations', 'updated_at');
  pgm.dropColumn('organizations', 'created_at');
};
