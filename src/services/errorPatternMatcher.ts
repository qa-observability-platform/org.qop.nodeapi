/**
 * Error Pattern Matcher Service
 *
 * Extracts error signatures from test failures and finds matching patterns
 * in the database for intelligent caching and pattern learning.
 *
 * Key Features:
 * - Normalizes error messages (removes timestamps, numbers, dynamic values)
 * - Generates pattern fingerprints (SHA256 hashes)
 * - Classifies error types (timeout, selector_not_found, assertion_failed, etc.)
 * - Similarity matching using PostgreSQL pg_trgm
 *
 * @author QOP Team
 * @date 2025-01-27
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/**
 * Error signature extracted from test execution
 */
export interface ErrorSignature {
  pattern_hash: string;
  pattern_type: string;
  error_message_pattern: string;
  error_type: string;
  stack_trace_signature: string;
  test_context: {
    runner_type?: string;
    is_timeout?: boolean;
    test_framework?: string;
  };
}

/**
 * Pattern match result with confidence score
 */
export interface PatternMatch {
  match: any | null;  // Pattern record from database
  confidence: number; // 0-100
}

/**
 * Test execution data for pattern extraction
 */
export interface TestExecutionData {
  error_message: string;
  error_stack?: string;
  runner_type: string;
  duration_ms?: number;
  test_key: string;
  application_id: string;
}

export class ErrorPatternMatcher {
  /**
   * Extract error signature from test execution
   * Returns normalized pattern for matching and storage
   */
  async extractErrorSignature(execution: TestExecutionData): Promise<ErrorSignature> {
    const {
      error_message,
      error_stack,
      runner_type,
      duration_ms,
      test_key
    } = execution;

    // 1. Normalize error message (remove dynamic values)
    const normalizedMessage = this.normalizeErrorMessage(error_message);

    // 2. Extract error type from message or stack
    const errorType = this.extractErrorType(error_message, error_stack);

    // 3. Normalize stack trace (keep file paths, remove line numbers)
    const stackSignature = this.normalizeStackTrace(error_stack);

    // 4. Classify error pattern type
    const patternType = this.classifyErrorType(error_message, errorType);

    // 5. Extract test context
    const context = {
      runner_type,
      is_timeout: duration_ms !== undefined && duration_ms > 30000,
      test_framework: this.detectFramework(test_key),
    };

    // 6. Generate pattern hash (for deduplication)
    const patternHash = this.generateHash({
      normalizedMessage,
      errorType,
      stackSignature,
      patternType
    });

    return {
      pattern_hash: patternHash,
      pattern_type: patternType,
      error_message_pattern: normalizedMessage,
      error_type: errorType,
      stack_trace_signature: stackSignature,
      test_context: context
    };
  }

