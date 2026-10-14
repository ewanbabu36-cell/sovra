/**
 * Sovra Protocol - Native WebAuthn & Hardware Enclave Passkey Engine
 * File: scripts/webauthn-engine.ts
 *
 * Implements FIDO2 / WebAuthn Level 3 Native Biometric Authentication:
 * - W3C WebAuthn navigator.credentials.create (Registration / Attestation)
 * - W3C WebAuthn navigator.credentials.get (Assertion / Login)
 * - Hardware Biometric Prompt (Android Fingerprint/Face, Apple Face ID / Touch ID, Windows Hello)
 * - Zero external dependencies: Built-in pure-TypeScript CBOR & COSE parsing + Node.js crypto
 */

import crypto from 'node:crypto';
import type { UserRecord, WebAuthnCredentialRecord } from './database-engine.ts';

// ==========================================
// 1. BASE64URL & BUFFER UTILITIES
// ==========================================

export function toBase64Url(buf: Buffer | Uint8Array | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf-8') : Buffer.from(buf);
  return b.toString('base64url');
}

export function fromBase64Url(str: string): Buffer {
  if (!str) return Buffer.alloc(0);
  return Buffer.from(str, 'base64url');
}

// ==========================================
// 2. STANDARDS-COMPLIANT CBOR DECODER (RFC 8949)
// ==========================================

export function decodeCbor(buf: Buffer | Uint8Array): any {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let offset = 0;

  function read(): any {
    if (offset >= b.length) throw new Error('Unexpected EOF decoding CBOR');
    const first = b[offset++];
    const major = first >> 5;
    let val = first & 31;

    if (val === 24) {
      if (offset >= b.length) throw new Error('Unexpected EOF in CBOR uint8');
      val = b[offset++];
    } else if (val === 25) {
      if (offset + 1 >= b.length) throw new Error('Unexpected EOF in CBOR uint16');
      val = (b[offset++] << 8) | b[offset++];
    } else if (val === 26) {
      if (offset + 3 >= b.length) throw new Error('Unexpected EOF in CBOR uint32');
      val = (b[offset++] * 2 ** 24) + (b[offset++] << 16) + (b[offset++] << 8) + b[offset++];
    } else if (val === 27) {
      if (offset + 7 >= b.length) throw new Error('Unexpected EOF in CBOR uint64');
      const hi = (b[offset++] * 2 ** 24) + (b[offset++] << 16) + (b[offset++] << 8) + b[offset++];
      const lo = (b[offset++] * 2 ** 24) + (b[offset++] << 16) + (b[offset++] << 8) + b[offset++];
      val = hi * 2 ** 32 + lo;
    }

    // Major 0: Unsigned Integer
    if (major === 0) return val;

    // Major 1: Negative Integer (-1 - val)
    if (major === 1) return -1 - val;

    // Major 2: Byte String
    if (major === 2) {
      if (offset + val > b.length) throw new Error('Unexpected EOF reading CBOR byte string');
      const data = b.subarray(offset, offset + val);
      offset += val;
      return data;
    }

    // Major 3: Text String (UTF-8)
    if (major === 3) {
      if (offset + val > b.length) throw new Error('Unexpected EOF reading CBOR text string');
      const data = b.subarray(offset, offset + val).toString('utf-8');
      offset += val;
      return data;
    }

    // Major 4: Array
    if (major === 4) {
      const arr: any[] = [];
      for (let i = 0; i < val; i++) arr.push(read());
      return arr;
    }

    // Major 5: Map
    if (major === 5) {
      const map = new Map<any, any>();
      for (let i = 0; i < val; i++) {
        const k = read();
        const v = read();
        map.set(k, v);
      }
      return map;
    }

    // Major 6: Tagged Item (skip tag number, return data item)
    if (major === 6) {
      return read();
    }

    // Major 7: Floats & Simple Values
    if (major === 7) {
      if (val === 20) return false;
      if (val === 21) return true;
      if (val === 22) return null;
      if (val === 23) return undefined;
      return undefined;
    }

    throw new Error(`Unsupported CBOR major type: ${major}`);
  }

  return read();
}

