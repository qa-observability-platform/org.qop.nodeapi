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
 * Generate a new random API key (64 chars hex).
 * Example output: "qop_a1b2c3d4..." style token.
 * Matches the format used by the UI (projectApiKeys.repository).
 */
export function generateApiKey(): string {
  const random = crypto.randomBytes(32).toString('hex'); // 64 chars
  return `qop_${random}`;
}
