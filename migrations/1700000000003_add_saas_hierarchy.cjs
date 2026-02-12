// migrations/1700000000003_add_saas_hierarchy.cjs

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // 1. Create projects table
  pgm.createTable('projects', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE',
    },
    project_key: {
      type: 'varchar(100)',
      notNull: true,
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    description: {
      type: 'text',
    },
    repo_url: {
      type: 'varchar(500)',
    },
    default_branch: {
      type: 'varchar(100)',
      default: 'main',
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

  pgm.createIndex('projects', 'org_id');
  pgm.createIndex('projects', ['org_id', 'project_key'], { unique: true });

  // 2. Create default project for existing organizations
  pgm.sql(`
    INSERT INTO projects (org_id, project_key, name, description)
    SELECT DISTINCT 
      o.id,
      'default-project',
      'Default Project',
      'Auto-migrated default project for existing applications'
    FROM organizations o
    WHERE EXISTS (SELECT 1 FROM applications WHERE org_id = o.id)
  `);

  // 3. Add project_id column to applications (nullable initially)
  pgm.addColumn('applications', {
    project_id: {
      type: 'uuid',
      references: 'projects',
      onDelete: 'CASCADE',
    },
  });

  // 4. Link existing applications to their org's default project
  pgm.sql(`
    UPDATE applications a
    SET project_id = (
      SELECT p.id 
      FROM projects p 
      WHERE p.org_id = a.org_id 
        AND p.project_key = 'default-project'
      LIMIT 1
    )
    WHERE project_id IS NULL
  `);

  // 5. Make project_id NOT NULL after migration
  pgm.alterColumn('applications', 'project_id', {
    notNull: true,
  });

  // 6. Add runner_type and repo_url to applications
  pgm.addColumn('applications', {
    runner_type: {
      type: 'varchar(50)',
      notNull: true,
      default: 'playwright',
    },
    repo_url: {
      type: 'varchar(500)',
    },
    framework_version: {
      type: 'varchar(50)',
    },
  });

  // 7. Update unique constraint on applications
  pgm.dropConstraint('applications', 'applications_org_id_app_key_key', {
    ifExists: true,
  });
  pgm.createIndex('applications', ['project_id', 'app_key'], { unique: true });
  pgm.createIndex('applications', 'project_id');

  // 8. Add runner_type and timing columns to test_runs
  pgm.addColumn('test_runs', {
    runner_type: {
      type: 'varchar(50)',
      default: 'playwright',
    },
    started_at: {
      type: 'timestamp',
    },
    finished_at: {
      type: 'timestamp',
    },
  });

  // 9. Create project_api_keys table
  pgm.createTable('project_api_keys', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects',
      onDelete: 'CASCADE',
    },
    key_hash: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    label: {
      type: 'varchar(255)',
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
    last_used_at: {
      type: 'timestamp',
    },
  });

  pgm.createIndex('project_api_keys', 'project_id');
  pgm.createIndex('project_api_keys', 'key_hash');

  // 10. Migrate existing API keys to project scope
  pgm.sql(`
    INSERT INTO project_api_keys (project_id, key_hash, label, created_at)
    SELECT DISTINCT
      a.project_id,
      ak.key_hash,
      CONCAT('Migrated from app: ', a.name),
      ak.created_at
    FROM application_api_keys ak
    JOIN applications a ON ak.application_id = a.id
    WHERE a.project_id IS NOT NULL
    ON CONFLICT (key_hash) DO NOTHING
  `);

  console.log('✅ Migration completed: Added SaaS hierarchy with projects');
};

exports.down = async (pgm) => {
  // Reverse migration
  pgm.dropTable('project_api_keys', { ifExists: true, cascade: true });
  
  pgm.dropColumn('test_runs', ['runner_type', 'started_at', 'finished_at'], {
    ifExists: true,
  });
  
  pgm.dropColumn('applications', ['runner_type', 'repo_url', 'framework_version'], {
    ifExists: true,
  });
  
  pgm.dropColumn('applications', 'project_id', { ifExists: true, cascade: true });
  
  pgm.dropTable('projects', { ifExists: true, cascade: true });
  
  console.log('✅ Rollback completed: Removed SaaS hierarchy');
};