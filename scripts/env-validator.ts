/**
 * Sovra Protocol - Production Environment Configuration & Secret Validator
 * File: scripts/env-validator.ts
 *
 * Enforces strict environment separation, fail-closed production checks,
 * secret classification, and automatic secret scrubbing for logs.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export interface EnvValidationResult {
  valid: boolean;
  environment: 'production' | 'staging' | 'development' | 'test';
  errors: string[];
  warnings: string[];
  config: {
    port: number;
    p2pPort: number;
    storageDir: string;
    hasAdminSecret: boolean;
    hasTurnSecret: boolean;
    allowedOrigins: string[];
    isProduction: boolean;
  };
}

const INSECURE_DEFAULT_SECRETS = new Set([
  'sovra-test-admin-secret-key-32-chars-ok!',
  'sovra-production-admin-secret-key-32chars!',
  'sovra-operations-master-key',
  'sovra-dev-turn-secret-change-in-prod-replace-with-env!',
  'replace_with_a_cryptographically_secure_random_key_min_32_chars!',
  'replace_with_turn_server_hmac_secret_min_32_chars!',
  'change_me',
  'password',
  'secret',
  'admin',
]);

export function validateEnvironment(): EnvValidationResult {
  const env = (process.env.NODE_ENV || 'development').toLowerCase() as EnvValidationResult['environment'];
  const isProduction = env === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  const port = parseInt(process.env.PORT || process.env.SOVRA_HTTP_PORT || '3001', 10);
  const p2pPort = parseInt(process.env.SOVRA_P2P_PORT || '4001', 10);
  const storageDir = path.resolve(process.env.SOVRA_STORAGE_DIR || (isProduction ? '/app/.sovra-storage-prod' : './.sovra-storage-dev'));

  // 1. ADMIN_SECRET_KEY VALIDATION
  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (isProduction) {
    if (!adminSecret) {
      errors.push('CRITICAL: ADMIN_SECRET_KEY environment variable is required in production.');
    } else {
      if (adminSecret.length < 32) {
        errors.push(`CRITICAL: ADMIN_SECRET_KEY must be at least 32 characters in production (currently ${adminSecret.length}).`);
      }
      if (INSECURE_DEFAULT_SECRETS.has(adminSecret.toLowerCase())) {
        errors.push('CRITICAL: Default or demo ADMIN_SECRET_KEY is strictly forbidden in production.');
      }
    }
  } else {
    if (!adminSecret) {
      warnings.push('ADMIN_SECRET_KEY is not set; falling back to development testing secret.');
    } else if (adminSecret.length < 32) {
      warnings.push('ADMIN_SECRET_KEY is shorter than recommended 32 characters.');
    }
  }

  // 2. WEBRTC / TURN VALIDATION
  const turnServers = process.env.SOVRA_TURN_SERVERS || process.env.WEBRTC_TURN_SERVERS;
  const turnSecret = process.env.SOVRA_TURN_SECRET || process.env.WEBRTC_TURN_SECRET;
  if (turnServers && turnServers.includes('turn:')) {
    if (!turnSecret) {
      if (isProduction) {
        errors.push('CRITICAL: SOVRA_TURN_SECRET is required in production when TURN relay is configured.');
      } else {
        warnings.push('SOVRA_TURN_SERVERS specifies TURN server but SOVRA_TURN_SECRET is missing; static credentials will be required.');
      }
    } else if (isProduction && INSECURE_DEFAULT_SECRETS.has(turnSecret.toLowerCase())) {
      errors.push('CRITICAL: Default or demo SOVRA_TURN_SECRET is strictly forbidden in production.');
    }
  }

  // 3. CORS & ORIGIN VALIDATION
  const rawOrigins = process.env.SOVRA_ALLOWED_ORIGINS || '';
  const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);
  if (isProduction) {
    if (allowedOrigins.length === 0) {
      warnings.push('SOVRA_ALLOWED_ORIGINS is empty in production; all cross-origin browser requests will be rejected by default.');
    }
    if (allowedOrigins.includes('*')) {
      errors.push('CRITICAL: Wildcard "*" is forbidden in SOVRA_ALLOWED_ORIGINS in production.');
    }
    for (const origin of allowedOrigins) {
      if (origin.startsWith('http://') && !origin.includes('localhost')) {
        warnings.push(`Insecure HTTP origin detected in production allowed origins: ${origin}`);
      }
    }
  }

  // 4. STORAGE PATH VALIDATION
  if (isProduction && storageDir.includes('.sovra-storage-dev')) {
    warnings.push('SOVRA_STORAGE_DIR is using development default path (.sovra-storage-dev) in production environment.');
  }

  return {
    valid: errors.length === 0,
    environment: env,
    errors,
    warnings,
    config: {
      port,
      p2pPort,
      storageDir,
      hasAdminSecret: Boolean(adminSecret),
      hasTurnSecret: Boolean(turnSecret),
      allowedOrigins,
      isProduction,
    },
  };
}

/**
 * Secret scrubber utility to prevent passwords, tokens, and keys from leaking to stdout or log files.
 */