// ==========================================
// 3. COSE KEY TO JWK CONVERTER
// ==========================================

export function coseKeyToJwk(coseMap: Map<any, any>): Record<string, any> {
  const kty = coseMap.get(1); // 2 = EC2, 3 = RSA, 1 = OKP
  const alg = coseMap.get(3); // -7 = ES256, -257 = RS256, -8 = Ed25519

  if (kty === 2) {
    // EC2 Key (P-256)
    const crvId = coseMap.get(-1); // 1 = P-256
    const x = coseMap.get(-2);
    const y = coseMap.get(-3);
    if (!x || !y) throw new Error('Missing x or y coordinate in EC2 COSE key');
    return {
      kty: 'EC',
      crv: crvId === 1 ? 'P-256' : 'P-256',
      x: Buffer.from(x).toString('base64url'),
      y: Buffer.from(y).toString('base64url'),
      alg: alg === -7 ? 'ES256' : undefined,
    };
  }

  if (kty === 3) {
    // RSA Key
    const n = coseMap.get(-1);
    const e = coseMap.get(-2);
    if (!n || !e) throw new Error('Missing modulus or exponent in RSA COSE key');
    return {
      kty: 'RSA',
      n: Buffer.from(n).toString('base64url'),
      e: Buffer.from(e).toString('base64url'),
      alg: alg === -257 ? 'RS256' : undefined,
    };
  }

  if (kty === 1) {
    // OKP (Ed25519)
    const crvId = coseMap.get(-1);
    const x = coseMap.get(-2);
    return {
      kty: 'OKP',
      crv: crvId === 6 ? 'Ed25519' : 'Ed25519',
      x: Buffer.from(x).toString('base64url'),
      alg: alg === -8 ? 'EdDSA' : undefined,
    };
  }

  throw new Error(`Unsupported COSE Key Type (kty: ${kty})`);
}

// ==========================================
// 4. CHALLENGE STORAGE & IN-MEMORY CACHE
// ==========================================

interface ActiveChallenge {
  challenge: string;
  did?: string;
  handle?: string;
  type: 'register' | 'login';
  createdAt: number;
  expiresAt: number;
}

const activeChallenges = new Map<string, ActiveChallenge>();

function cleanExpiredChallenges(): void {
  const now = Date.now();
  for (const [k, v] of activeChallenges.entries()) {
    if (v.expiresAt < now) activeChallenges.delete(k);
  }
}

export function saveChallenge(challenge: string, type: 'register' | 'login', did?: string, handle?: string): void {
  cleanExpiredChallenges();
  activeChallenges.set(challenge, {
    challenge,
    did,
    handle,
    type,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
  });
}

export function consumeChallenge(challenge: string, type: 'register' | 'login'): ActiveChallenge | undefined {
  cleanExpiredChallenges();
  const c = activeChallenges.get(challenge);
  if (!c || c.type !== type || c.expiresAt < Date.now()) return undefined;
  activeChallenges.delete(challenge);
  return c;
}

// ==========================================
// 5. REGISTRATION (ATTESTATION) PIPELINE
// ==========================================

export interface RegistrationOptions {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>;
  authenticatorSelection: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    userVerification: 'required' | 'preferred' | 'discouraged';
    residentKey?: 'required' | 'preferred' | 'discouraged';
    requireResidentKey?: boolean;
  };
  timeout: number;
  attestation: 'none' | 'indirect' | 'direct';
}

