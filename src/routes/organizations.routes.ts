// src/routes/organizations.routes.ts
import { Router, type Express } from 'express';
import {
  findOrganizationById,
  listOrganizations,
} from '../repositories/organizations.repository.js';
import { authenticate } from '../middleware/auth.middleware.js';



const router = Router();

/**
 * GET /organizations
 * List all organizations with stats
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizations = await listOrganizations();
    res.json({ organizations });
  } catch (error) {
    console.error('Failed to list organizations:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

/**
 * GET /organizations/:orgId
 * Get organization by ID
 */
router.get('/:orgId', authenticate, async (req, res) => {
  try {
    const { orgId } = req.params;
    const organization = await findOrganizationById(orgId);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ organization });
  } catch (error) {
    console.error('Failed to get organization:', error);
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

/**
 * PUT /organizations/:orgId
 * Update organization
 */
router.put('/:orgId', authenticate, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, description } = req.body;

    // Verify organization exists
    const org = await findOrganizationById(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Import pool for direct query
    const { pool } = await import('../db/pool.js');

    // Update organization
    await pool.query(
      `
        UPDATE organizations
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            updated_at = NOW()
        WHERE id = $3
      `,
      [name || null, description || null, orgId]
    );

    // Fetch updated organization
    const updated = await findOrganizationById(orgId);

    res.json({ organization: updated });
  } catch (error) {
    console.error('Failed to update organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

/**
 * GET /organizations/:orgId/members
 * List organization members with roles
 */
router.get('/:orgId/members', authenticate, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { pool } = await import('../db/pool.js');

    const result = await pool.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      created_at: string;
      last_login_at: string | null;
      role: string;
      scope: string;
      scope_id: string | null;
    }>(
      `
        SELECT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.created_at,
          u.last_login_at,
          uo.role,
          'ORGANIZATION' as scope,
          uo.org_id as scope_id
        FROM users u
        JOIN user_organizations uo ON u.id = uo.user_id
        WHERE uo.org_id = $1 AND u.is_active = true
        ORDER BY u.created_at ASC
      `,
      [orgId]
    );

    const members = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      createdAt: row.created_at,
      lastActiveAt: row.last_login_at,
      roles: [
        {
          role: row.role,
          scope: row.scope,
          scopeId: row.scope_id,
        },
      ],
    }));

    res.json({ members });
  } catch (error) {
    console.error('Failed to list members:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * GET /organizations/:orgId/invitations
 * List pending invitations
 */
router.get('/:orgId/invitations', authenticate, async (req, res) => {
  try {
    const { orgId } = req.params;

    const { pool } = await import('../db/pool.js');

    const result = await pool.query<{
      id: string;
      email: string;
      role: string;
      invited_by: string;
      created_at: string;
    }>(
      `
        SELECT
          i.id,
          i.email,
          i.role,
          u.email as invited_by,
          i.created_at
        FROM invitations i
        JOIN users u ON i.invited_by = u.id
        WHERE i.org_id = $1 AND i.status = 'pending'
        ORDER BY i.created_at DESC
      `,
      [orgId]
    );

    const invitations = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      invitedBy: row.invited_by,
      createdAt: row.created_at,
    }));

    res.json({ invitations });
  } catch (error) {
    console.error('Failed to list invitations:', error);
    res.status(500).json({ error: 'Failed to list invitations' });
  }
});

/**
 * PUT /organizations/:orgId/members/:userId
 * Update member role
 */
router.put('/:orgId/members/:userId', authenticate, async (req, res) => {
  try {
    const { orgId, userId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    const { pool } = await import('../db/pool.js');

    // Update role
    const result = await pool.query(
      `
        UPDATE user_organizations
        SET role = $1
        WHERE org_id = $2 AND user_id = $3
        RETURNING *
      `,
      [role, orgId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in organization' });
    }

    res.json({ message: 'Member role updated successfully' });
  } catch (error) {
    console.error('Failed to update member role:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

/**
 * DELETE /organizations/:orgId/members/:userId
 * Remove member from organization
 */
router.delete('/:orgId/members/:userId', authenticate, async (req, res) => {
  try {
    const { orgId, userId } = req.params;

    const { pool } = await import('../db/pool.js');

    // Cannot remove yourself
    if (userId === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot remove yourself from the organization' });
    }

    // Delete user from organization
    const result = await pool.query(
      `
        DELETE FROM user_organizations
        WHERE org_id = $1 AND user_id = $2
        RETURNING *
      `,
      [orgId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in organization' });
    }

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Failed to remove member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

export function registerOrganizationsRoutes(app: Express) {
  app.use('/organizations', router);
}
