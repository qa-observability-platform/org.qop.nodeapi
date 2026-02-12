// src/routes/users.routes.ts
/**
 * User Settings Routes
 *
 * Purpose: Handle user preferences and settings
 * Endpoints:
 * - GET /users/me/preferences - Get user preferences
 * - PUT /users/me/preferences - Update user preferences
 */

import type { Express } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.middleware.js';

export function registerUsersRoutes(app: Express) {
  /**
   * Get User Preferences
   */
  app.get('/users/me/preferences', authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const result = await pool.query<{
        theme: 'dark' | 'light' | 'system';
        date_format: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
        time_format: '12h' | '24h';
        default_time_range: '7d' | '30d' | '90d';
        timezone: string;
      }>(
        `
          SELECT
            theme,
            date_format,
            time_format,
            default_time_range,
            timezone
          FROM user_preferences
          WHERE user_id = $1
        `,
        [req.user.userId]
      );

      // Return default preferences if none exist
      if (result.rows.length === 0) {
        const defaultPreferences = {
          theme: 'dark' as const,
          dateFormat: 'MM/DD/YYYY' as const,
          timeFormat: '12h' as const,
          defaultTimeRange: '7d' as const,
          timezone: 'America/New_York',
        };

        res.json({ preferences: defaultPreferences });
        return;
      }

      const row = result.rows[0];
      const preferences = {
        theme: row.theme,
        dateFormat: row.date_format,
        timeFormat: row.time_format,
        defaultTimeRange: row.default_time_range,
        timezone: row.timezone,
      };

      res.json({ preferences });
    } catch (error) {
      console.error('[Users] Get preferences failed:', error);
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  });

  /**
   * Update User Preferences
   */
  app.put('/users/me/preferences', authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { theme, dateFormat, timeFormat, defaultTimeRange, timezone } = req.body;

      // Validate theme
      if (theme && !['dark', 'light', 'system'].includes(theme)) {
        return res.status(400).json({ error: 'Invalid theme value' });
      }

      // Validate dateFormat
      if (dateFormat && !['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].includes(dateFormat)) {
        return res.status(400).json({ error: 'Invalid dateFormat value' });
      }

      // Validate timeFormat
      if (timeFormat && !['12h', '24h'].includes(timeFormat)) {
        return res.status(400).json({ error: 'Invalid timeFormat value' });
      }

      // Validate defaultTimeRange
      if (defaultTimeRange && !['7d', '30d', '90d'].includes(defaultTimeRange)) {
        return res.status(400).json({ error: 'Invalid defaultTimeRange value' });
      }

      // Check if preferences exist
      const existingResult = await pool.query(
        'SELECT user_id FROM user_preferences WHERE user_id = $1',
        [req.user.userId]
      );

      if (existingResult.rows.length === 0) {
        // Insert new preferences
        await pool.query(
          `
            INSERT INTO user_preferences (
              user_id,
              theme,
              date_format,
              time_format,
              default_time_range,
              timezone,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          `,
          [
            req.user.userId,
            theme || 'dark',
            dateFormat || 'MM/DD/YYYY',
            timeFormat || '12h',
            defaultTimeRange || '7d',
            timezone || 'America/New_York',
          ]
        );
      } else {
        // Update existing preferences
        await pool.query(
          `
            UPDATE user_preferences
            SET theme = COALESCE($1, theme),
                date_format = COALESCE($2, date_format),
                time_format = COALESCE($3, time_format),
                default_time_range = COALESCE($4, default_time_range),
                timezone = COALESCE($5, timezone),
                updated_at = NOW()
            WHERE user_id = $6
          `,
          [
            theme || null,
            dateFormat || null,
            timeFormat || null,
            defaultTimeRange || null,
            timezone || null,
            req.user.userId,
          ]
        );
      }

      res.json({ message: 'Preferences updated successfully' });
    } catch (error) {
      console.error('[Users] Update preferences failed:', error);
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });
}
