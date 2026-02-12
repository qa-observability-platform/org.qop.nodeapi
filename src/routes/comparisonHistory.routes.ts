/**
 * Comparison History Routes
 *
 * Manages comparison history tracking, bookmarking, and revisiting.
 * Allows users to:
 * - Save comparisons for future reference
 * - Check if a comparison already exists
 * - Bookmark important comparisons
 * - Add notes and tags
 * - Track views and access history
 *
 * @author QOP Team
 * @date 2024-12-27
 */

import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/comparison-history
 * Save a new comparison to history
 *
 * Body: {
 *   currentRunId: UUID,
 *   compareRunId: UUID,
 *   applicationId: UUID,
 *   comparisonName?: string,
 *   comparisonResult: object,
 *   riskScoreData?: object,
 *   createdBy?: UUID
 * }
 */
router.post('/', async (req, res) => {
  try {
    const {
      currentRunId,
      compareRunId,
      applicationId,
      comparisonName,
      comparisonResult,
      riskScoreData,
      createdBy
    } = req.body;

    // Validate required fields
    if (!currentRunId || !compareRunId || !applicationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: currentRunId, compareRunId, applicationId'
      });
    }

    // Check if comparison already exists
    const existingCheck = await pool.query(
      `SELECT id FROM comparison_history
       WHERE current_run_id = $1 AND compare_run_id = $2`,
      [currentRunId, compareRunId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Comparison already exists',
        comparisonId: existingCheck.rows[0].id
      });
    }

    // Insert new comparison
    const result = await pool.query(
      `INSERT INTO comparison_history (
        current_run_id,
        compare_run_id,
        application_id,
        comparison_name,
        comparison_result,
        risk_score_data,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at`,
      [
        currentRunId,
        compareRunId,
        applicationId,
        comparisonName || null,
        JSON.stringify(comparisonResult),
        riskScoreData ? JSON.stringify(riskScoreData) : null,
        createdBy || null
      ]
    );

    logger.info('Comparison saved to history', {
      comparisonId: result.rows[0].id,
      currentRunId,
      compareRunId
    });

    res.status(201).json({
      success: true,
      comparisonId: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      message: 'Comparison saved successfully'
    });
  } catch (error) {
    logger.error('Error saving comparison history', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to save comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/comparison-history/check/:currentRunId/:compareRunId
 * Check if a comparison already exists
 */
router.get('/check/:currentRunId/:compareRunId', async (req, res) => {
  try {
    const { currentRunId, compareRunId } = req.params;

    const result = await pool.query(
      `SELECT
        id,
        comparison_name,
        is_bookmarked,
        created_at,
        view_count,
        risk_score_data
      FROM comparison_history
      WHERE current_run_id = $1 AND compare_run_id = $2`,
      [currentRunId, compareRunId]
    );

    if (result.rows.length === 0) {
      return res.json({
        exists: false,
        comparison: null
      });
    }

    res.json({
      exists: true,
      comparison: {
        id: result.rows[0].id,
        name: result.rows[0].comparison_name,
        isBookmarked: result.rows[0].is_bookmarked,
        createdAt: result.rows[0].created_at,
        viewCount: result.rows[0].view_count,
        riskScore: result.rows[0].risk_score_data
      }
    });
  } catch (error) {
    logger.error('Error checking comparison existence', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to check comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/comparison-history/:applicationId
 * Get all comparison history for an application
 *
 * Query params:
 * - bookmarked: true/false (filter by bookmarked status)
 * - limit: number (default 50)
 */
router.get('/:applicationId', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { bookmarked, limit = 50 } = req.query;

    let query = `
      SELECT
        ch.id,
        ch.current_run_id,
        ch.compare_run_id,
        ch.comparison_name,
        ch.is_bookmarked,
        ch.notes,
        ch.risk_score_data,
        ch.created_at,
        ch.updated_at,
        ch.last_viewed_at,
        ch.view_count,
        tr_current.run_id as current_run_number,
        tr_current.job_number as current_job_number,
        tr_current.branch as current_branch,
        tr_compare.run_id as compare_run_number,
        tr_compare.job_number as compare_job_number,
        tr_compare.branch as compare_branch,
        array_agg(DISTINCT ct.name) FILTER (WHERE ct.name IS NOT NULL) as tags
      FROM comparison_history ch
      LEFT JOIN test_runs tr_current ON ch.current_run_id = tr_current.id
      LEFT JOIN test_runs tr_compare ON ch.compare_run_id = tr_compare.id
      LEFT JOIN comparison_history_tags cht ON ch.id = cht.comparison_id
      LEFT JOIN comparison_tags ct ON cht.tag_id = ct.id
      WHERE ch.application_id = $1
    `;

    const params: any[] = [applicationId];
    let paramIndex = 2;

    if (bookmarked === 'true') {
      query += ` AND ch.is_bookmarked = true`;
    }

    query += `
      GROUP BY ch.id, tr_current.run_id, tr_current.job_number, tr_current.branch,
               tr_compare.run_id, tr_compare.job_number, tr_compare.branch
      ORDER BY ch.created_at DESC
      LIMIT $${paramIndex}
    `;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      comparisons: result.rows.map(row => ({
        id: row.id,
        currentRun: {
          id: row.current_run_id,
          runNumber: row.current_run_number,
          jobNumber: row.current_job_number,
          branch: row.current_branch
        },
        compareRun: {
          id: row.compare_run_id,
          runNumber: row.compare_run_number,
          jobNumber: row.compare_job_number,
          branch: row.compare_branch
        },
        name: row.comparison_name,
        isBookmarked: row.is_bookmarked,
        notes: row.notes,
        riskScore: row.risk_score_data,
        tags: row.tags || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastViewedAt: row.last_viewed_at,
        viewCount: row.view_count
      }))
    });
  } catch (error) {
    logger.error('Error fetching comparison history', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comparison history',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/comparison-history/detail/:id
 * Get full comparison details including cached result
 */
router.get('/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
        ch.*,
        tr_current.run_id as current_run_number,
        tr_compare.run_id as compare_run_number,
        array_agg(DISTINCT jsonb_build_object(
          'name', ct.name,
          'color', ct.color,
          'description', ct.description
        )) FILTER (WHERE ct.name IS NOT NULL) as tags
      FROM comparison_history ch
      LEFT JOIN test_runs tr_current ON ch.current_run_id = tr_current.id
      LEFT JOIN test_runs tr_compare ON ch.compare_run_id = tr_compare.id
      LEFT JOIN comparison_history_tags cht ON ch.id = cht.comparison_id
      LEFT JOIN comparison_tags ct ON cht.tag_id = ct.id
      WHERE ch.id = $1
      GROUP BY ch.id, tr_current.run_id, tr_compare.run_id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Comparison not found'
      });
    }

    // Increment view count
    await pool.query(
      `SELECT increment_comparison_view_count($1)`,
      [id]
    );

    const comparison = result.rows[0];

    res.json({
      success: true,
      comparison: {
        id: comparison.id,
        currentRunId: comparison.current_run_id,
        compareRunId: comparison.compare_run_id,
        applicationId: comparison.application_id,
        name: comparison.comparison_name,
        isBookmarked: comparison.is_bookmarked,
        notes: comparison.notes,
        comparisonResult: comparison.comparison_result,
        riskScore: comparison.risk_score_data,
        tags: comparison.tags || [],
        createdAt: comparison.created_at,
        updatedAt: comparison.updated_at,
        lastViewedAt: comparison.last_viewed_at,
        viewCount: comparison.view_count + 1, // Include the current view
        currentRunNumber: comparison.current_run_number,
        compareRunNumber: comparison.compare_run_number
      }
    });
  } catch (error) {
    logger.error('Error fetching comparison detail', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comparison detail',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/comparison-history/:id
 * Update comparison (name, bookmark, notes, tags)
 *
 * Body: {
 *   comparisonName?: string,
 *   isBookmarked?: boolean,
 *   notes?: string,
 *   tags?: string[] (tag names to add/update)
 * }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { comparisonName, isBookmarked, notes, tags } = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (comparisonName !== undefined) {
      updates.push(`comparison_name = $${paramIndex++}`);
      params.push(comparisonName);
    }

    if (isBookmarked !== undefined) {
      updates.push(`is_bookmarked = $${paramIndex++}`);
      params.push(isBookmarked);
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes);
    }

    if (updates.length === 0 && !tags) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    // Update comparison if there are field changes
    if (updates.length > 0) {
      params.push(id);
      const query = `
        UPDATE comparison_history
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, updated_at
      `;

      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Comparison not found'
        });
      }
    }

    // Update tags if provided
    if (tags && Array.isArray(tags)) {
      // Remove existing tags
      await pool.query(
        `DELETE FROM comparison_history_tags WHERE comparison_id = $1`,
        [id]
      );

      // Add new tags
      for (const tagName of tags) {
        // Get or create tag
        const tagResult = await pool.query(
          `INSERT INTO comparison_tags (name)
           VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tagName]
        );

        const tagId = tagResult.rows[0].id;

        // Link tag to comparison
        await pool.query(
          `INSERT INTO comparison_history_tags (comparison_id, tag_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, tagId]
        );
      }
    }

    logger.info('Comparison updated', { comparisonId: id });

    res.json({
      success: true,
      message: 'Comparison updated successfully'
    });
  } catch (error) {
    logger.error('Error updating comparison', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/comparison-history/:id
 * Delete a comparison from history
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM comparison_history WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Comparison not found'
      });
    }

    logger.info('Comparison deleted', { comparisonId: id });

    res.json({
      success: true,
      message: 'Comparison deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting comparison', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/comparison-history/tags/list
 * Get all available tags
 */
router.get('/tags/list', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, color, description, created_at
       FROM comparison_tags
       ORDER BY name ASC`
    );

    res.json({
      success: true,
      tags: result.rows
    });
  } catch (error) {
    logger.error('Error fetching tags', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tags',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
