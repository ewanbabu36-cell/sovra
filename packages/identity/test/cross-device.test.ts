import { describe, it, expect } from 'vitest';
import {
  DecentralizedIdentityService,
  SovraDeviceKey,
  createDeviceDelegation,
  verifyDeviceSignedAction,
} from '../src/index.js';

describe('Cross-Device Lifecycle & Delegation Revocation Workflow', () => {
  it('executes full cross-device authorization, event signing, verification, and revocation cycle', async () => {
    const service = new DecentralizedIdentityService();

    // 1. Device A (Master Device) creates identity
    const identityResult = await service.createIdentity();
    expect(identityResult.ok).toBe(true);
    const { identityKey } = identityResult.value!;
    const now = Math.floor(Date.now() / 1000);

    // 2. Device B (Mobile Phone) generates its own device keypair locally
    const deviceB = SovraDeviceKey.generate(
      'dev-phone-b',
      'Pixel Phone',
      identityKey.did,
      now + 86400,
    );

    // 3. Device A authorizes Device B via signed delegation assertion
    const delegationB = createDeviceDelegation(identityKey, deviceB, now + 86400);
    expect(delegationB.parentDid).toBe(identityKey.did);
    expect(delegationB.deviceId).toBe('dev-phone-b');

    // 4. Device B creates and signs an authentic protocol event
    const postPayload = new TextEncoder().encode('Hello from my new mobile device!');
    const signatureB1 = deviceB.signHex(postPayload);

    // 5. Device A (and any peer on the network) verifies the event signed by Device B
    const isVerifiedInitially = service.verifyDeviceAction(
      identityKey.did,
      delegationB,
      postPayload,
      signatureB1,
    );
    expect(isVerifiedInitially).toBe(true);

    // 6. Device B is reported stolen/lost: Device A issues a signed revocation for Device B
    const revocationResult = service.revokeKey(
      identityKey,
      deviceB.publicKeyHex,
      'device',
      'device_lost',
      1,
    );
    expect(revocationResult.ok).toBe(true);
    expect(service.isKeyRevoked(deviceB.publicKeyHex)).toBe(true);

    // 7. Device B attempts another operation post-revocation
    const maliciousPost = new TextEncoder().encode('Unauthorized post from compromised device');
    const signatureB2 = deviceB.signHex(maliciousPost);

    // 8. Expected: The operation is REJECTED according to the revocation model!
    const isVerifiedAfterRevocation = service.verifyDeviceAction(
      identityKey.did,
      delegationB,
      maliciousPost,
      signatureB2,
    );
    expect(isVerifiedAfterRevocation).toBe(false);
  });
});
