// src/routes/organizations.routes.ts
import { Router, type Express } from 'express';
import {
  findOrganizationById,
  listOrganizations,
} from '../repositories/organizations.repository.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/rbac.middleware.js';
import { Permission } from '../types/roles.js';

const router = Router();

/**
 * GET /organizations
 * List all organizations with stats
 */
router.get('/', authenticate, requirePermission(Permission.ORG_VIEW, 'ORGANIZATION'), async (req, res) => {
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
router.get('/:orgId', authenticate, requirePermission(Permission.ORG_VIEW, 'ORGANIZATION'), async (req, res) => {
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
router.put('/:orgId', authenticate, requirePermission(Permission.ORG_UPDATE, 'ORGANIZATION'), async (req, res) => {
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
router.get('/:orgId/members', authenticate, requirePermission(Permission.ORG_VIEW, 'ORGANIZATION'), async (req, res) => {
  try {
    const { orgId } = req.params;

    const { pool } = await import('../db/pool.js');

    const result = await pool.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      created_at: string;
      last_active_at: string | null;
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
          u.last_active_at,
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
      lastActiveAt: row.last_active_at,
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
router.get('/:orgId/invitations', authenticate, requirePermission(Permission.ORG_VIEW, 'ORGANIZATION'), async (req, res) => {
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
 * POST /organizations/:orgId/invitations
 * Invite member to organization
 */
router.post('/:orgId/invitations', authenticate, requirePermission(Permission.USER_INVITE, 'ORGANIZATION'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    const { pool } = await import('../db/pool.js');

    // Check if user already exists in org
    const existingUser = await pool.query(
      `
        SELECT u.id FROM users u
        JOIN user_organizations uo ON u.id = uo.user_id
        WHERE u.email = $1 AND uo.org_id = $2
      `,
      [email, orgId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already in organization' });
    }

    // Check if pending invitation exists
    const existingInvitation = await pool.query(
      `SELECT id FROM invitations WHERE email = $1 AND org_id = $2 AND status = 'pending'`,
      [email, orgId]
    );

    if (existingInvitation.rows.length > 0) {
      return res.status(409).json({ error: 'Invitation already sent' });
    }

    // Create invitation
    await pool.query(
      `
        INSERT INTO invitations (org_id, email, role, invited_by, status, created_at)
        VALUES ($1, $2, $3, $4, 'pending', NOW())
      `,
      [orgId, email, role, req.user!.userId]
    );

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📧 [EMAIL SIMULATION] Team Invitation`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`To: ${email}`);
    console.log(`Role: ${role}`);
    console.log(`Invited by: User ${req.user!.userId}`);
    console.log(`\nClick to accept: http://localhost:3000/auth/accept-invitation?token=INVITE_TOKEN`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    res.status(201).json({ message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Failed to invite member:', error);
    res.status(500).json({ error: 'Failed to invite member' });
  }
});

/**
 * PUT /organizations/:orgId/members/:userId
 * Update member role
 */
router.put('/:orgId/members/:userId', authenticate, requirePermission(Permission.ORG_MANAGE_USERS, 'ORGANIZATION'), async (req, res) => {
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
router.delete('/:orgId/members/:userId', authenticate, requirePermission(Permission.ORG_MANAGE_USERS, 'ORGANIZATION'), async (req, res) => {
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
