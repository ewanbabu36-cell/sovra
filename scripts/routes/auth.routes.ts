/**
 * @file scripts/routes/auth.routes.ts
 * Sovereign Authentication, WebAuthn Biometrics, Identity & User Profile Route Controller.
 *
 * Implements type-safe registration, login, logout, WebAuthn Passkeys (FIDO2/WebAuthn Level 3),
 * RFC 6238 TOTP 2FA, PIN updates & recovery, session management, multi-device linking tickets,
 * profile aggregate views, avatar/cover media, and privacy settings.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { sovraDb, toPublicUserDTO, type UserRecord } from '../database-engine.ts';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateLoginOptions,
  verifyLoginResponse,
} from '../webauthn-engine.ts';
import { generateEd25519KeyPair, bytesToHex } from '../../packages/crypto/dist/index.js';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface AuthRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  clientIp?: string;
  masterKey?: any;
  storageDir?: string;
  resolvePrincipal: (req: http.IncomingMessage, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  activeChallenges?: Map<string, { prefix: string; difficulty: number; expiresAt: number }>;
  ipRegistrationThrottle?: Map<string, number[]>;
  deviceLinkTickets?: Map<string, { did: string; handle: string; createdAt: number; expiresAt: number }>;
  dynamicSocialStore?: any;
  validateMediaMagicBytes?: (buffer: Buffer, declaredMime?: string) => { valid: boolean; detectedMime?: string; error?: string };
}

// Fallback module-level state caches if not passed via context
const defaultActiveChallenges = new Map<string, { prefix: string; difficulty: number; expiresAt: number }>();
const defaultIpRegistrationThrottle = new Map<string, number[]>();
const defaultDeviceLinkTickets = new Map<string, { did: string; handle: string; createdAt: number; expiresAt: number }>();

function defaultValidateMediaMagicBytes(buffer: Buffer, declaredMime?: string): { valid: boolean; detectedMime?: string; error?: string } {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'Empty or corrupt media payload' };
  }
  const hex4 = buffer.subarray(0, 4).toString('hex').toLowerCase();
  const hex8 = buffer.length >= 8 ? buffer.subarray(0, 8).toString('hex').toLowerCase() : '';
  if (hex4.startsWith('4d5a') || hex8.startsWith('7f454c46')) {
    return { valid: false, error: 'Malicious payload detected: executable binary format is strictly prohibited' };
  }
  const textSample = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').toLowerCase();
  if (textSample.includes('<script') || textSample.includes('<?php') || textSample.includes('#!/bin') || textSample.includes('<html>')) {
    return { valid: false, error: 'Malicious payload detected: executable or script content in media upload' };
  }
  if (hex4.startsWith('ffd8ff')) return { valid: true, detectedMime: 'image/jpeg' };
  if (hex8.startsWith('89504e470d0a1a0a')) return { valid: true, detectedMime: 'image/png' };
  if (hex4.startsWith('47494638')) return { valid: true, detectedMime: 'image/gif' };
  if (hex4.startsWith('52494646') && buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { valid: true, detectedMime: 'image/webp' };
  }
  if (hex4.startsWith('1a45dfa3')) return { valid: true, detectedMime: 'video/webm' };
  return { valid: true, detectedMime: declaredMime || 'application/octet-stream' };
}

/**
 * Handle authentication, identity, and profile routes.
 * Returns true if the request matched and was handled, false otherwise.
 */
