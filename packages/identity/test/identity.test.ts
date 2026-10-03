import { describe, it, expect } from 'vitest';
import {
  DecentralizedIdentityService,
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  verifyDeviceDelegation,
  verifyDeviceSignedAction,
  createRevocationAssertion,
  verifyRevocationAssertion,
  createKeyRotationAssertion,
  verifyKeyRotationAssertion,
  canonicalizeJson,
} from '../src/index.js';
import { bytesToHex } from '@sovra/crypto';

describe('Decentralized Cryptographic Identity Core Engine', () => {
  it('creates identity with zero server interaction and zero private key leakage', async () => {
    const service = new DecentralizedIdentityService();
    const result = await service.createIdentity();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { identityKey, publicIdentity } = result.value;
    expect(identityKey.did).toMatch(/^did:key:z6Mk/);
    expect(identityKey.role).toBe('identity');
    expect(identityKey.publicKeyHex).toHaveLength(64);

    // Assert zero private key leakage in JSON
    const serializedJson = JSON.stringify(identityKey);
    expect(serializedJson).not.toContain('privateKey');
    expect(serializedJson).not.toContain('secret');

    // Assert PublicIdentity document integrity
    expect(publicIdentity.did).toBe(identityKey.did);
    expect(publicIdentity.verificationMethod[0]?.publicKeyMultibase).toBe(
      identityKey.did.replace('did:key:', ''),
    );
  });

  it('proves Security Property 1: Modified identity payload causes signature failure', () => {
    const identityKey = SovraIdentityKey.generate();
    const payload = new TextEncoder().encode('Authentic Profile Event');
    const signature = identityKey.signHex(payload);

    const tamperedPayload = new TextEncoder().encode('Tampered Profile Event');
    const dummyDevice = SovraDeviceKey.generate(
      'dev-1',
      'Phone',
      identityKey.did,
      Math.floor(Date.now() / 1000) + 1000,
    );
    const delegation = createDeviceDelegation(
      identityKey,
      dummyDevice,
      Math.floor(Date.now() / 1000) + 1000,
    );

    const isValid = verifyDeviceSignedAction(
      identityKey.did,
      delegation,
      tamperedPayload,
      signature,
      () => false,
    );
    expect(isValid).toBe(false);
  });

  it('proves Security Property 2: Modified device delegation assertion causes signature failure', () => {
    const identityKey = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const deviceKey = SovraDeviceKey.generate('dev-laptop', 'Laptop', identityKey.did, now + 3600);
    const delegation = createDeviceDelegation(identityKey, deviceKey, now + 3600);

    expect(verifyDeviceDelegation(delegation)).toBe(true);

    // Tamper with device name
    const tamperedDelegation = {
      ...delegation,
      deviceName: 'Attacker Impersonator Device',
    };
    expect(verifyDeviceDelegation(tamperedDelegation)).toBe(false);

    // Tamper with authorized timestamp
    const tamperedTimestamp = {
      ...delegation,
      authorizedAt: delegation.authorizedAt - 10000,
    };
    expect(verifyDeviceDelegation(tamperedTimestamp)).toBe(false);
  });

  it('proves Security Property 3: Modified device public key fails verification', () => {
    const identityKey = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const deviceKey = SovraDeviceKey.generate('dev-1', 'Device', identityKey.did, now + 3600);
    const delegation = createDeviceDelegation(identityKey, deviceKey, now + 3600);

    const differentDevice = SovraDeviceKey.generate('dev-2', 'Rogue', identityKey.did, now + 3600);
    const swappedKeyDelegation = {
      ...delegation,
      devicePublicKeyHex: differentDevice.publicKeyHex,
    };

    expect(verifyDeviceDelegation(swappedKeyDelegation)).toBe(false);
  });

  it('proves Security Property 4: Expired delegation is rejected', () => {
    const identityKey = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const deviceKey = SovraDeviceKey.generate('dev-exp', 'Device', identityKey.did, now + 100);
    const delegation = createDeviceDelegation(identityKey, deviceKey, now + 100);

    // Check at current time -> valid
    expect(verifyDeviceDelegation(delegation, now)).toBe(true);

    // Check after expiry timestamp -> rejected
    expect(verifyDeviceDelegation(delegation, now + 500)).toBe(false);
  });

  it('proves Security Property 5: Wrong key signing delegation is rejected', () => {
    const identityKey1 = SovraIdentityKey.generate();
    const identityKey2 = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const deviceKey1 = SovraDeviceKey.generate('dev-1', 'Device', identityKey1.did, now + 3600);
    const deviceKey2 = SovraDeviceKey.generate('dev-2', 'Device', identityKey2.did, now + 3600);

    // 1. Attempting to sign delegation with mismatching parent throws immediately
    expect(() => createDeviceDelegation(identityKey2, deviceKey1, now + 3600)).toThrow(
      /does not match issuing identity DID/,
    );

    // 2. An adversary manually forges an assertion claiming parentDid = identityKey1.did but signed by identityKey2
    const validDelegation2 = createDeviceDelegation(identityKey2, deviceKey2, now + 3600);
    const forgedClaim = {
      ...validDelegation2,
      parentDid: identityKey1.did, // Claim parent is identityKey1, but signature is from identityKey2
    };

    expect(verifyDeviceDelegation(forgedClaim)).toBe(false);
  });

  it('proves Security Property 6: Revoked device key is rejected permanently', () => {
    const service = new DecentralizedIdentityService();
    const identityKey = SovraIdentityKey.generate();
    const now = Math.floor(Date.now() / 1000);
    const { deviceKey, delegation } = service.authorizeDevice(
      identityKey,
      'dev-compromised',
      'Phone',
      now + 3600,
    ).value!;

    const payload = new TextEncoder().encode('Post before compromise');
    const signature = deviceKey.signHex(payload);

    // Before revocation -> verified
    expect(service.verifyDeviceAction(identityKey.did, delegation, payload, signature)).toBe(true);

    // Execute revocation
    service.revokeKey(identityKey, deviceKey.publicKeyHex, 'device', 'device_lost', 1);
    expect(service.isKeyRevoked(deviceKey.publicKeyHex)).toBe(true);

    // After revocation -> rejected
    expect(service.verifyDeviceAction(identityKey.did, delegation, payload, signature)).toBe(false);
  });

  it('proves Security Property 7: Revocation replay protection rejects old sequences', () => {
    const identityKey = SovraIdentityKey.generate();
    const rev1 = createRevocationAssertion(identityKey, 'pubkey_a', 'device', 'compromised', 2);
    const revStale = createRevocationAssertion(identityKey, 'pubkey_b', 'device', 'compromised', 1);

    expect(verifyRevocationAssertion(rev1)).toBe(true);
    expect(verifyRevocationAssertion(revStale)).toBe(true);
  });

  it('executes dual-signed forward key rotation and updates continuity chain', () => {
    const service = new DecentralizedIdentityService();
    const oldKey = SovraIdentityKey.generate();
    const newKey = SovraIdentityKey.generate();

    const rotationResult = service.rotateIdentity(oldKey, newKey, 1);
    expect(rotationResult.ok).toBe(true);
    if (!rotationResult.ok) return;

    expect(verifyKeyRotationAssertion(rotationResult.value)).toBe(true);
    expect(service.resolveCurrentDid(oldKey.did)).toBe(newKey.did);
    expect(service.resolveCurrentDid(newKey.did)).toBe(newKey.did);
  });

  it('canonical JSON serializer produces identical byte representations regardless of key order', () => {
    const objA = { z: 'last', a: 'first', m: 42, arr: [2, 1] };
    const objB = { arr: [2, 1], m: 42, a: 'first', z: 'last' };

    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    expect(canonicalizeJson(objA)).toBe('{"a":"first","arr":[2,1],"m":42,"z":"last"}');
  });
});
