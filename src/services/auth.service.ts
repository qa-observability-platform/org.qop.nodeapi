// src/services/auth.service.ts
/**
 * Authentication Service
 * 
 * Purpose: Handles all authentication logic including:
 * - User registration with password hashing
 * - Login with JWT token generation
 * - Token refresh mechanism
 * - Password reset flows
 * - Email verification
 */

import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  getUserPasswordHash,
  updateLastLogin,
  verifyUserEmail,
  setPasswordResetToken,
  resetPassword,
  getUserWithRoles,
  addUserToOrganization,
} from '../repositories/users.repository.js';
import {
  createRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
} from '../repositories/tokens.repository.js';
import type {
  RegisterInput,
  LoginInput,
  AuthTokens,
  UserWithRoles,
  JwtPayload,
} from '../types/auth.js';
import { UserRole } from '../types/roles.js';

const SALT_ROUNDS = 10;

/**
 * Register a new user
 */
export async function registerUser(input: RegisterInput): Promise<UserWithRoles> {
  const existingUser = await findUserByEmail(input.email);
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');

  const user = await createUser({
    ...input,
    passwordHash,
    emailVerificationToken,
  });

  // Simulate sending verification email
  console.log(`\n[Auth] Verification token for ${user.email}: ${emailVerificationToken}`);

  const userWithRoles = await getUserWithRoles(user.id);
  if (!userWithRoles) {
    throw new Error('Failed to create user');
  }

  return userWithRoles;
}

/**
 * Login user and generate tokens
 */
export async function loginUser(input: LoginInput): Promise<{
  user: UserWithRoles;
  tokens: AuthTokens;
}> {
  const user = await findUserByEmail(input.email);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    throw new Error('Account is deactivated. Please contact support.');
  }

  const passwordHash = await getUserPasswordHash(user.id);
  if (!passwordHash) {
    throw new Error('Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(input.password, passwordHash);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  const userWithRoles = await getUserWithRoles(user.id);
  if (!userWithRoles) {
    throw new Error('Failed to load user data');
  }

  const tokens = await generateAuthTokens(userWithRoles);
  await updateLastLogin(user.id);

  return { user: userWithRoles, tokens };
}

/**
 * Generate JWT access token and refresh token
 */
export async function generateAuthTokens(user: UserWithRoles): Promise<AuthTokens> {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    roles: user.roles,
  };

  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: String(config.jwtExpiresIn),
  } as SignOptions);

  const refreshTokenString = crypto.randomBytes(64).toString('hex');
  await createRefreshToken(user.id, refreshTokenString);

  return {
    accessToken,
    refreshToken: refreshTokenString,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const tokenData = await findValidRefreshToken(refreshToken);
  if (!tokenData) {
    throw new Error('Invalid or expired refresh token');
  }

  const user = await getUserWithRoles(tokenData.userId);
  if (!user) {
    throw new Error('User not found');
  }

  await revokeRefreshToken(refreshToken);
  return generateAuthTokens(user);
}

/**
 * Verify JWT token and return payload
 */
export function verifyAccessToken(token: string): JwtPayload {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    return payload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Logout user by revoking refresh token
 */
export async function logoutUser(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

/**
 * Verify user email with token
 */
export async function verifyEmail(token: string): Promise<boolean> {
  return verifyUserEmail(token);
}

/**
 * Initiate password reset flow
 */
export async function initiatePasswordReset(email: string): Promise<void> {
  const resetToken = crypto.randomBytes(32).toString('hex');
  const success = await setPasswordResetToken(email, resetToken);

  if (!success) {
    console.log(`[Auth] Password reset attempted for non-existent email: ${email}`);
    return;
  }

  console.log(`\n[Auth] Password reset token for ${email}: ${resetToken}`);
}

/**
 * Complete password reset with token
 */
export async function completePasswordReset(
  token: string,
  newPassword: string
): Promise<boolean> {
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  return resetPassword(token, newPasswordHash);
}

/**
 * Assign user to organization with role
 */
export async function assignUserToOrganization(
  userId: string,
  orgId: string,
  role: UserRole = UserRole.VIEWER,
  invitedBy?: string
): Promise<void> {
  await addUserToOrganization(userId, orgId, role, invitedBy);
}