export function generateRegistrationOptions(user: UserRecord, hostname?: string): RegistrationOptions {
  const challenge = toBase64Url(crypto.randomBytes(32));
  saveChallenge(challenge, 'register', user.did, user.handle);

  const cleanHost = hostname ? hostname.replace(/:\d+$/, '') : undefined;

  return {
    challenge,
    rp: {
      name: 'SOVRA Sovereign Network',
      ...(cleanHost ? { id: cleanHost } : {}),
    },
    user: {
      id: toBase64Url(Buffer.from(user.did)),
      name: user.handle,
      displayName: user.displayName || user.name || user.handle,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256 (P-256) - iOS FaceID & Android Biometric standard
      { alg: -257, type: 'public-key' }, // RS256 - Windows Hello & TPM
      { alg: -8, type: 'public-key' }, // Ed25519 (EdDSA)
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Physical on-device sensor (Fingerprint / Face ID)
      userVerification: 'preferred',
      residentKey: 'preferred',
      requireResidentKey: false,
    },
    timeout: 60000,
    attestation: 'none',
  };
}

export function verifyRegistrationResponse(
  payload: {
    id: string;
    rawId?: string;
    response: {
      clientDataJSON: string;
      attestationObject: string;
      transports?: string[];
    };
  },
  expectedHostname?: string
): { ok: boolean; credential?: WebAuthnCredentialRecord; error?: string } {
  try {
    if (!payload || !payload.id || !payload.response) {
      return { ok: false, error: 'Invalid WebAuthn registration payload' };
    }

    // 1. Decode clientDataJSON
    const clientDataRaw = fromBase64Url(payload.response.clientDataJSON);
    const clientData = JSON.parse(clientDataRaw.toString('utf-8'));

    if (clientData.type !== 'webauthn.create') {
      return { ok: false, error: `Invalid clientData type: expected webauthn.create, got ${clientData.type}` };
    }

    // 2. Consume challenge
    const matchedChallenge = consumeChallenge(clientData.challenge, 'register');
    if (!matchedChallenge) {
      return { ok: false, error: 'WebAuthn challenge expired or invalid' };
    }

    // 3. Decode attestationObject CBOR
    const attestationRaw = fromBase64Url(payload.response.attestationObject);
    const attestationMap = decodeCbor(attestationRaw);
    if (!(attestationMap instanceof Map)) {
      return { ok: false, error: 'Malformed attestationObject CBOR map' };
    }

    const authDataRaw = attestationMap.get('authData');
    if (!authDataRaw || authDataRaw.length < 37) {
      return { ok: false, error: 'Invalid or truncated authData in attestationObject' };
    }

    // authData layout:
    // 0..31: rpIdHash (32 bytes)
    // 32: flags (1 byte)
    // 33..36: signCount (4 bytes)
    const flags = authDataRaw[32];
    const hasAttestedCred = (flags & 0x40) !== 0; // bit 6 = AT

    if (!hasAttestedCred) {
      return { ok: false, error: 'Attested credential data not present in authData' };
    }

    const signCount =
      (authDataRaw[33] * 2 ** 24) +
      (authDataRaw[34] << 16) +
      (authDataRaw[35] << 8) +
      authDataRaw[36];

    // Attested Credential Data:
    // 37..52: aaguid (16 bytes)
    // 53..54: credentialIdLength (UInt16BE: L)
    const credIdLen = (authDataRaw[53] << 8) | authDataRaw[54];
    if (authDataRaw.length < 55 + credIdLen) {
      return { ok: false, error: 'authData too short for credential ID' };
    }

    const credentialIdBuf = authDataRaw.subarray(55, 55 + credIdLen);
    const credentialIdBase64Url = toBase64Url(credentialIdBuf);

    // 55 + credIdLen onwards: COSE Key
    const coseKeyBuf = authDataRaw.subarray(55 + credIdLen);
    const coseMap = decodeCbor(coseKeyBuf);
    if (!(coseMap instanceof Map)) {
      return { ok: false, error: 'Malformed COSE public key in attestation' };
    }

    const jwk = coseKeyToJwk(coseMap);

    // Verify key imports into Node.js crypto
    crypto.createPublicKey({ key: jwk as any, format: 'jwk' });

    const cred: WebAuthnCredentialRecord = {
      id: credentialIdBase64Url,
      jwk,
      counter: signCount,
      transports: payload.response.transports || ['internal'],
      createdAt: Date.now(),
    };

    return { ok: true, credential: cred };
  } catch (err: any) {
    return { ok: false, error: `WebAuthn registration verification failed: ${err?.message || err}` };
  }
}