export async function handleAuthRoutes(ctx: AuthRouteContext): Promise<boolean> {
  const {
    req,
    res,
    url,
    resolvePrincipal,
    enforceAuth,
    readBoundedBody,
  } = ctx;

  const clientIp = ctx.clientIp || (req.socket as any)?.remoteAddress || '127.0.0.1';
  const storageDir = ctx.storageDir || path.resolve(process.env.SOVRA_STORAGE_DIR || './.sovra-storage-dev');
  const avatarsDir = path.join(storageDir, 'avatars');
  const coversDir = path.join(storageDir, 'covers');
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

  const activeChallenges = ctx.activeChallenges || defaultActiveChallenges;
  const ipRegistrationThrottle = ctx.ipRegistrationThrottle || defaultIpRegistrationThrottle;
  const deviceLinkTickets = ctx.deviceLinkTickets || defaultDeviceLinkTickets;
  const validateMagic = ctx.validateMediaMagicBytes || defaultValidateMediaMagicBytes;

  // 1. Proof-of-Work Challenge Endpoint (Anti-Sybil Defense)
  if (url.pathname === '/api/auth/challenge' && req.method === 'GET') {
    const challengeId = 'pow_' + crypto.randomBytes(16).toString('hex');
    const prefix = crypto.randomBytes(8).toString('hex');
    const difficulty = Number(process.env.SOVRA_POW_DIFFICULTY) || 3;
    const expiresAt = Date.now() + 120000; // 2 minutes validity
    activeChallenges.set(challengeId, { prefix, difficulty, expiresAt });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, challengeId, prefix, difficulty, expiresAt }));
    return true;
  }

  // 2. User Registration
  if ((url.pathname === '/api/user/register' || url.pathname === '/api/auth/register') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const regIp = clientIp;
      const isLoopback = regIp === '127.0.0.1' || regIp === '::1' || regIp === 'localhost';
      const isTestEnv = (process.env.NODE_ENV === 'test' && process.env.SOVRA_REQUIRE_POW !== 'true') ||
        (process.env.NODE_ENV === 'test' && isLoopback && req.headers['x-sovra-test-fixture'] === 'true');

      if (!isTestEnv) {
        const now = Date.now();
        const timestamps = (ipRegistrationThrottle.get(regIp) || []).filter(t => now - t < 3600000);
        if (timestamps.length >= 10) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Registration rate limit exceeded: maximum 10 accounts per hour per IP' }));
          return true;
        }
        timestamps.push(now);
        ipRegistrationThrottle.set(regIp, timestamps);
      }

      if (!isTestEnv || parsed.challengeId || process.env.SOVRA_REQUIRE_POW === 'true') {
        if (!parsed.challengeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Proof-of-Work challenge is required for registration' }));
          return true;
        }
        const challenge = activeChallenges.get(String(parsed.challengeId));
        if (!challenge || challenge.expiresAt < Date.now()) {
          activeChallenges.delete(String(parsed.challengeId));
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Proof-of-Work challenge has expired or is invalid. Please request a new challenge.' }));
          return true;
        }
        const nonce = String(parsed.solutionNonce || '');
        const computedHash = crypto.createHash('sha256').update(challenge.prefix + nonce).digest('hex');
        const targetPrefix = '0'.repeat(challenge.difficulty);
        if (!computedHash.startsWith(targetPrefix)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Proof-of-Work challenge verification failed: invalid solution nonce.' }));
          return true;
        }
        activeChallenges.delete(String(parsed.challengeId));
      }

      let handle = String(parsed.handle || '').trim();
      if (!handle) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Handle is required' }));
        return true;
      }
      if (!handle.startsWith('@')) handle = '@' + handle;

      const valRes = sovraDb.validateHandle(handle);
      if (!valRes.valid) {
        const status = valRes.error?.includes('reserved') ? 403 : (valRes.error?.includes('already in use') ? 409 : 400);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: valRes.error }));
        return true;
      }
      handle = valRes.cleanHandle || handle;

      if (parsed.did && sovraDb.findUserByDid(String(parsed.did))) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'DID is already registered to an existing sovereign identity' }));
        return true;
      }

      if (sovraDb.findUserByHandle(handle)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Handle ${handle} is already taken by another peer. Please choose a different handle.` }));
        return true;
      }

      const did = parsed.did && (String(parsed.did).startsWith('did:key:') || String(parsed.did).startsWith('did:sovra:'))
        ? String(parsed.did)
        : ('did:sovra:user_' + crypto.randomBytes(8).toString('hex'));
      let userPubKeyHex = parsed.publicKey ? String(parsed.publicKey) : undefined;
      if (!userPubKeyHex) {
        const generatedPair = generateEd25519KeyPair();
        userPubKeyHex = bytesToHex(generatedPair.publicKey);
      }
      const sessionToken = (isTestEnv && parsed.sessionToken) ? String(parsed.sessionToken) : ('stk_' + crypto.randomBytes(32).toString('hex'));
      const displayName = String(parsed.name || parsed.displayName || handle.replace('@', '')).trim();
      const securityPin = parsed.securityPin ? String(parsed.securityPin).trim() : (parsed.pin ? String(parsed.pin).trim() : '123456');

      const regResult = sovraDb.registerUser({
        did,
        handle,
        displayName: displayName || 'Sovereign Peer',
        avatar: String(parsed.avatar || displayName.charAt(0).toUpperCase() || 'S'),
        avatarDataUrl: parsed.avatarDataUrl ? String(parsed.avatarDataUrl) : undefined,
        avatarBg: String(parsed.avatarBg || '#6366f1'),
        bio: String(parsed.bio || ''),
        deviceType: parsed.device === 'Mobile' || parsed.deviceType === 'Mobile' ? 'Mobile' : 'Desktop',
        publicKey: userPubKeyHex,
        sessionToken,
        securityPin,
      });

      if (!regResult.ok) {
        res.writeHead(regResult.code || 409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: regResult.error }));
        return true;
      }

      const user = regResult.user;
      const isSecureReg = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          `sovra_session=${encodeURIComponent(user.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureReg ? '; Secure' : ''}`,
          `sovra_session_token=${encodeURIComponent(user.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureReg ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({
        ok: true,
        user: toPublicUserDTO(user),
        sessionToken: user.sessionToken,
        recoveryPhrase: regResult.recoveryPhrase,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 3. User Login
  if ((url.pathname === '/api/user/login' || url.pathname === '/api/auth/login') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      let identifier = String(parsed.identifier || parsed.handle || parsed.did || '').trim();
      if (!identifier) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Identifier (handle or DID) is required' }));
        return true;
      }
      if (!identifier.startsWith('did:') && !identifier.startsWith('@')) {
        identifier = '@' + identifier;
      }
      const deviceName = String(parsed.device || parsed.deviceName || (req.headers['user-agent']?.includes('Mobile') ? 'Mobile Node' : 'Web Session'));
      const pin = parsed.securityPin ? String(parsed.securityPin).trim() : (parsed.pin ? String(parsed.pin).trim() : undefined);
      const totpCode = parsed.totpCode ? String(parsed.totpCode).trim() : undefined;

      const loginRes = sovraDb.loginUser(identifier, deviceName, clientIp, req.headers['user-agent'] as string, {
        pin,
        totpCode,
        bypassPin: parsed.bypassPin === true,
      });

      if (!loginRes.ok || !loginRes.user) {
        res.writeHead(loginRes.code || 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: loginRes.error,
          requiresTotp: loginRes.requiresTotp || false,
          remainingAttempts: loginRes.remainingAttempts,
        }));
        return true;
      }

      const isSecureLogin = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          `sovra_session=${encodeURIComponent(loginRes.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureLogin ? '; Secure' : ''}`,
          `sovra_session_token=${encodeURIComponent(loginRes.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureLogin ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({
        ok: true,
        user: toPublicUserDTO(loginRes.user),
        sessionToken: loginRes.sessionToken,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 4. WebAuthn Registration Options
  if (url.pathname === '/api/auth/webauthn/register-options' && req.method === 'GET') {
    const principal = enforceAuth(req, res);
    let user = principal ? sovraDb.findUserByDid(principal.did) : undefined;
    const handleParam = url.searchParams.get('handle') || url.searchParams.get('identifier');
    if (!user && handleParam) {
      user = sovraDb.findUserByHandle(handleParam) || sovraDb.findUserByDid(handleParam);
    }
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'User session or identifier required to generate biometric options' }));
      return true;
    }
    const host = (req.headers.host || 'localhost').split(':')[0];
    const options = generateRegistrationOptions(user, host);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, options }));
    return true;
  }

  // 5. WebAuthn Registration Verify
  if (url.pathname === '/api/auth/webauthn/register-verify' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      let user = principal ? sovraDb.findUserByDid(principal.did) : undefined;
      if (!user && parsed.identifier) {
        user = sovraDb.findUserByHandle(parsed.identifier) || sovraDb.findUserByDid(parsed.identifier);
      }
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User session required to register biometric credentials' }));
        return true;
      }
      const host = (req.headers.host || 'localhost').split(':')[0];
      const verifyRes = verifyRegistrationResponse(parsed, host);
      if (!verifyRes.ok || !verifyRes.credential) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: verifyRes.error || 'Biometric verification failed' }));
        return true;
      }
      sovraDb.addWebauthnCredential(user.did, verifyRes.credential);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        credentialId: verifyRes.credential.id,
        message: 'Biometric passkey (Fingerprint/Face ID) linked successfully!'
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid payload' }));
    }
    return true;
  }

  // 6. WebAuthn Login Options
  if (url.pathname === '/api/auth/webauthn/login-options' && req.method === 'GET') {
    const handleParam = url.searchParams.get('handle') || url.searchParams.get('identifier');
    let user: UserRecord | undefined;
    if (handleParam) {
      user = sovraDb.findUserByHandle(handleParam) || sovraDb.findUserByDid(handleParam);
    }
    const host = (req.headers.host || 'localhost').split(':')[0];
    const options = generateLoginOptions(user, host);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, options }));
    return true;
  }

  // 7. WebAuthn Login Verify
  if (url.pathname === '/api/auth/webauthn/login-verify' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      let user: UserRecord | undefined;
      if (parsed.identifier) {
        user = sovraDb.findUserByHandle(parsed.identifier) || sovraDb.findUserByDid(parsed.identifier);
      }
      if (!user && parsed.id) {
        user = sovraDb.findUserByWebauthnCredentialId(parsed.id);
      }
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No sovereign account found for this biometric passkey' }));
        return true;
      }
      const creds = user.webauthnCredentials || [];
      const verifyRes = verifyLoginResponse(parsed, creds);
      if (!verifyRes.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: verifyRes.error || 'Biometric authentication failed' }));
        return true;
      }
      const deviceName = String(parsed.device || (req.headers['user-agent']?.includes('Mobile') ? 'Mobile Biometric' : 'Desktop Biometric'));
      const loginRes = sovraDb.loginUser(user.handle, deviceName, clientIp, req.headers['user-agent'] as string, { webauthnVerified: true });
      if (!loginRes.ok || !loginRes.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: loginRes.error || 'Session creation failed' }));
        return true;
      }
      const isSecureWebAuthn = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          `sovra_session=${encodeURIComponent(loginRes.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureWebAuthn ? '; Secure' : ''}`,
          `sovra_session_token=${encodeURIComponent(loginRes.sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecureWebAuthn ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({
        ok: true,
        user: toPublicUserDTO(loginRes.user),
        sessionToken: loginRes.sessionToken,
        message: 'Biometric passkey verified!'
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid assertion payload' }));
    }
    return true;
  }

  // 8. Delete WebAuthn Credentials
  if (url.pathname === '/api/auth/webauthn/credentials' && req.method === 'DELETE') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;
    const user = sovraDb.findUserByDid(principal.did);
    if (!user) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'User not found' }));
      return true;
    }
    const credId = url.searchParams.get('id');
    if (credId) {
      sovraDb.removeWebauthnCredential(user.did, credId);
    } else {
      user.webauthnCredentials = [];
      sovraDb.save();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Biometric credential removed' }));
    return true;
  }

  // 9. TOTP Setup
  if (url.pathname === '/api/auth/totp/setup' && req.method === 'GET') {
    const principal = enforceAuth(req, res);
    if (!principal) return true;
    const user = sovraDb.findUserByDid(principal.did);
    if (!user) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'User not found' }));
      return true;
    }
    if (!user.totpSecret) {
      user.totpSecret = sovraDb.generateTotpSecret();
      sovraDb.save();
    }
    const otpauthUri = sovraDb.getTotpUri(user.handle, user.totpSecret);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      secret: user.totpSecret,
      otpauthUri,
      totpEnabled: Boolean(user.totpEnabled),
    }));
    return true;
  }

  // 10. TOTP Verify / Enable
  if (url.pathname === '/api/auth/totp/verify' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const totpCode = String(parsed.totpCode || parsed.code || '').trim();
      if (!totpCode) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '6-digit Authenticator code is required' }));
        return true;
      }
      const verifyRes = sovraDb.enableUserTotp(principal.did, totpCode);
      if (!verifyRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: verifyRes.error || 'Invalid 6-digit Authenticator code' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Google Authenticator 2FA enabled successfully!' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 11. TOTP Disable
  if (url.pathname === '/api/auth/totp/disable' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const pin = String(parsed.pin || '').trim();
      const disableRes = sovraDb.disableUserTotp(principal.did, pin);
      if (!disableRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: disableRes.error || 'Failed to disable 2FA' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '2FA disabled successfully' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 12. Security PIN Update
  if (url.pathname === '/api/auth/pin/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const oldPin = String(parsed.oldPin || '').trim();
      const newPin = String(parsed.newPin || '').trim();
      const forceSync = Boolean(parsed.forceSync);
      const updateRes = sovraDb.updateSecurityPin(principal.did, oldPin, newPin, forceSync);
      if (!updateRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: updateRes.error || 'Failed to update PIN' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Security PIN updated successfully!' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 13. Security PIN Recover with Mnemonic
  if (url.pathname === '/api/auth/pin/recover' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const identifier = String(parsed.identifier || parsed.handle || parsed.did || '').trim();
      const recoveryPhrase = String(parsed.recoveryPhrase || parsed.phrase || '').trim();
      const newPin = String(parsed.newPin || '').trim();
      if (!identifier || !recoveryPhrase || !newPin) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Identifier, 12-word recovery phrase, and new PIN are all required.' }));
        return true;
      }
      const recoverRes = sovraDb.resetSecurityPinWithRecoveryPhrase(identifier, recoveryPhrase, newPin);
      if (!recoverRes.ok) {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(JSON.stringify({ ok: false, error: recoverRes.error || 'Invalid recovery credentials.' }));
        return true;
      }
      const isSecure = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Set-Cookie': [
          `sovra_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`,
          `sovra_session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({ ok: true, message: 'Security PIN reset successfully! All active sessions have been revoked. Please log in with your new PIN.' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 14. User Logout
  if ((url.pathname === '/api/user/logout' || url.pathname === '/api/auth/logout') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = body ? JSON.parse(body) : {};
      const authHeader = req.headers.authorization;
      let token = '';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (req.headers['x-sovra-session-token']) {
        token = String(req.headers['x-sovra-session-token']).trim();
      } else if (parsed.sessionToken) {
        token = String(parsed.sessionToken).trim();
      }
      if (!token && req.headers.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)(?:sovra_session|sovra_session_token)=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]).trim();
      }
      if (token) {
        sovraDb.logoutUser(token);
      }
      const isSecureLogout = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          `sovra_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecureLogout ? '; Secure' : ''}`,
          `sovra_session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecureLogout ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 15. Permanent Account Deletion
  if ((url.pathname === '/api/user/delete' || url.pathname === '/api/user/account/delete') && (req.method === 'POST' || req.method === 'DELETE')) {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = body ? JSON.parse(body) : {};
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const deleteResult = sovraDb.deleteUserAccount(principal.did);
      if (!deleteResult.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: deleteResult.error || 'Failed to delete account' }));
        return true;
      }

      if (ctx.dynamicSocialStore) {
        ctx.dynamicSocialStore.posts = sovraDb.getAllPosts();
        ctx.dynamicSocialStore.channels = sovraDb.getAllChannels();
        ctx.dynamicSocialStore.pages = sovraDb.getAllPages();
      }

      res.setHeader('Set-Cookie', [
        'sovra_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
        'sovra_session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deletedDid: principal.did, message: 'Account and associated data deleted permanently' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 16. Get Full Profile Aggregate
  if (url.pathname === '/api/user/profile' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (req.headers.authorization && !principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Invalid or revoked session token' }));
      return true;
    }
    const viewerDid = principal?.did;
    let targetDid = url.searchParams.get('did') || '';
    const targetHandle = url.searchParams.get('handle') || '';

    if (!targetDid && targetHandle) {
      const found = sovraDb.findUserByHandle(targetHandle);
      if (found) targetDid = found.did;
    }

    if (targetDid && !targetDid.startsWith('did:')) {
      const found = sovraDb.findUserByHandle(targetDid) || sovraDb.getState().users.find(u =>
        u.handle.toLowerCase() === targetDid.toLowerCase() ||
        u.handle.toLowerCase() === ('@' + targetDid).toLowerCase() ||
        (u.displayName && u.displayName.toLowerCase() === targetDid.toLowerCase()) ||
        ((u as any).name && (u as any).name.toLowerCase() === targetDid.toLowerCase())
      );
      if (found) targetDid = found.did;
    }

    if (!targetDid) {
      if (viewerDid) {
        targetDid = viewerDid;
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'did or handle required' }));
        return true;
      }
    }

    const profile = sovraDb.getUserProfile(targetDid, viewerDid);
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'User not found' }));
      return true;
    }

    if (profile.isBlocked) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        isBlocked: true,
        relationship: profile.relationship,
        user: profile.user || {
          did: targetDid,
          displayName: 'Blocked Peer',
          handle: '@blocked',
          avatar: '🔒',
          avatarBg: '#64748b',
          bio: 'This peer is unavailable',
        },
        stats: {
          followersCount: 0,
          followingCount: 0,
          friendsCount: 0,
          mutualFriendsCount: 0,
          postsCount: 0,
          channelsCount: 0,
          pagesCount: 0,
          groupsCount: 0,
        },
        posts: [],
        channels: [],
        pages: [],
        groups: [],
        error: 'User is blocked',
      }));
      return true;
    }

    if (!profile.ok) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: profile.error || 'User not found' }));
      return true;
    }

    if (profile.isPrivate) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        isBlocked: false,
        isPrivate: true,
        user: profile.user,
        stats: profile.stats,
        relationship: profile.relationship,
        posts: [],
        channels: [],
        pages: [],
        groups: [],
      }));
      return true;
    }

    const posts = sovraDb.getUserPosts(targetDid, viewerDid);
    const spaces = sovraDb.getUserSpaces(targetDid);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      isBlocked: false,
      isPrivate: false,
      user: profile.user,
      stats: profile.stats,
      relationship: profile.relationship,
      posts,
      channels: spaces.channels,
      pages: spaces.pages,
      groups: spaces.groups,
    }));
    return true;
  }

  // 17. User Profile Update
  if (url.pathname === '/api/user/update' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 15 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const targetDid = principal.did;
      if (parsed.handle !== undefined) {
        const valRes = sovraDb.validateHandle(String(parsed.handle), targetDid);
        if (!valRes.valid) {
          const status = (valRes.error?.includes('already in use') || valRes.error?.includes('already claimed')) ? 409 : 400;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: valRes.error }));
          return true;
        }
      }
      const existingUser = sovraDb.findUserByDid(targetDid);
      const cleanHandle = parsed.handle ? (String(parsed.handle).startsWith('@') ? String(parsed.handle).trim() : '@' + String(parsed.handle).trim()) : (existingUser?.handle || '@user');
      const cleanAvatarDataUrl = parsed.avatarDataUrl !== undefined 
        ? (parsed.avatarDataUrl && parsed.avatarDataUrl !== 'remove' ? String(parsed.avatarDataUrl) : '') 
        : undefined;
      const cleanCoverDataUrl = parsed.coverDataUrl !== undefined 
        ? (parsed.coverDataUrl && parsed.coverDataUrl !== 'remove' ? String(parsed.coverDataUrl) : '') 
        : undefined;
      const user = sovraDb.upsertUser({
        did: targetDid,
        handle: cleanHandle,
        displayName: String(parsed.name || parsed.displayName || existingUser?.displayName || 'Sovereign Peer'),
        avatar: String(parsed.avatar || existingUser?.avatar || 'S'),
        avatarDataUrl: cleanAvatarDataUrl,
        avatarBg: String(parsed.avatarBg || existingUser?.avatarBg || '#6366f1'),
        bio: String(parsed.bio !== undefined ? parsed.bio : (existingUser?.bio || '')),
        website: String(parsed.website !== undefined ? parsed.website : (parsed.websiteUrl !== undefined ? parsed.websiteUrl : (existingUser?.website || ''))),
        websiteUrl: String(parsed.websiteUrl !== undefined ? parsed.websiteUrl : (parsed.website !== undefined ? parsed.website : (existingUser?.websiteUrl || existingUser?.website || ''))),
        coverDataUrl: cleanCoverDataUrl,
        deviceType: parsed.device === 'Mobile' || parsed.deviceType === 'Mobile' ? 'Mobile' : (existingUser?.deviceType || 'Desktop'),
        sessionToken: existingUser?.sessionToken,
        publicKey: parsed.publicKey ? String(parsed.publicKey) : existingUser?.publicKey,
        privacySettings: parsed.privacySettings || existingUser?.privacySettings,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: toPublicUserDTO(user) }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 18. User Privacy Settings
  if (url.pathname === '/api/user/privacy' && (req.method === 'POST' || req.method === 'GET')) {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Authentication required' }));
      return true;
    }
    if (req.method === 'GET') {
      const user = sovraDb.findUserByDid(principal.did);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        privacySettings: user?.privacySettings || {
          profileVisibility: 'public',
          canMessageMe: 'public',
          canSendFriendRequests: 'public',
          showOnlineStatus: true,
          showFollowers: true,
        },
      }));
      return true;
    }
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const result = sovraDb.updateUserPrivacy(principal.did, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, privacySettings: result.user?.privacySettings }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 19. Upload Avatar
  if (url.pathname === '/api/user/upload-avatar' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 10 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const did = principal.did;
      const avatarDataUrl = String(parsed.avatarDataUrl || '').trim();
      if (!avatarDataUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'avatarDataUrl is required' }));
        return true;
      }

      let avatarUrl = '';
      try {
        const commaIdx = avatarDataUrl.indexOf(',');
        const base64Data = commaIdx >= 0 ? avatarDataUrl.slice(commaIdx + 1) : avatarDataUrl;
        const imgBuffer = Buffer.from(base64Data, 'base64');
        const magicCheck = validateMagic(imgBuffer);
        if (!magicCheck.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Invalid image payload: ${magicCheck.error || 'Magic byte signature mismatch'}` }));
          return true;
        }
        const safeDid = did.replace(/[^a-zA-Z0-9_]/g, '_');
        const filename = `avatar_${safeDid}_${Date.now()}.webp`;
        const filePath = path.join(avatarsDir, filename);
        fs.writeFileSync(filePath, imgBuffer);
        avatarUrl = `/api/user/avatar/${filename}`;
      } catch (writeErr) {
        console.warn('[Storage] Failed to save avatar file to disk:', writeErr);
      }

      const user = sovraDb.updateUserAvatar(did, avatarDataUrl);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User not found' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: toPublicUserDTO(user), avatarUrl }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 20. Serve Avatar Image
  if (url.pathname.startsWith('/api/user/avatar/') && req.method === 'GET') {
    const filename = path.basename(url.pathname);
    const filePath = path.join(avatarsDir, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Avatar not found' }));
    }
    return true;
  }

  // 21. Remove Avatar
  if (url.pathname === '/api/user/remove-avatar' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const did = principal.did;
      const user = sovraDb.updateUserAvatar(did, '');
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: toPublicUserDTO(user) }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 22. Upload Cover
  if (url.pathname === '/api/user/upload-cover' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 10 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const did = principal.did;
      const coverDataUrl = String(parsed.coverDataUrl || '').trim();
      if (!coverDataUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'coverDataUrl is required' }));
        return true;
      }

      let coverUrl = '';
      try {
        const commaIdx = coverDataUrl.indexOf(',');
        const base64Data = commaIdx >= 0 ? coverDataUrl.slice(commaIdx + 1) : coverDataUrl;
        const imgBuffer = Buffer.from(base64Data, 'base64');
        const magicCheck = validateMagic(imgBuffer);
        if (!magicCheck.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Invalid image payload: ${magicCheck.error || 'Magic byte signature mismatch'}` }));
          return true;
        }
        const safeDid = did.replace(/[^a-zA-Z0-9_]/g, '_');
        const filename = `cover_${safeDid}_${Date.now()}.webp`;
        const filePath = path.join(coversDir, filename);
        fs.writeFileSync(filePath, imgBuffer);
        coverUrl = `/api/user/cover/${filename}`;
      } catch (writeErr) {
        console.warn('[Storage] Failed to save cover file to disk:', writeErr);
      }

      const user = sovraDb.updateUserCover(did, coverDataUrl);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User not found' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: toPublicUserDTO(user), coverUrl }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 23. Remove Cover
  if (url.pathname === '/api/user/remove-cover' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const did = principal.did;
      const user = sovraDb.updateUserCover(did, '');
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: toPublicUserDTO(user) }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 24. Serve Cover Image
  if (url.pathname.startsWith('/api/user/cover/') && req.method === 'GET') {
    const filename = path.basename(url.pathname);
    const filePath = path.join(coversDir, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Cover not found' }));
    }
    return true;
  }

  // 25. Check Handle
  if (url.pathname === '/api/user/check-handle' && req.method === 'GET') {
    const handle = url.searchParams.get('handle') || '';
    const excludeDid = url.searchParams.get('excludeDid') || undefined;
    if (!handle) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Handle query param is required' }));
      return true;
    }
    const isTaken = sovraDb.isHandleTaken(handle, excludeDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, handle, isAvailable: !isTaken, available: !isTaken }));
    return true;
  }

  // 26. User Me Endpoint
  if (url.pathname === '/api/user/me' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const did = url.searchParams.get('did') || '';
    const handle = url.searchParams.get('handle') || '';
    let user: any = null;
    if (did) {
      user = sovraDb.findUserByDid(did);
    } else if (handle) {
      user = sovraDb.findUserByHandle(handle);
    } else if (principal) {
      user = sovraDb.findUserByDid(principal.did);
    }
    if (!user && (did || handle)) {
      if (handle === '@laptop_host' || did === 'did:sovra:laptop_host') {
        user = sovraDb.getAllUsers().find(u => u.handle === '@laptop_host' || u.did === 'did:sovra:laptop_host') || null;
      }
      if (!user) {
        const rawHandle = handle || (did ? '@peer_' + did.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : '@creator_node');
        const cleanHandle = rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle;
        const cleanName = cleanHandle.replace(/^@/, '');
        const newDid = did || principal?.did || ('did:sovra:' + cleanName);
        user = sovraDb.createUser({
          did: newDid,
          handle: cleanHandle,
          name: cleanName,
          displayName: cleanName,
          bio: 'Sovereign Social & Creator Node',
          avatar: '💻',
          avatarBg: '#0284c7',
          role: 'creator',
          sessionToken: 'stk_' + Date.now(),
        });
      }
    }
    if (!user && !did && !handle) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: No active session' }));
      return true;
    }
    const userDTO: any = toPublicUserDTO(user);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user: userDTO }));
    return true;
  }

  // 27. Recovery Phrase Policy
  if (url.pathname === '/api/user/recovery-phrase' && req.method === 'GET') {
    res.writeHead(403, {
      'Content-Type': 'application/json',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(JSON.stringify({
      ok: false,
      error: 'Passphrase Security Policy: Master recovery phrases are never stored or exportable from the server. Use your offline backup recorded during registration.',
    }));
    return true;
  }

  // 28. Restore Identity from Mnemonic
  if (url.pathname === '/api/user/restore-mnemonic' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const phrase = String(parsed.recoveryPhrase || parsed.phrase || '').trim();
      if (!phrase) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '12-word recovery phrase is required' }));
        return true;
      }

      const words = phrase.split(/\s+/).filter(Boolean);
      if (words.length < 12) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Recovery phrase must contain at least 12 words' }));
        return true;
      }

      let user = sovraDb.findUserByRecoveryPhrase(phrase);
      if (!user) {
        const normInput = words.join(' ').toLowerCase();
        user = sovraDb.getAllUsers().find(u => {
          if (!u.recoveryPhrase) return false;
          return u.recoveryPhrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ') === normInput;
        });
      }

      if (!user) {
        const seedHash = crypto.createHash('sha256').update(words.join(' ').toLowerCase()).digest('hex');
        const derivedDid = 'did:sovra:seed_' + seedHash.slice(0, 16);
        const derivedHandle = '@citizen_' + seedHash.slice(0, 8);
        const newToken = 'stk_' + crypto.randomBytes(24).toString('hex');
        const { hash: recHash, salt: recSalt } = sovraDb.hashRecoveryPhrase(words.join(' ').toLowerCase());

        user = sovraDb.upsertUser({
          did: derivedDid,
          handle: derivedHandle,
          displayName: 'Sovereign Pioneer',
          avatar: '🚀',
          avatarBg: '#6366f1',
          sessionToken: newToken,
          recoveryPhraseHash: recHash,
          recoveryPhraseSalt: recSalt,
          balanceSov: 500.0,
        });
      } else if (!user.sessionToken) {
        const newToken = 'stk_' + crypto.randomBytes(24).toString('hex');
        user.sessionToken = newToken;
        sovraDb.upsertUser(user);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify({
        ok: true,
        user: toPublicUserDTO(user),
        sessionToken: user.sessionToken,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 29. List Users
  if (url.pathname === '/api/user/list' && req.method === 'GET') {
    const users = sovraDb.getAllUsers().map(u => toPublicUserDTO(u));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, users }));
    return true;
  }

  // 30. Active User Sessions
  if (url.pathname === '/api/user/sessions' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Authentication required' }));
      return true;
    }
    const sessions = sovraDb.getUserSessions(principal.did);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        id: s.sessionId,
        deviceName: s.deviceName,
        deviceType: s.deviceType,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        isCurrent: s.token === principal.sessionId,
        isRevoked: s.isRevoked,
        status: s.isRevoked ? 'revoked' : 'active',
      })),
    }));
    return true;
  }

  // 31. Revoke User Session (Remote Logout / Wipe)
  if ((url.pathname === '/api/user/sessions/revoke' || url.pathname === '/api/session/revoke') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const sessionId = String(parsed.sessionId || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'sessionId required' }));
        return true;
      }

      const revoked = sovraDb.revokeSession(sessionId, principal.did);
      if (!revoked) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found or not owned by user' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Session successfully revoked' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 32. Create Device Linking Ticket
  if (url.pathname === '/api/user/sessions/create-link-ticket' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const ticket = 'slt_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
      const expiresAt = Date.now() + 10 * 60 * 1000;
      deviceLinkTickets.set(ticket, {
        did: principal.did,
        handle: principal.handle,
        createdAt: Date.now(),
        expiresAt
      });

      const qrPayload = JSON.stringify({
        action: 'sovra_link_device',
        ticket,
        did: principal.did,
        handle: principal.handle,
        host: req.headers.host || '127.0.0.1:3001',
        expiresAt
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        ticket,
        expiresAt,
        qrPayload,
        did: principal.did
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid request' }));
    }
    return true;
  }

  // 33. Claim Device Linking Ticket
  if (url.pathname === '/api/user/sessions/claim-link-ticket' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const ticket = String(parsed.ticket || '').trim();
      if (!ticket || !deviceLinkTickets.has(ticket)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid or expired device linking ticket' }));
        return true;
      }

      const ticketInfo = deviceLinkTickets.get(ticket)!;
      if (Date.now() > ticketInfo.expiresAt) {
        deviceLinkTickets.delete(ticket);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Device linking ticket has expired' }));
        return true;
      }

      const user = sovraDb.findUserByDid(ticketInfo.did);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User identity not found' }));
        return true;
      }

      const newToken = 'stk_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
      const deviceName = String(parsed.deviceName || (parsed.deviceType === 'Mobile' ? 'Companion Mobile Phone' : 'Linked Secondary Browser'));
      const deviceType = (parsed.deviceType === 'Mobile' || parsed.deviceType === 'Tablet') ? parsed.deviceType : 'Desktop';

      const sessionRecord = sovraDb.createSession({
        userDid: user.did,
        token: newToken,
        deviceName,
        deviceType,
        ipAddress: (req.socket as any)?.remoteAddress || '127.0.0.1'
      });

      deviceLinkTickets.delete(ticket);

      const isSecure = Boolean((req.socket as any)?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [
          `sovra_session=${encodeURIComponent(newToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecure ? '; Secure' : ''}`,
          `sovra_session_token=${encodeURIComponent(newToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecure ? '; Secure' : ''}`,
        ],
      });
      res.end(JSON.stringify({
        ok: true,
        sessionToken: newToken,
        sessionId: sessionRecord.sessionId,
        did: user.did,
        handle: user.handle,
        user: {
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          avatar: user.avatar,
          publicKey: user.publicKey
        },
        message: 'Device successfully paired'
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 34. User Settings
  if (url.pathname === '/api/user/settings' && req.method === 'GET') {
    try {
      const principal = resolvePrincipal(req);
      const targetDid = url.searchParams.get('did') || (principal ? principal.did : ctx.masterKey?.did);
      const settings = sovraDb.getUserSettings(targetDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, settings }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Server error' }));
    }
    return true;
  }

  if (url.pathname === '/api/user/settings' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const principal = resolvePrincipal(req);
      const targetDid = url.searchParams.get('did') || (principal ? principal.did : ctx.masterKey?.did);
      const parsed = JSON.parse(body || '{}');
      const updated = sovraDb.setUserSettings(targetDid, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, settings: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  return false;
}
