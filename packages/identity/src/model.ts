import { DeviceDelegationAssertion } from './delegation.js';
import { RecoveryPlan } from './recovery.js';

export interface VerificationMethod {
  readonly id: string;
  readonly type: 'Ed25519VerificationKey2020';
  readonly controller: string;
  readonly publicKeyMultibase: string;
}

export interface PublicIdentity {
  readonly did: string;
  readonly publicKeyHex: string;
  readonly createdAt: number;
  readonly version: number;
  readonly activeDevices: readonly DeviceDelegationAssertion[];
  readonly recoveryPlan?: RecoveryPlan;
  readonly verificationMethod: readonly VerificationMethod[];
  readonly authentication: readonly string[];
}

export function buildPublicIdentity(
  did: string,
  publicKeyHex: string,
  createdAt: number,
  activeDevices: readonly DeviceDelegationAssertion[] = [],
  recoveryPlan?: RecoveryPlan,
): PublicIdentity {
  const multibaseKey = did.replace('did:key:', '');
  const keyId = `${did}#key-1`;

  const verificationMethod: VerificationMethod = {
    id: keyId,
    type: 'Ed25519VerificationKey2020',
    controller: did,
    publicKeyMultibase: multibaseKey,
  };

  return {
    did,
    publicKeyHex,
    createdAt,
    version: 1,
    activeDevices,
    ...(recoveryPlan ? { recoveryPlan } : {}),
    verificationMethod: [verificationMethod],
    authentication: [keyId],
  };
}
