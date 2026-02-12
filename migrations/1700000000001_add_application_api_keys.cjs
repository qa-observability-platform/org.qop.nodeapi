/* S1-US4: Add application_api_keys table */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('application_api_keys', {
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
    key_hash: {
      type: 'text',
      notNull: true,
      comment: 'SHA-256 hash of the API key',
    },
    label: {
      type: 'varchar(100)',
      notNull: false,
      comment: 'Human-readable label such as "playwright-ci" or "local-dev"',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    revoked_at: {
      type: 'timestamptz',
      notNull: false,
    },
    last_used_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });

  // Prevent duplicate active keys for same app+hash
  pgm.addConstraint(
    'application_api_keys',
    'application_api_keys_app_hash_unique',
    {
      unique: ['application_id', 'key_hash'],
    }
  );

  // Helpful index for resolving by hash
  pgm.createIndex('application_api_keys', ['key_hash'], {
    name: 'ix_application_api_keys_key_hash',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('application_api_keys');
};
