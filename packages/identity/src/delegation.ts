import { verifyEd25519, hexToBytes, bytesToHex, secureRandomBytes } from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';
import { SovraIdentityKey, SovraDeviceKey } from './keypair.js';
import { decodeEd25519DidKey } from './did.js';
import { canonicalizeToBytes } from './canonical.js';

export interface UnsignedDeviceDelegation {
  readonly version: number;
  readonly parentDid: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly devicePublicKeyHex: string;
  readonly authorizedAt: number;
  readonly validUntil: number;
  readonly nonce: string;
}

export interface DeviceDelegationAssertion extends UnsignedDeviceDelegation {
  readonly delegationSignature: string;
}

/**
 * Creates a cryptographically signed device delegation assertion.
 * Root Identity Key signs the canonical payload authorizing the device key.
 */
export function createDeviceDelegation(
  identityKey: SovraIdentityKey,
  deviceKey: SovraDeviceKey,
  validUntilSeconds: number,
  nonce?: string,
): DeviceDelegationAssertion {
  if (deviceKey.parentDid !== identityKey.did) {
    throw new ValidationError('Device parent DID does not match issuing identity DID', {
      deviceParentDid: deviceKey.parentDid,
      identityDid: identityKey.did,
    });
  }

  const authorizedAt = Math.floor(Date.now() / 1000);
  if (validUntilSeconds <= authorizedAt) {
    throw new ValidationError('Delegation validity expiration must be in the future', {
      authorizedAt,
      validUntilSeconds,
    });
  }

  const delegationNonce = nonce ?? bytesToHex(secureRandomBytes(16));

  const unsignedPayload: UnsignedDeviceDelegation = {
    version: 1,
    parentDid: identityKey.did,
    deviceId: deviceKey.deviceId,
    deviceName: deviceKey.deviceName,
    devicePublicKeyHex: deviceKey.publicKeyHex,
    authorizedAt,
    validUntil: validUntilSeconds,
    nonce: delegationNonce,
  };

  const canonicalBytes = canonicalizeToBytes(unsignedPayload);
  const signatureHex = identityKey.signHex(canonicalBytes);

  deviceKey.attachDelegation(signatureHex);

  return {
    ...unsignedPayload,
    delegationSignature: signatureHex,
  };
}

/**
 * Verifies a device delegation assertion offline without server dependency.
 */
export function verifyDeviceDelegation(
  assertion: DeviceDelegationAssertion,
  currentTimestampSeconds = Math.floor(Date.now() / 1000),
  maxClockDriftSeconds = 300,
): boolean {
  if (assertion.version !== 1) return false;

  // Check expiration
  if (currentTimestampSeconds > assertion.validUntil) {
    return false;
  }

  // Check future authorization drift
  if (assertion.authorizedAt > currentTimestampSeconds + maxClockDriftSeconds) {
    return false;
  }

  try {
    const parentPublicKey = decodeEd25519DidKey(assertion.parentDid);
    const signatureBytes = hexToBytes(assertion.delegationSignature);

    const unsignedPayload: UnsignedDeviceDelegation = {
      version: assertion.version,
      parentDid: assertion.parentDid,
      deviceId: assertion.deviceId,
      deviceName: assertion.deviceName,
      devicePublicKeyHex: assertion.devicePublicKeyHex,
      authorizedAt: assertion.authorizedAt,
      validUntil: assertion.validUntil,
      nonce: assertion.nonce,
    };

    const canonicalBytes = canonicalizeToBytes(unsignedPayload);
    return verifyEd25519(parentPublicKey, canonicalBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Verifies an action signed by a delegated device key on behalf of an identity.
 */
export function verifyDeviceSignedAction(
  expectedParentDid: string,
  delegation: DeviceDelegationAssertion,
  payloadBytes: Uint8Array,
  deviceSignatureHex: string,
  isKeyRevoked: (keyHex: string) => boolean,
  currentTimestampSeconds = Math.floor(Date.now() / 1000),
): boolean {
  // 1. Parent DID must match expected author
  if (delegation.parentDid !== expectedParentDid) {
    return false;
  }

  // 2. Device key must not be revoked
  if (isKeyRevoked(delegation.devicePublicKeyHex)) {
    return false;
  }

  // 3. Delegation assertion must be valid and unexpired
  if (!verifyDeviceDelegation(delegation, currentTimestampSeconds)) {
    return false;
  }

  // 4. Action signature must match device public key
  try {
    const devicePublicKey = hexToBytes(delegation.devicePublicKeyHex);
    const deviceSignature = hexToBytes(deviceSignatureHex);
    return verifyEd25519(devicePublicKey, payloadBytes, deviceSignature);
  } catch {
    return false;
  }
}
