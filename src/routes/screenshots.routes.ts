import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db/pool.js';
import { automationAuth } from '../middleware/automationAuth.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'screenshots');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads with organized directory structure
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Get execution metadata to build organized path
      const executionId = req.body.test_case_execution_id;
      if (!executionId) {
        return cb(null, UPLOAD_DIR); // Fallback to flat structure
      }

      // Query for application, run, and runner type
      const result = await pool.query(
        `SELECT
          apps.app_key,
          tr.run_id,
          tr.runner_type
         FROM test_case_executions tce
         JOIN test_runs tr ON tr.id = tce.test_run_id
         JOIN applications apps ON apps.id = tr.application_id
         WHERE tce.id = $1`,
        [executionId]
      );

      if (result.rows.length > 0) {
        const { app_key, run_id, runner_type } = result.rows[0];
        // Create organized directory: uploads/screenshots/{app_key}/{run_id}/{runner_type}
        const organizedDir = path.join(UPLOAD_DIR, app_key, run_id, runner_type || 'unknown');

        if (!fs.existsSync(organizedDir)) {
          fs.mkdirSync(organizedDir, { recursive: true });
        }

        cb(null, organizedDir);
      } else {
        cb(null, UPLOAD_DIR); // Fallback
      }
    } catch (error) {
      logger.error('Error creating organized screenshot directory', { error });
      cb(null, UPLOAD_DIR); // Fallback to flat structure
    }
  },
  filename: (req, file, cb) => {
    // Use original filename if provided, otherwise generate unique name
    const filename = file.originalname || `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPEG, and WebP are allowed.'));
    }
  }
});

/**
 * POST /api/screenshots/upload
 * Upload a screenshot for a test execution
 * Query param: store_in_db=true to store in database instead of file system
 * Note: No auth middleware - validation via test_case_execution_id existence
 */
router.post('/upload', upload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const { test_case_execution_id, screenshot_type = 'failure' } = req.body;
    const storeInDb = req.query.store_in_db === 'true';
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!test_case_execution_id) {
      // Clean up uploaded file
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'test_case_execution_id is required' });
    }

    // Verify test execution exists
    const executionCheck = await pool.query(
      'SELECT id FROM test_case_executions WHERE id = $1',
      [test_case_execution_id]
    );

    if (executionCheck.rows.length === 0) {
      // Clean up uploaded file
      fs.unlinkSync(file.path);
      return res.status(404).json({ error: 'Test execution not found' });
    }

    let result;

    if (storeInDb) {
      // Store binary data in database
      const imageBuffer = fs.readFileSync(file.path);

      result = await pool.query(
        `INSERT INTO screenshots
         (test_case_execution_id, file_name, image_data, mime_type, file_size, screenshot_type, storage_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, test_case_execution_id, file_name, mime_type, file_size, screenshot_type, storage_type, created_at`,
        [
          test_case_execution_id,
          file.originalname,
          imageBuffer,
          file.mimetype,
          file.size,
          screenshot_type,
          'database'
        ]
      );

      // Clean up the temporary file
      fs.unlinkSync(file.path);

      logger.info('Screenshot uploaded to database', {
        id: result.rows[0].id,
        execution_id: test_case_execution_id,
        file_name: file.originalname,
        size: file.size
      });
    } else {
      // Store file path in database (original behavior)
      const relativePath = path.relative(process.cwd(), file.path);
      result = await pool.query(
        `INSERT INTO screenshots
         (test_case_execution_id, file_name, file_path, mime_type, file_size, screenshot_type, storage_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          test_case_execution_id,
          file.originalname,
          relativePath,
          file.mimetype,
          file.size,
          screenshot_type,
          'local'
        ]
      );

      logger.info('Screenshot uploaded to file system', {
        id: result.rows[0].id,
        execution_id: test_case_execution_id,
        file_name: file.originalname
      });
    }

    res.status(201).json({
      success: true,
      screenshot: result.rows[0]
    });
  } catch (error: any) {
    logger.error('Error uploading screenshot', { error: error.message });
    res.status(500).json({ error: 'Failed to upload screenshot' });
  }
});

