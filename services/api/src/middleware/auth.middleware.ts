/**
 * 👑 SOVRA PROTOCOL - CRYPTOGRAPHIC AUTHENTICATION MIDDLEWARE
 * File: services/api/src/middleware/auth.middleware.ts
 *
 * Implements:
 * 1. Bearer session token verification via AuthController session registry
 * 2. Ed25519 request signature verification (x-sovra-signature, x-sovra-did, etc.)
 * 3. Scoped anti-replay protection with memory-bounded LRU cache and timestamp skew validation
 * 4. Request body hashing (SHA-256) and canonical signing format binding
 * 5. Strict rejection of raw/unauthenticated x-sovra-did headers
 */

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authController } from '../controllers/auth.controller.js';

export interface ApiPrincipal {
  did: string;
  role: 'citizen' | 'creator' | 'admin' | 'guest' | 'SUPER_ADMIN' | 'USER';
  authenticationMethod: 'BEARER_TOKEN' | 'ED25519_SIGNATURE';
  sessionId?: string;
}

// Scoped anti-replay cache: key = `${did}:${nonce}`, value = expiresAt (timestamp)
const replayNonceCache = new Map<string, number>();
const MAX_REPLAY_CACHE_SIZE = 10000;
const MAX_TIMESTAMP_SKEW_MS = 300_000; // 5 minutes

export function checkAndRecordReplayNonce(did: string, nonce: string, timestamp: number): boolean {
  if (!did || !nonce || isNaN(timestamp)) return false;
  const now = Date.now();
  if (timestamp < now - MAX_TIMESTAMP_SKEW_MS || timestamp > now + 60_000) {
    return false; // Skew or expiration violated
  }

  // Prune expired
  if (replayNonceCache.size > MAX_REPLAY_CACHE_SIZE) {
    for (const [k, exp] of replayNonceCache) {
      if (exp < now) replayNonceCache.delete(k);
    }
  }

  const scopedKey = `${did}:${nonce}`;
  if (replayNonceCache.has(scopedKey)) {
    return false; // Replay attack detected
  }

  replayNonceCache.set(scopedKey, timestamp + 360_000);
  return true;
}

export function clearReplayNonceCache(): void {
  replayNonceCache.clear();
}

// Base58-BTC alphabet for did:key decoding
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(str: string): Uint8Array {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const val = B58_ALPHABET.indexOf(c!);
    if (val === -1) throw new Error('Invalid Base58 character');
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] = bytes[j]! * 58;
    }
    bytes[0] = bytes[0]! + val;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      const sum = bytes[j]! + carry;
      bytes[j] = sum % 256;
      carry = Math.floor(sum / 256);
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function decodeEd25519PublicKey(did: string): Buffer | null {
  try {
    if (did.startsWith('did:key:z')) {
      const b58 = did.slice('did:key:z'.length);
      const decoded = decodeBase58(b58);
      // Expect 34 bytes: [0xed, 0x01, ...32 bytes raw public key]
      if (decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01) {
        return Buffer.from(decoded.slice(2));
      }
      if (decoded.length === 32) {
        return Buffer.from(decoded);
      }
    }
    const clean = did.replace(/^did:sovra:/, '');
    if (/^[0-9a-fA-F]{64}$/.test(clean)) {
      return Buffer.from(clean, 'hex');
    }
  } catch {
    return null;
  }
  return null;
}

export async function bufferRequestBody(req: IncomingMessage): Promise<string> {
  if ((req as any).rawBody !== undefined) {
    return (req as any).rawBody;
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      (req as any).rawBody = data;
      resolve(data);
    });
    req.on('error', reject);
  });
}

export class AuthMiddleware {
  /**
   * Resolves the authenticated principal from incoming HTTP request.
   * NEVER trusts raw headers without verification.
   */
  public async authenticate(req: IncomingMessage): Promise<ApiPrincipal | null> {
    // 1. Check Bearer Token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const session = authController.getSession(token);
      if (session) {
        const principal: ApiPrincipal = {
          did: session.did,
          role: session.role === 'admin' ? 'admin' : 'USER',
          authenticationMethod: 'BEARER_TOKEN',
          sessionId: session.sessionToken,
        };
        (req as any).principal = principal;
        return principal;
      }
    }

    // 2. Check Ed25519 Request Signature
    const sigHeader = (req.headers['x-sovra-signature'] as string)?.trim();
    if (sigHeader) {
      const sigDid = (req.headers['x-sovra-did'] as string)?.trim();
      const tsHeader = (req.headers['x-sovra-timestamp'] as string)?.trim();
      const nonceHeader = (req.headers['x-sovra-nonce'] as string)?.trim();

      if (!sigDid || !tsHeader || !nonceHeader) {
        return null;
      }

      const timestamp = Number(tsHeader);
      if (isNaN(timestamp)) return null;

      // Anti-replay check
      if (!checkAndRecordReplayNonce(sigDid, nonceHeader, timestamp)) {
        return null;
      }

      const rawPubKey = decodeEd25519PublicKey(sigDid);
      if (!rawPubKey || rawPubKey.length !== 32) {
        return null;
      }

      // Convert raw 32-byte Ed25519 public key to DER SubjectPublicKeyInfo format for crypto.verify
      const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const derKey = Buffer.concat([derPrefix, rawPubKey]);

      // Ensure request body is read and preserved
      if ((req as any).rawBody === undefined && req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          await bufferRequestBody(req);
        } catch {
          return null;
        }
      }

      const rawBody = (req as any).rawBody || '';
      const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');

      const method = (req.method || 'GET').toUpperCase();
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const queryEntries = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
      const query = queryEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

      const canonicalString = `SOVRA-REQ-V2\n${method}\n${pathname}\n${query}\n${bodyHash}\n${sigDid}\n${nonceHeader}\n${tsHeader}`;
      const canonicalBytes = Buffer.from(canonicalString, 'utf8');

      try {
        const sigBytes = Buffer.from(sigHeader, 'hex');
        const pubKeyObj = crypto.createPublicKey({
          key: derKey,
          format: 'der',
          type: 'spki',
        });
        const isValid = crypto.verify(null, canonicalBytes, pubKeyObj, sigBytes);
        if (!isValid) return null;

        const principal: ApiPrincipal = {
          did: sigDid,
          role: 'USER',
          authenticationMethod: 'ED25519_SIGNATURE',
          sessionId: `sig_${nonceHeader}`,
        };
        (req as any).principal = principal;
        return principal;
      } catch {
        return null;
      }
    }

    // Direct header trust is strictly forbidden
    return null;
  }

  /**
   * Express/Connect-style guard that enforces authentication.
   * Attaches req.principal or sends 401.
   */
  public async requireAuth(req: IncomingMessage, res: ServerResponse): Promise<ApiPrincipal | null> {
    const principal = await this.authenticate(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return null;
    }
    (req as any).principal = principal;
    return principal;
  }
}

export const authMiddleware = new AuthMiddleware();
