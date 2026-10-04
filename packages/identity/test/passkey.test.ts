import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  signEd25519,
  sha256,
  bytesToHex,
  secureRandomBytes,
} from '@sovra/crypto';
import {
  PasskeyManager,
  PasskeyAssertionProof,
} from '../src/index.js';

describe('Pillar 8: Hardware Passkeys & Zero-Knowledge Cloud Backup Vault', () => {
  const manager = new PasskeyManager();
  const hardwareKeypair = generateEd25519KeyPair();
  const userDid = 'did:sovra:alice-consumer';

  it('registers hardware biometric credential and verifies assertions with replay protection', () => {
    const cred = manager.registerPasskey(
      userDid,
      hardwareKeypair.publicKey,
      'apple-secure-enclave',
    );
    expect(cred.credentialId).toBeDefined();
    expect(cred.signCounter).toBe(0);

    // Create client assertion proof
    const challengeHex = 'challenge_123456';
    const clientDataJson = JSON.stringify({ type: 'webauthn.get', challenge: challengeHex });
    const authData = new Uint8Array([1, 2, 3, 4]); // authenticator data bytes
    const clientHash = sha256(new TextEncoder().encode(clientDataJson));

    const signedBuffer = new Uint8Array(authData.length + clientHash.length);
    signedBuffer.set(authData, 0);
    signedBuffer.set(clientHash, authData.length);
    const signature = signEd25519(hardwareKeypair.privateKey, signedBuffer);

    const proof: PasskeyAssertionProof = {
      credentialId: cred.credentialId,
      clientDataJson,
      authenticatorDataHex: bytesToHex(authData),
      signatureHex: bytesToHex(signature),
      newSignCounter: 1,
    };

    // Valid assertion
    const isOk = manager.verifyPasskeyAssertion(proof, challengeHex);
    expect(isOk).toBe(true);
    expect(cred.signCounter).toBe(1);

    // Replay attack with same counter must be rejected
    const replayProof = { ...proof };
    expect(manager.verifyPasskeyAssertion(replayProof, challengeHex)).toBe(false);
  });

  it('creates and restores zero-knowledge cloud backup vault', () => {
    const rawIdentityKey = secureRandomBytes(32);
    const biometricSecret = secureRandomBytes(32);

    // Encrypt into cloud vault
    const vault = manager.createEncryptedVault(rawIdentityKey, biometricSecret);
    expect(vault.vaultCiphertextHex).toBeDefined();
    expect(vault.nonceHex).toBeDefined();
    expect(vault.saltHex).toBeDefined();

    // 1-Tap restore
    const restoredKey = manager.restoreFromEncryptedVault(vault, biometricSecret);
    expect(restoredKey).toEqual(rawIdentityKey);

    // Wrong biometric secret must fail to decrypt
    const wrongSecret = secureRandomBytes(32);
    expect(() => manager.restoreFromEncryptedVault(vault, wrongSecret)).toThrow();
  });

  it('splits secret into 2-of-3 Shamir shards and reconstructs perfectly with any 2 shards', async () => {
    const { ShamirSecretVault } = await import('../src/index.js');
    const secret = secureRandomBytes(32);

    const shards = ShamirSecretVault.splitSecret(secret, 2, 3);
    expect(shards.length).toBe(3);

    // Combination A: Shards 1 and 2
    const rec12 = ShamirSecretVault.reconstructSecret([shards[0]!, shards[1]!]);
    expect(rec12).toEqual(secret);

    // Combination B: Shards 2 and 3
    const rec23 = ShamirSecretVault.reconstructSecret([shards[1]!, shards[2]!]);
    expect(rec23).toEqual(secret);

    // Combination C: Shards 1 and 3
    const rec13 = ShamirSecretVault.reconstructSecret([shards[0]!, shards[2]!]);
    expect(rec13).toEqual(secret);
  });

  it('calculates exponential backoff lockout duration guarding against brute-force attacks', async () => {
    const { calculateExponentialBackoffLockout } = await import('../src/index.js');

    // 0 to 3 failed attempts: 0 seconds lockout
    expect(calculateExponentialBackoffLockout(0)).toBe(0);
    expect(calculateExponentialBackoffLockout(3)).toBe(0);

    // 4 failed attempts: 2^(4-3) * 60 = 120s (2 minutes)
    expect(calculateExponentialBackoffLockout(4)).toBe(120);

    // 5 failed attempts: 2^(5-3) * 60 = 240s (4 minutes)
    expect(calculateExponentialBackoffLockout(5)).toBe(240);

    // 6 failed attempts: 2^(6-3) * 60 = 480s (8 minutes)
    expect(calculateExponentialBackoffLockout(6)).toBe(480);
  });

  it('protects against guardian collusion hijacking via 48-hour time-locked veto window', async () => {
    const { TimeLockedRecoveryAppealManager } = await import('../src/index.js');
    const now = 1700000000;
    const appeal = TimeLockedRecoveryAppealManager.initiateAppeal(
      'did:sovra:victim-alice',
      'device_pubkey_attacker',
      now,
    );

    expect(appeal.status).toBe('pending_veto_window');
    expect(appeal.vetoWindowSeconds).toBe(48 * 3600); // 48 hours = 172,800s

    // During veto window (e.g. 24 hours in), finalize MUST fail
    const prematureFinalize = TimeLockedRecoveryAppealManager.finalizeRecovery(appeal, now + 24 * 3600);
    expect(prematureFinalize).toBe(false);
    expect(appeal.status).toBe('pending_veto_window');

    // Legitimate owner exercises veto notification within 48h window
    const vetoSuccess = TimeLockedRecoveryAppealManager.vetoAppealByOwner(appeal, true);
    expect(vetoSuccess).toBe(true);
    expect(appeal.status).toBe('vetoed_by_owner');

    // After veto, attacker can never finalize
    const postVetoFinalize = TimeLockedRecoveryAppealManager.finalizeRecovery(appeal, now + 50 * 3600);
    expect(postVetoFinalize).toBe(false);
  });

  it('splits and reconstructs key using cross-platform Shamir trio (Cloud Vault, Secondary Device, Social Guardians)', async () => {
    const { CrossPlatformKeySharding } = await import('../src/index.js');
    const privateKey = secureRandomBytes(32);

    const trio = CrossPlatformKeySharding.splitIntoTrio(privateKey);
    expect(trio.shard1CloudVault.shardIndex).toBe(1);
    expect(trio.shard2SecondaryDevice.shardIndex).toBe(2);
    expect(trio.shard3SocialGuardians.shardIndex).toBe(3);

    // Scenario 1: User lost phone, restores using Cloud Vault (Shard 1) + Secondary Laptop (Shard 2)
    const restoredFrom1And2 = CrossPlatformKeySharding.reconstructFromAnyTwo(
      trio.shard1CloudVault,
      trio.shard2SecondaryDevice,
    );
    expect(restoredFrom1And2).toEqual(privateKey);

    // Scenario 2: Cloud vault corrupted, restores using Secondary Laptop (Shard 2) + Social Guardians (Shard 3)
    const restoredFrom2And3 = CrossPlatformKeySharding.reconstructFromAnyTwo(
      trio.shard2SecondaryDevice,
      trio.shard3SocialGuardians,
    );
    expect(restoredFrom2And3).toEqual(privateKey);
  });
});

