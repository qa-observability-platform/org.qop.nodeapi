// src/config/env.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.QOP_NODEAPI_PORT || '4000', 10),
  dbUrl: process.env.QOP_DB_URL || process.env.DATABASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  
  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  
  // Server endpoints (for API key validate-key response)
  wsEndpoint: process.env.WS_ENDPOINT || `ws://localhost:${parseInt(process.env.QOP_NODEAPI_PORT || '4000', 10)}/ws/ingest`,
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${parseInt(process.env.QOP_NODEAPI_PORT || '4000', 10)}`,

  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',
};

// Validate critical config
if (!config.dbUrl) {
  throw new Error('QOP_DB_URL or DATABASE_URL must be set');
}

if (config.isProduction && config.jwtSecret === 'change-this-secret-in-production') {
  throw new Error('JWT_SECRET must be set in production');
}