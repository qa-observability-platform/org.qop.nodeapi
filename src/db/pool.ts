// src/db/pool.ts
import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.dbUrl,
});

// Log unexpected idle client errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Simple DB ping to be used by readiness endpoint.
 * Throws if DB is not reachable.
 */
export async function dbPing(): Promise<void> {
  await pool.query('SELECT 1');
}
