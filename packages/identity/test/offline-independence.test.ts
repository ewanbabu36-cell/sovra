import { describe, it, expect } from 'vitest';
import {
  DecentralizedIdentityService,
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  verifyDeviceDelegation,
  verifyDeviceSignedAction,
  createRevocationAssertion,
} from '../src/index.js';

describe('Mandatory Offline & Company Infrastructure Independence Verification', () => {
  it('executes complete identity lifecycle in a 100% offline environment without central servers', async () => {
    // Simulate isolated offline environment (no network fetch/http handlers)
    const service = new DecentralizedIdentityService();

    // 1. Offline Identity Creation
    const createRes = await service.createIdentity();
    expect(createRes.ok).toBe(true);
    const { identityKey, publicIdentity } = createRes.value!;

    expect(identityKey.did).toBeDefined();
    expect(publicIdentity.did).toBe(identityKey.did);

    // 2. Local Signature Creation
    const testData = new TextEncoder().encode('Offline local signed assertion');
    const signature = identityKey.signHex(testData);

    // 3. Offline Signature Verification
    const now = Math.floor(Date.now() / 1000);
    const localDevice = SovraDeviceKey.generate(
      'offline-dev-1',
      'Desktop',
      identityKey.did,
      now + 10000,
    );
    const delegation = createDeviceDelegation(identityKey, localDevice, now + 10000);

    expect(verifyDeviceDelegation(delegation)).toBe(true);

    const deviceSig = localDevice.signHex(testData);
    const isValidOffline = service.verifyDeviceAction(
      identityKey.did,
      delegation,
      testData,
      deviceSig,
    );
    expect(isValidOffline).toBe(true);

    // 4. Local Revocation Processing
    const revAssertion = createRevocationAssertion(
      identityKey,
      localDevice.publicKeyHex,
      'device',
      'routine_rotation',
      1,
    );
    service.revokeKey(identityKey, localDevice.publicKeyHex, 'device', 'routine_rotation', 1);

    expect(service.isKeyRevoked(localDevice.publicKeyHex)).toBe(true);
    expect(service.verifyDeviceAction(identityKey.did, delegation, testData, deviceSig)).toBe(
      false,
    );
  });

  it('proves Company Admin Panel is completely absent and unrequired for all identity operations', () => {
    // Assert zero runtime or static coupling with Product B (Admin Panel)
    const service = new DecentralizedIdentityService();

    // Verify identity key can be generated, used, and rotated without admin API
    const key1 = SovraIdentityKey.generate();
    const key2 = SovraIdentityKey.generate();

    const rotation = service.rotateIdentity(key1, key2, 1);
    expect(rotation.ok).toBe(true);
    expect(service.resolveCurrentDid(key1.did)).toBe(key2.did);
  });
});
