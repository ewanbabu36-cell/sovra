import { describe, it, expect } from 'vitest';
import {
  SovraIdentityKey,
  createRecoveryPlan,
  verifyRecoveryPlan,
  createGuardianAuthorization,
  verifyGuardianAuthorization,
  createThresholdRecoveryProof,
  verifyThresholdRecoveryProof,
  createRecoveryCancellation,
  verifyRecoveryCancellation,
  DecentralizedIdentityService,
} from '../src/index.js';
import { hexToBytes } from '@sovra/crypto';

describe('M-of-N Threshold Guardian Recovery & Attack Simulation Matrix', () => {
  it('successfully executes 3-of-5 threshold recovery with valid guardian quorum', () => {
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const g2 = SovraIdentityKey.generate();
    const g3 = SovraIdentityKey.generate();
    const g4 = SovraIdentityKey.generate();
    const g5 = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 3, [g1.did, g2.did, g3.did, g4.did, g5.did], 259200);
    expect(verifyRecoveryPlan(plan)).toBe(true);

    // User loses key and generates new identity key
    const newKey = SovraIdentityKey.generate();
    const nonce = 'session_recovery_nonce_1';
    const now = Math.floor(Date.now() / 1000);

    // Collect 3 authorizations (quorum reached)
    const a1 = createGuardianAuthorization(g1, user.did, newKey.publicKeyBytes, nonce, now + 3600);
    const a2 = createGuardianAuthorization(g2, user.did, newKey.publicKeyBytes, nonce, now + 3600);
    const a3 = createGuardianAuthorization(g3, user.did, newKey.publicKeyBytes, nonce, now + 3600);

    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [a1, a2, a3]);
    const verification = verifyThresholdRecoveryProof(proof, plan, now);

    expect(verification.ok).toBe(true);
    if (!verification.ok) return;

    expect(verification.value.isQuorumSatisfied).toBe(true);
    expect(verification.value.validGuardianCount).toBe(3);
    expect(verification.value.isTimelockActive).toBe(true);
    expect(verification.value.canActivateAt).toBe(proof.claimTimestamp + 259200);
  });

  it('Attack 1: Insufficient Quorum (Only 1 or 2 guardians sign a 3-of-5 plan) -> REJECTED', () => {
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const g2 = SovraIdentityKey.generate();
    const g3 = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 3, [g1.did, g2.did, g3.did], 259200);
    const newKey = SovraIdentityKey.generate();
    const nonce = 'insufficient_quorum_nonce';
    const now = Math.floor(Date.now() / 1000);

    // Only 2 guardians sign
    const a1 = createGuardianAuthorization(g1, user.did, newKey.publicKeyBytes, nonce, now + 3600);
    const a2 = createGuardianAuthorization(g2, user.did, newKey.publicKeyBytes, nonce, now + 3600);

    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [a1, a2]);
    const res = verifyThresholdRecoveryProof(proof, plan, now);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('Insufficient guardian quorum');
    }
  });

  it('Attack 2: Replayed Expired Recovery Request -> REJECTED', () => {
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const plan = createRecoveryPlan(user, 1, [g1.did], 259200);
    const newKey = SovraIdentityKey.generate();
    const nonce = 'expired_nonce';
    const now = Math.floor(Date.now() / 1000);

    // Authorization valid for only 60 seconds
    const a1 = createGuardianAuthorization(g1, user.did, newKey.publicKeyBytes, nonce, now + 60);

    // Verify after 300 seconds (expired)
    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [a1]);
    const res = verifyThresholdRecoveryProof(proof, plan, now + 300);

    expect(res.ok).toBe(false);
  });

  it('Attack 3: Forged Guardian Signature -> REJECTED', () => {
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const attackerKey = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 1, [g1.did], 259200);
    const newKey = SovraIdentityKey.generate();
    const nonce = 'forged_sig_nonce';
    const now = Math.floor(Date.now() / 1000);

    // Attacker signs pretending to be g1
    const authenticAuth = createGuardianAuthorization(
      g1,
      user.did,
      newKey.publicKeyBytes,
      nonce,
      now + 3600,
    );
    const forgedAuth = {
      ...authenticAuth,
      guardianSignature: attackerKey.signHex(new Uint8Array([1, 2, 3])),
    };

    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [forgedAuth]);
    const res = verifyThresholdRecoveryProof(proof, plan, now);

    expect(res.ok).toBe(false);
  });

  it('Attack 4: Unknown / Unlisted Guardian Substitution -> REJECTED', () => {
    const user = SovraIdentityKey.generate();
    const registeredGuardian = SovraIdentityKey.generate();
    const unknownGuardian = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 1, [registeredGuardian.did], 259200);
    const newKey = SovraIdentityKey.generate();
    const nonce = 'unknown_guardian_nonce';
    const now = Math.floor(Date.now() / 1000);

    // Authorization from guardian not in the plan
    const a1 = createGuardianAuthorization(
      unknownGuardian,
      user.did,
      newKey.publicKeyBytes,
      nonce,
      now + 3600,
    );
    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [a1]);
    const res = verifyThresholdRecoveryProof(proof, plan, now);

    expect(res.ok).toBe(false);
  });

  it('Attack 5: Duplicate Signatures from Same Guardian -> REJECTED if threshold not met', () => {
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const g2 = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 2, [g1.did, g2.did], 259200);
    const newKey = SovraIdentityKey.generate();
    const nonce = 'duplicate_guardian_nonce';
    const now = Math.floor(Date.now() / 1000);

    // Guardian 1 signs twice; Guardian 2 never signs
    const a1 = createGuardianAuthorization(g1, user.did, newKey.publicKeyBytes, nonce, now + 3600);
    const proof = createThresholdRecoveryProof(newKey, user.did, nonce, [a1, a1]);
    const res = verifyThresholdRecoveryProof(proof, plan, now);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('Insufficient guardian quorum');
    }
  });

  it('Attack 6: Collusion Takeover Defeated by Legitimate Owner Recovery Cancellation -> REJECTED', () => {
    const service = new DecentralizedIdentityService();
    const user = SovraIdentityKey.generate();
    const g1 = SovraIdentityKey.generate();
    const g2 = SovraIdentityKey.generate();

    const plan = createRecoveryPlan(user, 2, [g1.did, g2.did], 259200);
    const attackerNewKey = SovraIdentityKey.generate();
    const attackNonce = 'hostile_collusion_nonce_77';
    const now = Math.floor(Date.now() / 1000);

    // Colluding guardians create authorization
    const a1 = createGuardianAuthorization(
      g1,
      user.did,
      attackerNewKey.publicKeyBytes,
      attackNonce,
      now + 3600,
    );
    const a2 = createGuardianAuthorization(
      g2,
      user.did,
      attackerNewKey.publicKeyBytes,
      attackNonce,
      now + 3600,
    );

    // Legitimate user detects hostile attempt and issues RecoveryCancellation
    const cancellation = service.cancelRecovery(
      user,
      attackNonce,
      'Hostile guardian collusion detected',
    );
    expect(cancellation.ok).toBe(true);
    expect(verifyRecoveryCancellation(cancellation.value!)).toBe(true);

    // Attacker submits proof -> REJECTED via cancellation veto!
    const recoveryResult = service.executeThresholdRecovery(
      attackerNewKey,
      user.did,
      attackNonce,
      [a1, a2],
      plan,
    );

    expect(recoveryResult.ok).toBe(false);
    if (!recoveryResult.ok) {
      expect(recoveryResult.error.message).toContain('explicitly cancelled');
    }
  });

  it('Guardian Replacement: User successfully updates recovery plan with new guardians', () => {
    const user = SovraIdentityKey.generate();
    const oldGuardian = SovraIdentityKey.generate();
    const replacementGuardian = SovraIdentityKey.generate();

    // Plan sequence 1
    const planV1 = createRecoveryPlan(user, 1, [oldGuardian.did], 259200, 1);
    expect(verifyRecoveryPlan(planV1)).toBe(true);

    // Plan sequence 2 replacing old guardian
    const planV2 = createRecoveryPlan(user, 1, [replacementGuardian.did], 259200, 2);
    expect(verifyRecoveryPlan(planV2)).toBe(true);
    expect(planV2.planSequence).toBe(2);
    expect(planV2.guardianDids).toContain(replacementGuardian.did);
    expect(planV2.guardianDids).not.toContain(oldGuardian.did);
  });
});
