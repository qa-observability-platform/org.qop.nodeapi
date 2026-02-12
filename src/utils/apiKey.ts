// src/utils/apiKey.ts
import crypto from 'crypto';

/**
 * Hash an API key using SHA-256, return hex string.
 * We only store the hash in DB, never the raw key.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Generate a new random API key (48 chars hex).
 * Example output: "qop_pk_..." style token.
 */
export function generateApiKey(): string {
  const random = crypto.randomBytes(24).toString('hex'); // 48 chars
  return `qop_pk_${random}`;
}
