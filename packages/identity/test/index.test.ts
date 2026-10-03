import { describe, it, expect } from 'vitest';
import { IdentityKey, DeviceKey, KeyRole } from '../src/index.js';

describe('@sovra/identity', () => {
  it('differentiates key roles and structural definitions', () => {
    const roles: KeyRole[] = ['identity', 'device', 'session', 'encryption', 'signing'];
    expect(roles).toHaveLength(5);
  });

  it('validates identity key structural typing', () => {
    const dummyVerificationKey = {
      algorithm: 'Ed25519' as const,
      rawBytes: new Uint8Array(32),
      toHex: () => '00'.repeat(32),
      toMultibase: () => 'z6MkuTest',
    };

    const identityKey: IdentityKey = {
      id: 'key-1',
      role: 'identity',
      did: 'did:key:z6MkuTest',
      publicKey: dummyVerificationKey,
      createdAt: 1780000000,
    };

    expect(identityKey.role).toBe('identity');
    expect(identityKey.did).toContain('did:key:');
  });

  it('validates device key delegation structure', () => {
    const dummyVerificationKey = {
      algorithm: 'Ed25519' as const,
      rawBytes: new Uint8Array(32),
      toHex: () => '00'.repeat(32),
      toMultibase: () => 'z6MkuDevice',
    };

    const deviceKey: DeviceKey = {
      id: 'dev-key-1',
      role: 'device',
      deviceId: 'device-iphone-15',
      parentDid: 'did:key:z6MkuParent',
      publicKey: dummyVerificationKey,
      createdAt: 1780000000,
      expiresAt: 1785000000,
      delegationSignature: new Uint8Array(64),
    };

    expect(deviceKey.role).toBe('device');
    expect(deviceKey.expiresAt).toBeGreaterThan(deviceKey.createdAt);
  });
});
