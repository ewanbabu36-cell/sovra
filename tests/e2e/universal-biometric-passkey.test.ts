/**
 * @file tests/e2e/universal-biometric-passkey.test.ts
 * Tests Universal 1-Tap Biometric Passkey Registration, Auto-Handle Generation,
 * Handle Customization, and Multi-Device Pairing Handshake
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { sovraDb } from '../../scripts/database-engine.ts';
import { generateRegistrationOptions, generateLoginOptions } from '../../scripts/webauthn-engine.ts';

describe('Universal 1-Tap Biometric Passkey & Auto-Handle Suite', () => {
  beforeAll(() => {
    if (!process.env.SOVRA_THROTTLE_SECRET) {
      process.env.SOVRA_THROTTLE_SECRET = 'e9f0c2a87d4b1e5f8a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a';
    }
    sovraDb.loadThrottleSecrets();
  });

  it('1. Generates 1-Tap registration options for anonymous visitors with auto-assigned handle', () => {
    const options = generateRegistrationOptions(null, 'localhost');
    expect(options).toBeDefined();
    expect(options.challenge).toBeTruthy();
    expect(options.rp.name).toBe('SOVRA Sovereign Network');
    expect(options.user.name).toMatch(/^@sovra_[a-f0-9]{4}$/);
    expect(options.user.id).toBeTruthy();
    expect(options.authenticatorSelection.residentKey).toBe('required');
  });

  it('2. Creates a sovereign account via 1-Tap biometric registration and verifies in database', () => {
    const autoHex = crypto.randomBytes(2).toString('hex').toLowerCase();
    const autoHandle = `@sovra_${autoHex}`;
    const autoDid = `did:key:z6Mko${crypto.randomBytes(16).toString('hex')}`;
    const fakeCredId = 'cred_' + crypto.randomBytes(16).toString('base64url');

    const createdUser = sovraDb.createUser({
      did: autoDid,
      handle: autoHandle,
      name: autoHandle.replace(/^@/, ''),
      displayName: autoHandle.replace(/^@/, ''),
      bio: 'Sovereign Peer Node',
      avatar: '⚡',
      avatarBg: '#6366f1',
      role: 'peer',
      sessionToken: 'stk_' + crypto.randomBytes(24).toString('hex'),
      webauthnCredentials: [{
        id: fakeCredId,
        publicKey: {
          kty: 'EC',
          crv: 'P-256',
          x: crypto.randomBytes(32).toString('base64url'),
          y: crypto.randomBytes(32).toString('base64url'),
        },
        counter: 0,
        createdAt: Date.now(),
      }],
    });

    expect(createdUser).toBeDefined();
    expect(createdUser.handle).toBe(autoHandle);
    expect(Boolean(createdUser.webauthnCredentials?.length)).toBe(true);

    const lookedUp = sovraDb.findUserByWebauthnCredentialId(fakeCredId);
    expect(lookedUp).toBeDefined();
    expect(lookedUp?.did).toBe(autoDid);
    expect(lookedUp?.handle).toBe(autoHandle);
  });

  it('3. Successfully logs in existing user via discoverable credential lookup without prefilled handle', () => {
    const loginOptions = generateLoginOptions(undefined, 'localhost');
    expect(loginOptions.challenge).toBeTruthy();
    expect(loginOptions.allowCredentials).toHaveLength(0); // Discoverable / Resident Key standard

    const users = sovraDb.getAllUsers().filter(u => u.webauthnCredentials && u.webauthnCredentials.length > 0);
    expect(users.length).toBeGreaterThan(0);
    const targetUser = users[0]!;
    const credId = targetUser.webauthnCredentials![0]!.id;

    const matchedUser = sovraDb.findUserByWebauthnCredentialId(credId);
    expect(matchedUser).toBeDefined();
    expect(matchedUser?.did).toBe(targetUser.did);

    const loginRes = sovraDb.loginUser(matchedUser!.handle, 'Test Device', '127.0.0.1', 'Node/Vitest', { webauthnVerified: true });
    expect(loginRes.ok).toBe(true);
    expect(loginRes.sessionToken).toBeTruthy();
  });

  it('4. Allows user to claim/personalize their handle while keeping DID and keys invariant', () => {
    const autoHex = crypto.randomBytes(2).toString('hex').toLowerCase();
    const tempHandle = `@sovra_${autoHex}`;
    const permHandle = `@sovereign_${crypto.randomBytes(3).toString('hex')}`;
    const did = `did:key:z6Mko${crypto.randomBytes(16).toString('hex')}`;

    sovraDb.createUser({
      did,
      handle: tempHandle,
      name: 'Temp Peer',
      displayName: 'Temp Peer',
      role: 'peer',
      sessionToken: 'stk_' + crypto.randomBytes(24).toString('hex'),
    });

    expect(sovraDb.isHandleTaken(permHandle)).toBe(false);

    const updatedUser = sovraDb.upsertUser({
      did,
      handle: permHandle,
      displayName: 'Sovereign Hero',
    });

    expect(updatedUser.handle).toBe(permHandle);
    expect(updatedUser.did).toBe(did); // DID invariant!
    expect(sovraDb.findUserByHandle(permHandle)?.did).toBe(did);
    expect(sovraDb.isHandleTaken(permHandle)).toBe(true);
  });
});
