// migrations/1700000000004_add_users_and_auth.cjs

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // 1. ALTER existing users table (created in migration 0) to add auth columns
  pgm.addColumns('users', {
    password_hash: {
      type: 'varchar(255)',
      notNull: false, // nullable initially for existing rows
    },
    first_name: {
      type: 'varchar(100)',
    },
    last_name: {
      type: 'varchar(100)',
    },
    is_email_verified: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    email_verification_token: {
      type: 'varchar(255)',
    },
    email_verification_expires: {
      type: 'timestamp',
    },
    password_reset_token: {
      type: 'varchar(255)',
    },
    password_reset_expires: {
      type: 'timestamp',
    },
    last_login_at: {
      type: 'timestamp',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Add unique constraint on email (migration 0 only had org_id+email unique)
  pgm.addConstraint('users', 'users_email_unique', { unique: ['email'] });

  pgm.createIndex('users', 'email_verification_token');
  pgm.createIndex('users', 'password_reset_token');

  // 2. Create user_organizations table (many-to-many with roles)
  pgm.createTable('user_organizations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    org_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'varchar(50)',
      notNull: true,
    },
    invited_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    joined_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addConstraint('user_organizations', 'user_organizations_unique', {
    unique: ['user_id', 'org_id'],
  });

  pgm.createIndex('user_organizations', 'user_id');
  pgm.createIndex('user_organizations', 'org_id');
  pgm.createIndex('user_organizations', 'role');

  // 3. Create user_projects table (project-level roles)
  pgm.createTable('user_projects', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'varchar(50)',
      notNull: true,
    },
    invited_by: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    joined_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addConstraint('user_projects', 'user_projects_unique', {
    unique: ['user_id', 'project_id'],
  });

  pgm.createIndex('user_projects', 'user_id');
  pgm.createIndex('user_projects', 'project_id');
  pgm.createIndex('user_projects', 'role');

  // 4. Create invitations table
  pgm.createTable('invitations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    org_id: {
      type: 'uuid',
      references: 'organizations',
      onDelete: 'CASCADE',
    },
    project_id: {
      type: 'uuid',
      references: 'projects',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'varchar(50)',
      notNull: true,
    },
    token: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    invited_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'pending',
    },
    expires_at: {
      type: 'timestamp',
      notNull: true,
    },
    accepted_at: {
      type: 'timestamp',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('invitations', 'email');
  pgm.createIndex('invitations', 'token');
  pgm.createIndex('invitations', 'status');

  // 5. Create refresh_tokens table
  pgm.createTable('refresh_tokens', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    token: {
      type: 'varchar(500)',
      notNull: true,
      unique: true,
    },
    expires_at: {
      type: 'timestamp',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    revoked_at: {
      type: 'timestamp',
    },
  });

  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'token');

  // 6. Create audit_logs table
  pgm.createTable('audit_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      references: 'users',
      onDelete: 'SET NULL',
    },
    org_id: {
      type: 'uuid',
      references: 'organizations',
      onDelete: 'CASCADE',
    },
    action: {
      type: 'varchar(100)',
      notNull: true,
    },
    resource_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    resource_id: {
      type: 'uuid',
    },
    metadata: {
      type: 'jsonb',
    },
    ip_address: {
      type: 'varchar(45)',
    },
    user_agent: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('audit_logs', 'user_id');
  pgm.createIndex('audit_logs', 'org_id');
  pgm.createIndex('audit_logs', 'action');
  pgm.createIndex('audit_logs', 'created_at');

  console.log('✅ Migration completed: Added users and auth tables');
};

exports.down = async (pgm) => {
  pgm.dropTable('audit_logs', { ifExists: true, cascade: true });
  pgm.dropTable('refresh_tokens', { ifExists: true, cascade: true });
  pgm.dropTable('invitations', { ifExists: true, cascade: true });
  pgm.dropTable('user_projects', { ifExists: true, cascade: true });
  pgm.dropTable('user_organizations', { ifExists: true, cascade: true });

  // Remove auth columns added to users (keep the original table from migration 0)
  pgm.dropConstraint('users', 'users_email_unique', { ifExists: true });
  pgm.dropColumns('users', [
    'password_hash', 'first_name', 'last_name',
    'is_email_verified', 'email_verification_token', 'email_verification_expires',
    'password_reset_token', 'password_reset_expires',
    'last_login_at', 'is_active', 'created_at', 'updated_at',
  ]);

  console.log('✅ Rollback completed: Removed auth columns and related tables');
};