/**
 * POST /api/screenshots/upload-by-run
 * Upload a screenshot using run_id + test_key instead of test_case_execution_id.
 * Used by pytest/selenium reporters that don't have the execution ID.
 */
router.post('/upload-by-run', upload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const { run_id, test_key, screenshot_type = 'failure' } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!run_id || !test_key) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'run_id and test_key are required' });
    }

    // Look up the test_case_execution_id from run_id + test_key
    const executionResult = await pool.query(
      `SELECT tce.id
       FROM test_case_executions tce
       JOIN test_runs tr ON tr.id = tce.test_run_id
       JOIN test_case_master tcm ON tcm.id = tce.test_case_id
       WHERE tr.run_id = $1 AND tcm.test_key = $2
       ORDER BY tce.id DESC
       LIMIT 1`,
      [run_id, test_key]
    );

    if (executionResult.rows.length === 0) {
      fs.unlinkSync(file.path);
      return res.status(404).json({ error: 'Test execution not found for given run_id and test_key' });
    }

    const test_case_execution_id = executionResult.rows[0].id;
    const relativePath = path.relative(process.cwd(), file.path);

    const result = await pool.query(
      `INSERT INTO screenshots
       (test_case_execution_id, file_name, file_path, mime_type, file_size, screenshot_type, storage_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        test_case_execution_id,
        file.originalname,
        relativePath,
        file.mimetype,
        file.size,
        screenshot_type,
        'local'
      ]
    );

    logger.info('Screenshot uploaded via run key', {
      id: result.rows[0].id,
      run_id,
      test_key,
      execution_id: test_case_execution_id,
    });

    res.status(201).json({ success: true, screenshot: result.rows[0] });
  } catch (error: any) {
    logger.error('Error uploading screenshot by run key', { error: error.message });
    res.status(500).json({ error: 'Failed to upload screenshot' });
  }
});

/**
 * GET /api/screenshots/:id
 * Get screenshot file by ID (from file system or database)
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM screenshots WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    const screenshot = result.rows[0];

    // Set appropriate headers
    res.setHeader('Content-Type', screenshot.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    if (screenshot.storage_type === 'database') {
      // Serve from database
      if (!screenshot.image_data) {
        logger.error('Screenshot marked as database storage but no image data found', { id });
        return res.status(404).json({ error: 'Screenshot data not found' });
      }

      res.setHeader('Content-Length', screenshot.file_size);
      res.send(screenshot.image_data);
    } else {
      // Serve from file system
      const filePath = path.join(process.cwd(), screenshot.file_path);

      if (!fs.existsSync(filePath)) {
        logger.error('Screenshot file not found on disk', { id, file_path: filePath });
        return res.status(404).json({ error: 'Screenshot file not found' });
      }

      res.setHeader('Content-Length', screenshot.file_size);

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (error: any) {
    logger.error('Error retrieving screenshot', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve screenshot' });
  }
});

/**
 * GET /api/screenshots/execution/:executionId
 * Get all screenshots for a test execution
 */
router.get('/execution/:executionId', authenticate, async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;

    const result = await pool.query(
      'SELECT * FROM screenshots WHERE test_case_execution_id = $1 ORDER BY created_at ASC',
      [executionId]
    );

    res.json({
      success: true,
      screenshots: result.rows
    });
  } catch (error: any) {
    logger.error('Error retrieving screenshots', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve screenshots' });
  }
});

/**
 * DELETE /api/screenshots/:id
 * Delete a screenshot (from file system or database)
 */
router.delete('/:id', automationAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM screenshots WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    const screenshot = result.rows[0];

    // Delete from database
    await pool.query('DELETE FROM screenshots WHERE id = $1', [id]);

    // Delete file from disk if stored in file system
    if (screenshot.storage_type !== 'database' && screenshot.file_path) {
      const filePath = path.join(process.cwd(), screenshot.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    logger.info('Screenshot deleted', { id, storage_type: screenshot.storage_type });

    res.json({
      success: true,
      message: 'Screenshot deleted successfully'
    });
  } catch (error: any) {
    logger.error('Error deleting screenshot', { error: error.message });
    res.status(500).json({ error: 'Failed to delete screenshot' });
  }
});

export default router;
