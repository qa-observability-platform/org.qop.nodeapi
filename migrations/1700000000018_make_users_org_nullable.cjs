// Migration: Make users.org_id and users.role nullable
//
// The original users table required org_id and role to be NOT NULL.
// The new auth system tracks org membership in user_organizations (many-to-many),
// so these legacy columns are no longer needed on registration.

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // Make org_id nullable — org membership now lives in user_organizations
  pgm.alterColumn('users', 'org_id', {
    notNull: false,
  });

  // Make role nullable — roles now live in user_organizations / user_projects
  pgm.alterColumn('users', 'role', {
    notNull: false,
  });

  console.log('✅ Migration completed: users.org_id and users.role are now nullable');
};

exports.down = async (pgm) => {
  // Re-add NOT NULL constraints (will fail if any rows have NULL values)
  pgm.alterColumn('users', 'org_id', {
    notNull: true,
  });

  pgm.alterColumn('users', 'role', {
    notNull: true,
  });

  console.log('✅ Rollback completed: users.org_id and users.role are NOT NULL again');
};
