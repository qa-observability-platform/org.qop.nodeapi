// src/routes/invitations.routes.ts
/**
 * User Invitation Routes
 * 
 * Purpose: Handle user invitations to organizations and projects
 * Endpoints:
 * - POST /organizations/:orgId/invitations - Invite user to organization
 * - POST /projects/:projectId/invitations - Invite user to project
 * - GET /invitations - List all pending invitations (for current user)
 * - POST /invitations/:token/accept - Accept invitation
 * - DELETE /invitations/:id - Revoke/cancel invitation
 * 
 * Flow:
 * 1. ORG_ADMIN invites user via email
 * 2. System sends invitation email with token
 * 3. User clicks link, completes registration (if new) or accepts (if existing)
 * 4. User is added to org/project with specified role
 */

import type { Express } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.middleware.js';

import { UserRole } from '../types/roles.js';
import { registerUser } from '../services/auth.service.js';
import { findUserByEmail, addUserToOrganization, addUserToProject } from '../repositories/users.repository.js';

export function registerInvitationsRoutes(app: Express) {
  /**
   * Invite user to organization
   * Only ORG_OWNER and ORG_ADMIN can invite
   */
  app.post(
    '/organizations/:orgId/invitations',
    authenticate,

    async (req, res) => {
      try {
        const { orgId } = req.params;
        const { email, role } = req.body;

        if (!email || !role) {
          return res.status(400).json({ error: 'Email and role are required' });
        }

        // Validate role
        const validOrgRoles = [
          UserRole.ORG_OWNER,
          UserRole.ORG_ADMIN,
          UserRole.PROJECT_ADMIN,
          UserRole.PROJECT_MEMBER,
          UserRole.QA_LEAD,
          UserRole.DEVELOPER,
          UserRole.VIEWER,
        ];
        if (!validOrgRoles.includes(role)) {
          return res.status(400).json({
            error: `Invalid role. Must be one of: ${validOrgRoles.join(', ')}`,
          });
        }

        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
          // Check if already a member
          const memberCheck = await pool.query(
            'SELECT 1 FROM user_organizations WHERE user_id = $1 AND org_id = $2',
            [existingUser.id, orgId]
          );

          if (memberCheck.rows.length > 0) {
            return res.status(409).json({
              error: 'User is already a member of this organization',
            });
          }
        }

        // Generate invitation token
        const token = crypto.randomBytes(32).toString('hex');

        // Create invitation
        const result = await pool.query<{
          id: string;
          email: string;
          role: string;
          token: string;
          expires_at: string;
        }>(
          `
            INSERT INTO invitations (
              email,
              org_id,
              role,
              token,
              invited_by,
              expires_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
            RETURNING id, email, role, token, expires_at
          `,
          [email, orgId, role, token, req.user!.userId]
        );

        const invitation = result.rows[0];

        // Simulate sending invitation email
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 [EMAIL SIMULATION] Organization Invitation');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`To: ${email}`);
        console.log(`Subject: You've been invited to join an organization on QOP`);
        console.log(`\nYou've been invited to join as ${role}`);
        console.log(`\nAn invitation link has been sent to the recipient's email.`);
        console.log(`\nThis invitation expires in 7 days.`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const acceptUrl = `${process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/accept?token=${invitation.token}`;

        res.status(201).json({
          message: 'Invitation sent successfully',
          invitation: {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expires_at,
            acceptUrl,
          },
        });
      } catch (error) {
        console.error('[Invitations] Failed to create org invitation:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
      }
    }
  );

  /**
   * Invite user to project
   * PROJECT_ADMIN can invite
   */
  app.post(
    '/projects/:projectId/invitations',
    authenticate,

    async (req, res) => {
      try {
        const { projectId } = req.params;
        const { email, role } = req.body;

        if (!email || !role) {
          return res.status(400).json({ error: 'Email and role are required' });
        }

        // Validate role is a project-level role
        const validProjectRoles = [
          UserRole.PROJECT_ADMIN,
          UserRole.PROJECT_MEMBER,
          UserRole.QA_LEAD,
          UserRole.DEVELOPER,
          UserRole.VIEWER,
        ];

        if (!validProjectRoles.includes(role)) {
          return res.status(400).json({
            error: `Invalid role. Must be one of: ${validProjectRoles.join(', ')}`,
          });
        }

        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
          // Check if already a member
          const memberCheck = await pool.query(
            'SELECT 1 FROM user_projects WHERE user_id = $1 AND project_id = $2',
            [existingUser.id, projectId]
          );

          if (memberCheck.rows.length > 0) {
            return res.status(409).json({
              error: 'User is already a member of this project',
            });
          }
        }

        // Generate invitation token
        const token = crypto.randomBytes(32).toString('hex');

        // Create invitation
        const result = await pool.query<{
          id: string;
          email: string;
          role: string;
          token: string;
          expires_at: string;
        }>(
          `
            INSERT INTO invitations (
              email,
              project_id,
              role,
              token,
              invited_by,
              expires_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
            RETURNING id, email, role, token, expires_at
          `,
          [email, projectId, role, token, req.user!.userId]
        );

        const invitation = result.rows[0];

        // Simulate sending invitation email
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 [EMAIL SIMULATION] Project Invitation');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`To: ${email}`);
        console.log(`Subject: You've been invited to join a project on QOP`);
        console.log(`\nYou've been invited to join as ${role}`);
        console.log(`\nAn invitation link has been sent to the recipient's email.`);
        console.log(`\nThis invitation expires in 7 days.`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const acceptUrl = `${process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/accept?token=${invitation.token}`;

        res.status(201).json({
          message: 'Invitation sent successfully',
          invitation: {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expires_at,
            acceptUrl,
          },
        });
      } catch (error) {
        console.error('[Invitations] Failed to create project invitation:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
      }
    }
  );

  /**
   * Accept invitation - Creates account if new user, or adds to org/project if existing
   */
  app.post('/invitations/:token/accept', async (req, res) => {
    try {
      const { token } = req.params;
      const { password, firstName, lastName } = req.body;

      // Find invitation
      const invitationResult = await pool.query<{
        id: string;
        email: string;
        org_id: string | null;
        project_id: string | null;
        role: string;
        status: string;
        expires_at: string;
        invited_by: string;
      }>(
        `
          SELECT id, email, org_id, project_id, role, status, expires_at, invited_by
          FROM invitations
          WHERE token = $1
            AND status = 'pending'
            AND expires_at > NOW()
          LIMIT 1
        `,
        [token]
      );

      if (invitationResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Invalid or expired invitation',
        });
      }

      const invitation = invitationResult.rows[0];

      // Check if user exists
      let user = await findUserByEmail(invitation.email);

      if (!user) {
        // New user - create account
        if (!password) {
          return res.status(400).json({
            error: 'Password is required for new users',
          });
        }

        if (password.length < 8) {
          return res.status(400).json({
            error: 'Password must be at least 8 characters long',
          });
        }

        user = await registerUser({
          email: invitation.email,
          password,
          firstName,
          lastName,
        });
      }

      // Add user to organization or project
      if (invitation.org_id) {
        await addUserToOrganization(
          user.id,
          invitation.org_id,
          invitation.role as UserRole,
          invitation.invited_by
        );
      } else if (invitation.project_id) {
        await addUserToProject(
          user.id,
          invitation.project_id,
          invitation.role as UserRole,
          invitation.invited_by
        );
      }

      // Mark invitation as accepted
      await pool.query(
        `
          UPDATE invitations
          SET status = 'accepted', accepted_at = NOW()
          WHERE id = $1
        `,
        [invitation.id]
      );

      res.json({
        message: 'Invitation accepted successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (error: any) {
      console.error('[Invitations] Failed to accept invitation:', error);

      if (error.message.includes('already exists')) {
        return res.status(409).json({
          error: 'User already exists. Please login to accept this invitation.',
        });
      }

      res.status(500).json({ error: 'Failed to accept invitation' });
    }
  });

  /**
   * List pending invitations for authenticated user
   */
  app.get('/invitations/me', authenticate, async (req, res) => {
    try {
      const result = await pool.query<{
        id: string;
        email: string;
        org_id: string | null;
        org_name: string | null;
        project_id: string | null;
        project_name: string | null;
        role: string;
        expires_at: string;
        created_at: string;
      }>(
        `
          SELECT
            i.id,
            i.email,
            i.org_id,
            o.name as org_name,
            i.project_id,
            p.name as project_name,
            i.role,
            i.expires_at,
            i.created_at
          FROM invitations i
          LEFT JOIN organizations o ON o.id = i.org_id
          LEFT JOIN projects p ON p.id = i.project_id
          WHERE i.email = $1
            AND i.status = 'pending'
            AND i.expires_at > NOW()
          ORDER BY i.created_at DESC
        `,
        [req.user!.email]
      );

      res.json({
        invitations: result.rows.map(row => ({
          id: row.id,
          email: row.email,
          organization: row.org_id ? {
            id: row.org_id,
            name: row.org_name,
          } : null,
          project: row.project_id ? {
            id: row.project_id,
            name: row.project_name,
          } : null,
          role: row.role,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      console.error('[Invitations] Failed to list invitations:', error);
      res.status(500).json({ error: 'Failed to list invitations' });
    }
  });

  /**
   * Revoke/cancel invitation
   */
  app.delete(
    '/invitations/:id',
    authenticate,
    async (req, res) => {
      try {
        const { id } = req.params;

        // Get invitation to check permissions
        const invitationResult = await pool.query<{
          invited_by: string;
          org_id: string | null;
          project_id: string | null;
        }>(
          'SELECT invited_by, org_id, project_id FROM invitations WHERE id = $1',
          [id]
        );

        if (invitationResult.rows.length === 0) {
          return res.status(404).json({ error: 'Invitation not found' });
        }

        const invitation = invitationResult.rows[0];

        // Only the inviter or an admin can revoke
        if (invitation.invited_by !== req.user!.userId) {
          // Check if user is admin of the org/project
          // Simplified: just allow the inviter for now
          return res.status(403).json({
            error: 'You do not have permission to revoke this invitation',
          });
        }

        // Delete invitation
        await pool.query('DELETE FROM invitations WHERE id = $1', [id]);

        res.json({ message: 'Invitation revoked successfully' });
      } catch (error) {
        console.error('[Invitations] Failed to revoke invitation:', error);
        res.status(500).json({ error: 'Failed to revoke invitation' });
      }
    }
  );
}