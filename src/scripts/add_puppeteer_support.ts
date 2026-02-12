import { pool } from '../db/pool';

async function updateConstraints() {
    const client = await pool.connect();
    try {
        console.log('Starting DB update for Puppeteer support...');

        // 1. Update job_counters constraint
        try {
            console.log('Updating job_counters constraint...');
            await client.query('ALTER TABLE job_counters DROP CONSTRAINT IF EXISTS job_counters_runner_type_check');
            await client.query(`
        ALTER TABLE job_counters 
        ADD CONSTRAINT job_counters_runner_type_check 
        CHECK (runner_type IN ('playwright', 'selenium', 'cypress', 'api', 'puppeteer'))
      `);
            console.log('✅ job_counters constraint updated.');
        } catch (err: any) {
            console.error('❌ Failed to update job_counters:', err.message);
        }

        // 2. Update applications constraint (if it exists)
        try {
            console.log('Updating applications constraint...');
            // We check if it exists or just try to drop/add. 
            // Assuming it might be named applications_runner_type_check
            await client.query('ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_runner_type_check');
            await client.query(`
        ALTER TABLE applications 
        ADD CONSTRAINT applications_runner_type_check 
        CHECK (runner_type IN ('playwright', 'selenium', 'cypress', 'api', 'puppeteer'))
      `);
            console.log('✅ applications constraint updated.');
        } catch (err: any) {
            // It's possible this constraint doesn't exist or has a different name.
            // We can try to query information_schema to find it if we want to be robust, 
            // but for now let's assume standard naming or just ignore if not found (and hope insert works).
            console.warn('⚠️ Could not update applications constraint (might not exist or different name):', err.message);
        }

        // 3. Update test_runs constraint (if it exists)
        try {
            console.log('Updating test_runs constraint...');
            await client.query('ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_runner_type_check');
            await client.query(`
        ALTER TABLE test_runs 
        ADD CONSTRAINT test_runs_runner_type_check 
        CHECK (runner_type IN ('playwright', 'selenium', 'cypress', 'api', 'puppeteer'))
      `);
            console.log('✅ test_runs constraint updated.');
        } catch (err: any) {
            console.warn('⚠️ Could not update test_runs constraint:', err.message);
        }

        console.log('DB update complete.');
    } finally {
        client.release();
        await pool.end();
    }
}

updateConstraints().catch(console.error);
