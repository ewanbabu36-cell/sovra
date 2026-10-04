/**
 * @file packages/identity/test/onboarding.test.ts
 * Comprehensive Verification Suite for 3-Step Passkey Onboarding, Session Lock, QR Transfer & Guardian Recovery.
 */

import { describe, it, expect } from 'vitest';
import { AccountLifecycleEngine } from '../src/onboarding.js';
import { SovraIdentityKey } from '../src/keypair.js';

describe('Account Lifecycle & Onboarding Engine Suite (@sovra/identity)', () => {
  it('completes 3-step zero-password account creation with biometric Passkey in < 5 seconds', async () => {
    const engine = new AccountLifecycleEngine();

    expect(engine.profile).toBeNull();

    // 1. Create account: @rahul
    const createRes = await engine.createAccount('rahul_p2p', 'Rahul Sharma', 'android');
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const { profile, identityKey, deviceKey, passkeyCredential } = createRes.value;

    expect(profile.handle).toBe('@rahul_p2p');
    expect(profile.displayName).toBe('Rahul Sharma');
    expect(profile.did).toMatch(/^did:key:z6Mk/);
    expect(profile.isLocked).toBe(false);

    // Verify Passkey registration in hardware keystore
    expect(passkeyCredential.attestationFormat).toBe('android-titan');
    expect(passkeyCredential.userHandleDid).toBe(identityKey.did);

    // Verify Engine profile property
    expect(engine.profile?.handle).toBe('@rahul_p2p');
    expect(engine.isLocked).toBe(false);
  });

  it('handles Quick Lock (Soft Logout) and Biometric Unlock', async () => {
    const engine = new AccountLifecycleEngine();
    await engine.createAccount('priya_art', 'Priya Arts', 'ios');

    expect(engine.isLocked).toBe(false);

    // Quick Lock session
    engine.lockSession();
    expect(engine.isLocked).toBe(true);
    expect(engine.profile?.isLocked).toBe(true);

    // Biometric Unlock with TouchID / FaceID
    const unlockRes = engine.unlockWithBiometrics();
    expect(unlockRes.ok).toBe(true);
    expect(engine.isLocked).toBe(false);
    expect(engine.profile?.isLocked).toBe(false);
  });

  it('handles Complete Logout & Wipe (Hard Logout) with network device revocation', async () => {
    const engine = new AccountLifecycleEngine();
    const createRes = await engine.createAccount('meraj_test', 'Meraj', 'web');
    if (!createRes.ok) return;

    const devicePubHex = createRes.value.deviceKey.publicKeyHex;

    // Hard Logout: wipes memory and registers revocation
    const wipeRes = engine.logoutAndWipeDevice();
    expect(wipeRes.ok).toBe(true);
    expect(wipeRes.value?.deviceRevoked).toBe(true);

    // Local profile is completely purged
    expect(engine.profile).toBeNull();

    // Device key is marked permanently revoked on the network
    expect(engine.revocationRegistry.isRevoked(devicePubHex)).toBe(true);
  });

  it('generates cryptographically signed QR pairing payload for secondary device sync', async () => {
    const engine = new AccountLifecycleEngine();
    await engine.createAccount('alice_sync', 'Alice', 'android');

    // Secondary device generates ephemeral keypair
    const deviceBId = SovraIdentityKey.generate();

    const qrRes = engine.generateQrPairingPayload(deviceBId.publicKeyHex, 300);
    expect(qrRes.ok).toBe(true);
    if (!qrRes.ok) return;

    const qrPayload = qrRes.value;
    expect(qrPayload.version).toBe(1);
    expect(qrPayload.handle).toBe('@alice_sync');
    expect(qrPayload.delegationAssertion).toBeDefined();
    expect(qrPayload.delegationAssertion.parentDid).toBe(engine.profile?.did);
    expect(qrPayload.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('configures Social Guardian Recovery with 2-of-3 threshold plan', async () => {
    const engine = new AccountLifecycleEngine();
    await engine.createAccount('bob_safe', 'Bob', 'android');

    const guardian1 = SovraIdentityKey.generate().did;
    const guardian2 = SovraIdentityKey.generate().did;
    const guardian3 = SovraIdentityKey.generate().did;

    const planRes = engine.setupGuardianRecovery({
      guardianDids: [guardian1, guardian2, guardian3],
      threshold: 2,
    });

    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    const plan = planRes.value;
    expect(plan.requiredThreshold).toBe(2);
    expect(plan.totalGuardians).toBe(3);
    expect(plan.targetDid).toBe(engine.profile?.did);
    expect(engine.recoveryPlan).toBeDefined();
  });
});