export function scrubSecrets(input: string): string {
  if (!input) return input;
  let scrubbed = input;

  // Mask session tokens
  scrubbed = scrubbed.replace(/(?:stk_|ses_|token=)[a-zA-Z0-9_-]{16,}/gi, match => {
    return match.substring(0, 4) + '...[REDACTED_TOKEN]';
  });

  // Mask bearer tokens
  scrubbed = scrubbed.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{12,}/gi, 'Bearer [REDACTED_BEARER]');

  // Mask private keys
  scrubbed = scrubbed.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[^-]+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

  // Mask passwords / PINs in JSON
  scrubbed = scrubbed.replace(/"(?:password|pin|securityPin|totpSecret|adminSecret|secret)":\s*"[^"]+"/gi, match => {
    const key = match.split(':')[0];
    return `${key}: "[REDACTED]"`;
  });

  return scrubbed;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export class ProductionLogger {
  private minLevelPriority: number;
  private isJson: boolean;

  constructor() {
    const configuredLevel = (process.env.SOVRA_LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    this.minLevelPriority = LOG_LEVEL_PRIORITY[configuredLevel] || LOG_LEVEL_PRIORITY.info;
    this.isJson = process.env.NODE_ENV === 'production' || process.env.SOVRA_LOG_FORMAT === 'json';
  }

  public log(level: LogLevel, message: string, meta?: Record<string, any>): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevelPriority) return;

    const timestamp = new Date().toISOString();
    const cleanMessage = scrubSecrets(message);

    if (this.isJson) {
      const entry: Record<string, any> = {
        timestamp,
        level: level.toUpperCase(),
        message: cleanMessage,
      };
      if (meta) {
        try {
          const serializedMeta = scrubSecrets(JSON.stringify(meta));
          entry.meta = JSON.parse(serializedMeta);
        } catch (_) {
          entry.meta = meta;
        }
      }
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      const metaStr = meta ? ' ' + scrubSecrets(JSON.stringify(meta)) : '';
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      if (level === 'error' || level === 'fatal') {
        console.error(`${prefix} ${cleanMessage}${metaStr}`);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${cleanMessage}${metaStr}`);
      } else {
        console.log(`${prefix} ${cleanMessage}${metaStr}`);
      }
    }
  }

  public debug(msg: string, meta?: Record<string, any>) { this.log('debug', msg, meta); }
  public info(msg: string, meta?: Record<string, any>) { this.log('info', msg, meta); }
  public warn(msg: string, meta?: Record<string, any>) { this.log('warn', msg, meta); }
  public error(msg: string, meta?: Record<string, any>) { this.log('error', msg, meta); }
  public fatal(msg: string, meta?: Record<string, any>) { this.log('fatal', msg, meta); }
}

export const logger = new ProductionLogger();
