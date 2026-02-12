// src/scripts/seed-demo-app.ts
/**
 * Script to seed the database with demo organization, application, and API key.
 *
 * Usage:
 *   npm run seed:demo
 */

import { pool } from '../db/pool.js';
import { hashApiKey } from '../utils/apiKey.js';

async function main() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Get or create demo organization (use existing QOP Demo Org)
    const orgResult = await client.query(
      `SELECT id FROM organizations LIMIT 1`
    );

    let orgId: string;
    if (orgResult.rows.length > 0) {
      orgId = orgResult.rows[0].id;
      console.log('ℹ️  Using existing organization:', orgId);
    } else {
      // Create if no orgs exist
      const newOrg = await client.query(
        `INSERT INTO organizations (name) VALUES ('QOP Demo Org') RETURNING id`
      );
      orgId = newOrg.rows[0].id;
      console.log('✅ Created organization:', orgId);
    }

    // 2. Create default project
    const projectResult = await client.query(
      `
      INSERT INTO projects (org_id, project_key, name, description)
      VALUES ($1, 'default-project', 'Default Project', 'Default project for demo applications')
      ON CONFLICT (org_id, project_key) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
      [orgId]
    );

    const projectId = projectResult.rows[0].id;
    console.log('✅ Created/Updated project:', projectId, '(project_key: default-project)');

    // 3. Create demo application
    const appResult = await client.query(
      `
      INSERT INTO applications (org_id, project_id, name, app_key, runner_type)
      VALUES ($1, $2, 'Demo Application', 'qop-demo-app', 'selenium')
      ON CONFLICT (project_id, app_key) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
      [orgId, projectId]
    );

    const appId = appResult.rows[0].id;
    console.log('✅ Created/Updated application:', appId, '(app_key: qop-demo-app)');

    // 4. Create API key with the exact key from Selenium .env
    const rawApiKey = 'qop_pk_c66899c9b9656b79e1eaf3cc8f308b6deb90bfb85d36ffee';
    const keyHash = hashApiKey(rawApiKey);

    // Check if API key already exists in project_api_keys
    const existingKey = await client.query(
      `SELECT id FROM project_api_keys WHERE project_id = $1 AND label = 'selenium-demo'`,
      [projectId]
    );

    if (existingKey.rows.length === 0) {
      await client.query(
        `
        INSERT INTO project_api_keys (project_id, key_hash, label)
        VALUES ($1, $2, 'selenium-demo')
        `,
        [projectId, keyHash]
      );
      console.log('✅ Created API key for project');
    } else {
      // Update the hash in case it changed
      await client.query(
        `
        UPDATE project_api_keys
        SET key_hash = $2
        WHERE project_id = $1 AND label = 'selenium-demo'
        `,
        [projectId, keyHash]
      );
      console.log('ℹ️  API key already exists, updated hash');
    }

    await client.query('COMMIT');

    console.log('');
    console.log('==============================================');
    console.log('✅ Database seeded successfully!');
    console.log('==============================================');
    console.log('');
    console.log('Application Details:');
    console.log('  Organization: Demo Organization');
    console.log('  Application:  Demo Application');
    console.log('  App Key:      qop-demo-app');
    console.log('  API Key:      qop_pk_c66899c9b9656b79e1eaf3cc8f308b6deb90bfb85d36ffee');
    console.log('');
    console.log('These values are already in your Selenium .env file.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Start the backend:   npm run dev');
    console.log('  2. Start the frontend:  cd ../com.qop.web && npm run dev');
    console.log('  3. Run Selenium tests:  cd ../com.qop.selenium && mvn clean test');
    console.log('==============================================');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed database:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unexpected error in seed script:', err);
  process.exit(1);
});
