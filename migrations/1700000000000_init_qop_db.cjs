/* S1-US1: Initialize qop_db core tables */

exports.shorthands = undefined;

/**
 * Up: create organizations, applications, users, test_runs,
 * test_case_master, test_case_executions, test_case_events.
 */
exports.up = (pgm) => {
  // Ensure pgcrypto extension is available for gen_random_uuid()
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  // 1) organizations
  pgm.createTable('organizations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
  });

  // 2) applications
  pgm.createTable('applications', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'cascade',
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    app_key: {
      type: 'varchar(100)',
      notNull: true,
    },
  });

  // app_key should be unique per application
  pgm.addConstraint('applications', 'applications_app_key_unique', {
    unique: ['app_key'],
  });

  // 3) users
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'cascade',
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    role: {
      type: 'varchar(50)',
      notNull: true,
      // values map to RBAC_Model sheet later (org_admin, org_user, etc.)
    },
  });

  pgm.addConstraint('users', 'users_email_org_unique', {
    unique: ['org_id', 'email'],
  });

  // 4) test_runs
  pgm.createTable('test_runs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    application_id: {
      type: 'uuid',
      notNull: true,
      references: 'applications',
      onDelete: 'cascade',
    },
    run_id: {
      type: 'varchar(255)',
      notNull: true,
      // external or human-friendly identifier
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      // running, passed, failed, aborted, etc.
    },
    branch: {
      type: 'varchar(255)',
      notNull: false,
    },
    commit_sha: {
      type: 'varchar(64)',
      notNull: false,
    },
    ci_build_number: {
      type: 'varchar(50)',
      notNull: false,
    },
    environment: {
      type: 'varchar(50)',
      notNull: false,
      // e.g. dev, staging, prod
    },
  });

  // Helpful index for querying runs
  pgm.createIndex('test_runs', ['application_id', 'run_id']);

  // 5) test_case_master
  pgm.createTable('test_case_master', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    application_id: {
      type: 'uuid',
      notNull: true,
      references: 'applications',
      onDelete: 'cascade',
    },
    test_key: {
      type: 'varchar(500)',
      notNull: true,
      // stable unique key (e.g. "filePath:fullTitle")
    },
    owner_user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users',
      onDelete: 'set null',
    },
    labels: {
      type: 'jsonb',
      notNull: false,
      // flexible labels for feature, epic, severity, etc.
    },
  });

  pgm.addConstraint('test_case_master', 'test_case_master_app_key_unique', {
    unique: ['application_id', 'test_key'],
  });

  // 6) test_case_executions
  pgm.createTable('test_case_executions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
    test_run_id: {
      type: 'uuid',
      notNull: true,
      references: 'test_runs',
      onDelete: 'cascade',
    },
    test_case_master_id: {
      type: 'uuid',
      notNull: true,
      references: 'test_case_master',
      onDelete: 'cascade',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      // passed, failed, skipped, flaky, etc.
    },
    duration_ms: {
      type: 'integer',
      notNull: false,
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
    error_stack: {
      type: 'text',
      notNull: false,
    },
  });

  pgm.createIndex('test_case_executions', ['test_run_id', 'status']);
  pgm.createIndex('test_case_executions', ['test_case_master_id']);

  // 7) test_case_events
  pgm.createTable('test_case_events', {
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
    event_type: {
      type: 'varchar(50)',
      notNull: true,
      // step_started, step_finished, log, attachment, etc.
    },
    step_name: {
      type: 'varchar(255)',
      notNull: false,
    },
    payload: {
      type: 'jsonb',
      notNull: false,
      // additional details like locator, screenshot path, assertions, etc.
    },
  });

  pgm.createIndex('test_case_events', ['test_case_execution_id']);
};

/**
 * Down: drop tables in reverse order to satisfy FKs.
 */
exports.down = (pgm) => {
  pgm.dropTable('test_case_events');
  pgm.dropTable('test_case_executions');
  pgm.dropTable('test_case_master');
  pgm.dropTable('test_runs');
  pgm.dropTable('users');
  pgm.dropTable('applications');
  pgm.dropTable('organizations');

  // optionally drop extension (usually you keep it)
  // pgm.dropExtension('pgcrypto');
};