  /**
   * Normalize error message by removing dynamic values
   *
   * Examples:
   * "Timeout after 5000ms" → "Timeout after <NUM>ms"
   * "Error at file.ts:42:10" → "Error at file.ts:<LINE>:<COL>"
   * "2024-01-15T14:30:22 Failed" → "<TIMESTAMP> Failed"
   */
  normalizeErrorMessage(errorMessage: string): string {
    if (!errorMessage) return '';

    return errorMessage
      // Remove timestamps: "2024-01-15 14:30:22" or "2024-01-15T14:30:22"
      .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d{3})?([Z]|[+-]\d{2}:\d{2})?/g, '<TIMESTAMP>')

      // Remove standalone numbers: "Timeout after 5000ms" → "Timeout after <NUM>ms"
      .replace(/\b\d+\b/g, '<NUM>')

      // Remove floating point numbers: "Expected 3.14" → "Expected <NUM>"
      .replace(/\b\d+\.\d+\b/g, '<NUM>')

      // Remove UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')

      // Remove file paths with line/column numbers: "file.js:42:10" → "file.js:<LINE>:<COL>"
      .replace(/:(\d+):(\d+)/g, ':<LINE>:<COL>')

      // Remove line numbers only: "file.js:42" → "file.js:<LINE>"
      .replace(/:(\d+)\b/g, ':<LINE>')

      // Remove URLs (preserve protocol for pattern)
      .replace(/https?:\/\/[^\s]+/g, '<URL>')

      // Remove hex addresses: "0x7f8b4c0" → "<ADDR>"
      .replace(/0x[0-9a-f]+/gi, '<ADDR>')

      // Remove specific selectors but keep type
      .replace(/#[\w-]+/g, '#<ID>')  // ID selectors
      .replace(/\.[\w-]+/g, '.<CLASS>')  // Class selectors
      .replace(/\[[\w-]+=["']?[^"'\]]+["']?\]/g, '[<ATTR>]')  // Attribute selectors

      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize stack trace
   * Keep file structure but remove specific line numbers
   */
  normalizeStackTrace(stackTrace?: string): string {
    if (!stackTrace) return '';

    const lines = stackTrace.split('\n').slice(0, 5); // First 5 lines only

    return lines
      .map(line => line
        // Remove line:column numbers
        .replace(/:\d+:\d+/g, ':<LINE>:<COL>')

        // Remove just line numbers
        .replace(/:(\d+)\b/g, ':<LINE>')

        // Remove timing info
        .replace(/\d+ms/g, '<TIME>ms')

        // Normalize file paths (keep structure, remove absolute paths)
        .replace(/\((.+?)\)/g, '(<PATH>)')

        // Remove hex addresses
        .replace(/0x[0-9a-f]+/gi, '<ADDR>')
      )
      .join('\n');
  }

  /**
   * Extract error type from message or stack trace
   */
  extractErrorType(errorMessage: string, errorStack?: string): string {
    const msg = errorMessage.toLowerCase();
    const stack = (errorStack || '').toLowerCase();

    // Common error types
    const errorTypes: Record<string, string[]> = {
      'TimeoutError': ['timeout', 'timed out'],
      'AssertionError': ['expected', 'assertion', 'assert'],
      'ElementNotFoundError': ['element not found', 'no such element', 'could not find element'],
      'NetworkError': ['network', 'econnrefused', 'enotfound', 'fetch failed'],
      'NullReferenceError': ['cannot read property', 'null', 'undefined is not'],
      'SelectorError': ['selector', 'invalid selector', 'css selector'],
      'NavigationError': ['navigation', 'page crashed', 'target closed']
    };

    for (const [errorType, keywords] of Object.entries(errorTypes)) {
      if (keywords.some(kw => msg.includes(kw) || stack.includes(kw))) {
        return errorType;
      }
    }

    // Try to extract from stack trace (e.g., "at TimeoutError: ...")
    const stackMatch = stack.match(/at\s+(\w+Error):/);
    if (stackMatch) {
      return stackMatch[1];
    }

    return 'UnknownError';
  }

  /**
   * Classify error into pattern type for categorization
   */
  classifyErrorType(errorMessage: string, errorType: string): string {
    const msg = errorMessage.toLowerCase();

    // Timeout-related
    if (msg.includes('timeout') || msg.includes('timed out') || errorType === 'TimeoutError') {
      return 'timeout';
    }

    // Selector-related
    if (msg.includes('selector') || msg.includes('element not found') || msg.includes('no such element')) {
      return 'selector_not_found';
    }

    // Assertion failures
    if (msg.includes('expected') && msg.includes('received')) {
      return 'assertion_failed';
    }
    if (msg.includes('assertion') || errorType === 'AssertionError') {
      return 'assertion_failed';
    }

    // Network errors
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed')) {
      return 'network_error';
    }

    // Null reference errors
    if (msg.includes('null') || msg.includes('undefined') || errorType === 'NullReferenceError') {
      return 'null_reference';
    }

    // Navigation errors
    if (msg.includes('navigation') || msg.includes('page crashed') || msg.includes('target closed')) {
      return 'navigation_error';
    }

    return 'unknown';
  }

  /**
   * Detect test framework from test key
   */
  detectFramework(testKey: string): string {
    if (testKey.includes('.cy.')) return 'cypress';
    if (testKey.includes('.spec.')) return 'jest/mocha';
    if (testKey.includes('.test.')) return 'jest';
    if (testKey.includes('Test.java')) return 'testng/junit';
    return 'unknown';
  }

  /**
   * Generate SHA256 hash for pattern fingerprint
   */
  generateHash(data: {
    normalizedMessage: string;
    errorType: string;
    stackSignature: string;
    patternType: string;
  }): string {
    const content = JSON.stringify({
      message: data.normalizedMessage,
      type: data.errorType,
      stack: data.stackSignature,
      pattern: data.patternType
    });

    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  }

  /**
   * Find matching pattern in database using similarity
   *
   * @param signature - Error signature to match
   * @param applicationId - Application ID for scoping
   * @returns Pattern match with confidence score (0-100)
   */
  async findMatchingPattern(
    signature: ErrorSignature,
    applicationId: string
  ): Promise<PatternMatch> {
    try {
      // 1. Exact hash match (fastest, 100% confidence)
      const exactMatch = await pool.query(
        `
        SELECT * FROM error_pattern_signatures
        WHERE application_id = $1 AND pattern_hash = $2
        `,
        [applicationId, signature.pattern_hash]
      );

      if (exactMatch.rows.length > 0) {
        logger.debug('Pattern exact match found', {
          pattern_hash: signature.pattern_hash,
          pattern_type: exactMatch.rows[0].pattern_type
        });

        return {
          match: exactMatch.rows[0],
          confidence: 100
        };
      }

      // 2. Type + similarity match (slower but more flexible, using pg_trgm)
      const similarPatterns = await pool.query(
        `
        SELECT
          *,
          similarity(error_message_pattern, $2) as sim_score
        FROM error_pattern_signatures
        WHERE application_id = $1
          AND pattern_type = $3
          AND similarity(error_message_pattern, $2) > 0.7
        ORDER BY sim_score DESC
        LIMIT 1
        `,
        [applicationId, signature.error_message_pattern, signature.pattern_type]
      );

      if (similarPatterns.rows.length > 0) {
        const match = similarPatterns.rows[0];
        const confidence = Math.round(match.sim_score * 100);

        logger.debug('Pattern similarity match found', {
          pattern_hash: match.pattern_hash,
          pattern_type: match.pattern_type,
          similarity: confidence
        });

        return {
          match,
          confidence
        };
      }

      // 3. No match found
      logger.debug('No matching pattern found', {
        pattern_type: signature.pattern_type,
        application_id: applicationId
      });

      return {
        match: null,
        confidence: 0
      };
    } catch (error) {
      logger.error('Error finding matching pattern', {
        error: error instanceof Error ? error.message : 'Unknown error',
        signature: signature.pattern_hash
      });

      return {
        match: null,
        confidence: 0
      };
    }
  }

  /**
   * Save or update pattern signature in database
   *
   * @param signature - Error signature to save
   * @param applicationId - Application ID
   * @param category - AI-determined category (optional)
   * @param severity - AI-determined severity (optional)
   * @returns Pattern ID
   */
  async savePatternSignature(
    signature: ErrorSignature,
    applicationId: string,
    category?: string,
    severity?: string
  ): Promise<string> {
    try {
      const result = await pool.query(
        `
        INSERT INTO error_pattern_signatures (
          application_id, pattern_hash, pattern_type,
          error_message_pattern, error_type, stack_trace_signature,
          test_context, category, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (application_id, pattern_hash)
        DO UPDATE SET
          occurrence_count = error_pattern_signatures.occurrence_count + 1,
          last_seen_at = NOW(),
          category = COALESCE(EXCLUDED.category, error_pattern_signatures.category),
          severity = COALESCE(EXCLUDED.severity, error_pattern_signatures.severity),
          updated_at = NOW()
        RETURNING id
        `,
        [
          applicationId,
          signature.pattern_hash,
          signature.pattern_type,
          signature.error_message_pattern,
          signature.error_type,
          signature.stack_trace_signature,
          JSON.stringify(signature.test_context),
          category || null,
          severity || null
        ]
      );

      const patternId = result.rows[0].id;

      logger.debug('Pattern signature saved', {
        pattern_id: patternId,
        pattern_type: signature.pattern_type,
        pattern_hash: signature.pattern_hash
      });

      return patternId;
    } catch (error) {
      logger.error('Error saving pattern signature', {
        error: error instanceof Error ? error.message : 'Unknown error',
        signature: signature.pattern_hash
      });
      throw error;
    }
  }
}

// Singleton instance
export const errorPatternMatcher = new ErrorPatternMatcher();