// ==========================================
// 6. ASSERTION / LOGIN PIPELINE
// ==========================================

export interface LoginOptions {
  challenge: string;
  timeout: number;
  rpId?: string;
  allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
  userVerification: 'required' | 'preferred' | 'discouraged';
}

export function generateLoginOptions(
  user?: UserRecord,
  hostname?: string
): LoginOptions {
  const challenge = toBase64Url(crypto.randomBytes(32));
  saveChallenge(challenge, 'login', user?.did, user?.handle);

  const cleanHost = hostname ? hostname.replace(/:\d+$/, '') : undefined;
  const allowCredentials = (user?.webauthnCredentials || []).map(c => ({
    id: c.id,
    type: 'public-key' as const,
    transports: c.transports,
  }));

  return {
    challenge,
    timeout: 60000,
    ...(cleanHost ? { rpId: cleanHost } : {}),
    allowCredentials,
    userVerification: 'preferred',
  };
}

export function verifyLoginResponse(
  payload: {
    id: string;
    rawId?: string;
    response: {
      clientDataJSON: string;
      authenticatorData: string;
      signature: string;
      userHandle?: string;
    };
  },
  credentials: WebAuthnCredentialRecord[]
): { ok: boolean; credential?: WebAuthnCredentialRecord; error?: string } {
  try {
    if (!payload || !payload.id || !payload.response) {
      return { ok: false, error: 'Invalid WebAuthn assertion payload' };
    }

    // 1. Find registered credential
    const cred = credentials.find(c => c.id === payload.id);
    if (!cred) {
      return { ok: false, error: 'Credential ID not registered on this sovereign account' };
    }

    // 2. Decode clientDataJSON
    const clientDataRaw = fromBase64Url(payload.response.clientDataJSON);
    const clientData = JSON.parse(clientDataRaw.toString('utf-8'));

    if (clientData.type !== 'webauthn.get') {
      return { ok: false, error: `Invalid clientData type: expected webauthn.get, got ${clientData.type}` };
    }

    // 3. Consume challenge
    const matchedChallenge = consumeChallenge(clientData.challenge, 'login');
    if (!matchedChallenge) {
      return { ok: false, error: 'WebAuthn login challenge expired or invalid' };
    }

    // 4. AuthenticatorData & Signature Verification
    const authDataBuf = fromBase64Url(payload.response.authenticatorData);
    const signatureBuf = fromBase64Url(payload.response.signature);

    if (authDataBuf.length < 37) {
      return { ok: false, error: 'Malformed authenticatorData' };
    }

    // Check User Present flag (bit 0)
    const flags = authDataBuf[32];
    if ((flags & 0x01) === 0) {
      return { ok: false, error: 'User Presence test failed on device hardware' };
    }

    // ClientDataHash
    const clientDataHash = crypto.createHash('sha256').update(clientDataRaw).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);

    // Verify signature using stored JWK
    const pubKey = crypto.createPublicKey({ key: cred.jwk as any, format: 'jwk' });
    const verify = crypto.createVerify(cred.jwk.kty === 'RSA' ? 'RSA-SHA256' : 'SHA256');
    verify.update(signedData);

    const isValid = verify.verify(pubKey, signatureBuf);
    if (!isValid) {
      return { ok: false, error: 'Cryptographic biometric signature verification failed' };
    }

    // Update signCount if present
    const newSignCount =
      (authDataBuf[33] * 2 ** 24) +
      (authDataBuf[34] << 16) +
      (authDataBuf[35] << 8) +
      authDataBuf[36];
    if (newSignCount > cred.counter) {
      cred.counter = newSignCount;
    }

    return { ok: true, credential: cred };
  } catch (err: any) {
    return { ok: false, error: `Biometric login verification failed: ${err?.message || err}` };
  }
}
