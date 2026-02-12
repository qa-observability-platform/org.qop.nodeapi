// src/routes/auth.routes.ts
/**
 * Authentication Routes
 * 
 * Purpose: Handle user authentication flows
 * Endpoints:
 * - POST /auth/register - Self-registration (creates ORG_OWNER + new org)
 * - POST /auth/login - Login with email/password
 * - POST /auth/refresh - Refresh access token
 * - POST /auth/logout - Logout (revoke refresh token)
 * - POST /auth/verify-email - Verify email with token
 * - POST /auth/forgot-password - Request password reset
 * - POST /auth/reset-password - Reset password with token
 * - GET /auth/me - Get current user info
 * 
 * Key Rule: Only ORG_OWNER can self-register. All other users must be invited.
 */

import type { Express } from 'express';
import { pool } from '../db/pool.js';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  verifyEmail,
  initiatePasswordReset,
  completePasswordReset,
} from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { getUserWithRoles } from '../repositories/users.repository.js';
import { UserRole } from '../types/roles.js';

export function registerAuthRoutes(app: Express) {
  /**
   * Self-Registration - Creates new organization with user as ORG_OWNER
   * This is the ONLY way to self-register. All other users must be invited.
   */
  app.post('/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName, organizationName } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      if (!organizationName) {
        return res.status(400).json({ error: 'Organization name is required' });
      }

      if (password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters long',
        });
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Start transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Register user
        const user = await registerUser({
          email,
          password,
          firstName,
          lastName,
        });

        // Create organization
        const orgResult = await client.query<{ id: string; name: string }>(
          `
            INSERT INTO organizations (name, created_at)
            VALUES ($1, NOW())
            RETURNING id, name
          `,
          [organizationName]
        );

        const organization = orgResult.rows[0];

        // Assign user as ORG_OWNER
        await client.query(
          `
            INSERT INTO user_organizations (user_id, org_id, role)
            VALUES ($1, $2, $3)
          `,
          [user.id, organization.id, UserRole.ORG_OWNER]
        );

        await client.query('COMMIT');

        // Simulate sending verification email
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 [EMAIL SIMULATION] Verification Email');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`To: ${email}`);
        console.log(`Subject: Verify your QOP account`);
        console.log(`\nHi ${firstName || 'there'},`);
        console.log(`\nWelcome to QOP! Please verify your email by clicking:`);
        console.log(`http://localhost:3000/auth/verify-email?token=${user.roles[0]?.scopeId || 'TOKEN'}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        res.status(201).json({
          message: 'Registration successful. Please check your email to verify your account.',
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
          },
          organization: {
            id: organization.id,
            name: organization.name,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error('[Auth] Registration failed:', error);
      
      if (error.message.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }

      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  });

  /**
   * Login - Returns user info and JWT tokens
   */
  app.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await loginUser({ email, password });

      res.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          isEmailVerified: result.user.isEmailVerified,
          roles: result.user.roles,
        },
        tokens: result.tokens,
      });
    } catch (error: any) {
      console.error('[Auth] Login failed:', error);

      if (error.message.includes('Invalid email or password')) {
        return res.status(401).json({ error: error.message });
      }

      if (error.message.includes('deactivated')) {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  });

  /**
   * Refresh Token - Get new access token using refresh token
   */
  app.post('/auth/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }

      const tokens = await refreshAccessToken(refreshToken);

      res.json({ tokens });
    } catch (error: any) {
      console.error('[Auth] Token refresh failed:', error);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  /**
   * Logout - Revoke refresh token
   */
  app.post('/auth/logout', async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        await logoutUser(refreshToken);
      }

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('[Auth] Logout failed:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  /**
   * Get Current User - Returns authenticated user info
   */
  app.get('/auth/me', authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await getUserWithRoles(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isEmailVerified: user.isEmailVerified,
          roles: user.roles,
        },
      });
    } catch (error) {
      console.error('[Auth] Get current user failed:', error);
      res.status(500).json({ error: 'Failed to get user info' });
    }
  });

  /**
   * Verify Email - Verify user email with token
   */
  app.post('/auth/verify-email', async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Verification token is required' });
      }

      const success = await verifyEmail(token);

      if (!success) {
        return res.status(400).json({
          error: 'Invalid or expired verification token',
        });
      }

      res.json({ message: 'Email verified successfully' });
    } catch (error) {
      console.error('[Auth] Email verification failed:', error);
      res.status(500).json({ error: 'Email verification failed' });
    }
  });

  /**
   * Forgot Password - Send password reset email
   */
  app.post('/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      await initiatePasswordReset(email);

      // Always return success (don't reveal if email exists)
      res.json({
        message: 'If an account exists with this email, a password reset link has been sent.',
      });
    } catch (error) {
      console.error('[Auth] Forgot password failed:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });

  /**
   * Reset Password - Reset password with token
   */
  app.post('/auth/reset-password', async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          error: 'Token and new password are required',
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters long',
        });
      }

      const success = await completePasswordReset(token, newPassword);

      if (!success) {
        return res.status(400).json({
          error: 'Invalid or expired reset token',
        });
      }

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      console.error('[Auth] Password reset failed:', error);
      res.status(500).json({ error: 'Password reset failed' });
    }
  });

  /**
   * Update Profile - Update user's first/last name
   */
  app.put('/auth/profile', authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { firstName, lastName } = req.body;

      // Update user profile
      await pool.query(
        `
          UPDATE users
          SET first_name = COALESCE($1, first_name),
              last_name = COALESCE($2, last_name),
              updated_at = NOW()
          WHERE id = $3
        `,
        [firstName || null, lastName || null, req.user.userId]
      );

      res.json({ message: 'Profile updated successfully' });
    } catch (error) {
      console.error('[Auth] Profile update failed:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  /**
   * Change Password - Change user's password
   */
  app.put('/auth/password', authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: 'Current password and new password are required',
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters long',
        });
      }

      // Get user's current password hash
      const userResult = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      const bcrypt = await import('bcrypt');
      const isValid = await bcrypt.compare(
        currentPassword,
        userResult.rows[0].password_hash
      );

      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password
      await pool.query(
        `
          UPDATE users
          SET password_hash = $1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [newPasswordHash, req.user.userId]
      );

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('[Auth] Password change failed:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });
}