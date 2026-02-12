// src/scripts/create-api-key.ts
/**
 * Script to create an API key for a given application.
 *
 * Usage:
 *   npm run create:apikey -- <application_id> [label]
 *
 * Example:
 *   npm run create:apikey -- 7f2f3f4e-... "playwright-ci"
 */

import { pool } from '../db/pool.js';
import { generateApiKey, hashApiKey } from '../utils/apiKey.js';

async function main() {
  // For npm + tsx, args start after index 1:
  // node, tsx, <appId>, [label]
  const [, , appId, labelArg] = process.argv;

  if (!appId) {
    console.error(
      'Usage: npm run create:apikey -- <application_id> [label]'
    );
    process.exit(1);
  }

  const label = labelArg ?? 'default';

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ensure application exists
    const appRes = await client.query(
      'SELECT id, name FROM applications WHERE id = $1',
      [appId]
    );

    if (appRes.rows.length === 0) {
      console.error('No application found with id:', appId);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query(
      `
        INSERT INTO application_api_keys (application_id, key_hash, label)
        VALUES ($1, $2, $3)
      `,
      [appId, keyHash, label]
    );

    await client.query('COMMIT');

    console.log('✅ API key created successfully');
    console.log('Application:', appRes.rows[0].name);
    console.log('Label      :', label);
    console.log('==============================================');
    console.log(' RAW API KEY (store this in your .env file):');
    console.log('');
    console.log(`  ${rawKey}`);
    console.log('');
    console.log(
      'This value will NOT be shown again. Only the hash is stored in DB.'
    );
    console.log('==============================================');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to create API key:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unexpected error in create-api-key script:', err);
  process.exit(1);
});
