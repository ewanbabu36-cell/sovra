import {
  encodeBase58Btc,
  decodeBase58Btc,
  hexToBytes,
  bytesToHex,
  signEd25519,
  verifyEd25519,
  secureRandomBytes,
} from '@sovra/crypto';
import {
  DeviceDelegation,
  SovraDeviceKey,
  verifyDeviceDelegation,
  RevocationRegistry,
  canonicalJsonSerialize,
} from '@sovra/identity';
import { PeerIdentity, PeerIdentityBinding } from './types.js';
import { PeerAuthenticationError } from './errors.js';
import { Result, ok, err, ValidationError } from '@sovra/shared';

// Protobuf & Identity Multihash header for Ed25519 in libp2p
// 0x00 = identity multihash, 0x24 = length 36
// 0x08, 0x01 = KeyType.Ed25519 (tag 1, val 1)
// 0x12, 0x20 = Data (tag 2, len 32)
const LIBP2P_ED25519_HEADER = new Uint8Array([0x00, 0x24, 0x08, 0x01, 0x12, 0x20]);

/**
 * Derives a standard libp2p Ed25519 Peer ID (starting with 12D3KooW...)
 * from an Ed25519 public key.
 */
export function derivePeerId(devicePublicKey: Uint8Array | string): string {
  const pubBytes =
    typeof devicePublicKey === 'string' ? hexToBytes(devicePublicKey) : devicePublicKey;
  if (pubBytes.length !== 32) {
    throw new PeerAuthenticationError(
      'Ed25519 public key must be exactly 32 bytes to derive Peer ID',
    );
  }
  const fullBytes = new Uint8Array(LIBP2P_ED25519_HEADER.length + pubBytes.length);
  fullBytes.set(LIBP2P_ED25519_HEADER, 0);
  fullBytes.set(pubBytes, LIBP2P_ED25519_HEADER.length);
  return encodeBase58Btc(fullBytes);
}

/**
 * Extracts the 32-byte Ed25519 public key from a standard libp2p Peer ID.
 */
export function extractPublicKeyFromPeerId(peerId: string): Uint8Array {
  const decoded = decodeBase58Btc(peerId);
  if (decoded.length !== 38) {
    throw new PeerAuthenticationError('Invalid libp2p Ed25519 Peer ID length', { peerId });
  }
  for (let i = 0; i < LIBP2P_ED25519_HEADER.length; i++) {
    if (decoded[i] !== LIBP2P_ED25519_HEADER[i]) {
      throw new PeerAuthenticationError('Peer ID does not have valid Ed25519 header', { peerId });
    }
  }
  return decoded.slice(LIBP2P_ED25519_HEADER.length);
}

/**
 * Generates a PeerIdentity struct from a public key.
 */
export function createPeerIdentity(devicePublicKey: Uint8Array | string): PeerIdentity {
  const pubBytes =
    typeof devicePublicKey === 'string' ? hexToBytes(devicePublicKey) : devicePublicKey;
  return {
    peerId: derivePeerId(pubBytes),
    publicKeyHex: bytesToHex(pubBytes),
  };
}

/**
 * Creates and signs a PeerIdentityBinding, linking a libp2p Peer ID,
 * a Device Key, and a Sovra Master Identity DID with delegation.
 */
export function createPeerIdentityBinding(
  deviceKey: SovraDeviceKey,
  masterDid: string,
  delegation: DeviceDelegation,
): PeerIdentityBinding {
  const peerId = derivePeerId(deviceKey.publicKeyBytes);
  const now = Math.floor(Date.now() / 1000);

  // Validate that the delegation matches this device
  if (delegation.deviceId !== deviceKey.deviceId) {
    throw new PeerAuthenticationError('Delegation deviceId does not match device key', {
      delegationDeviceId: delegation.deviceId,
      deviceKeyId: deviceKey.deviceId,
    });
  }
  if (delegation.devicePublicKeyHex !== deviceKey.publicKeyHex) {
    throw new PeerAuthenticationError('Delegation devicePublicKey does not match device key', {
      delegationPub: delegation.devicePublicKeyHex,
      deviceKeyPub: deviceKey.publicKeyHex,
    });
  }
  if (delegation.parentDid !== masterDid) {
    throw new PeerAuthenticationError('Delegation parent DID does not match master DID', {
      delegationParent: delegation.parentDid,
      masterDid,
    });
  }

  const payloadToSign = {
    peerId,
    deviceId: deviceKey.deviceId,
    devicePublicKeyHex: deviceKey.publicKeyHex,
    masterDid,
    timestamp: now,
  };

  const canonicalBytes = new TextEncoder().encode(canonicalJsonSerialize(payloadToSign));
  const signature = deviceKey.sign(canonicalBytes);

  return {
    peerId,
    deviceId: deviceKey.deviceId,
    devicePublicKeyHex: deviceKey.publicKeyHex,
    masterDid,
    delegation,
    timestamp: now,
    signatureHex: bytesToHex(signature),
  };
}

/**
 * Verifies a PeerIdentityBinding:
 * 1. Checks that the Peer ID is cryptographically derived from the device public key.
 * 2. Checks that the device public key matches the delegation token.
 * 3. Verifies the master DID signature on the delegation token.
 * 4. Checks delegation expiration.
 * 5. Verifies the device signature on the binding statement.
 * 6. Checks against RevocationRegistry (if provided) to ensure the device is not revoked.
 */
export function verifyPeerIdentityBinding(
  binding: PeerIdentityBinding,
  revocationRegistry?: RevocationRegistry,
): boolean {
  try {
    // 1. Verify Peer ID derivation
    const derived = derivePeerId(binding.devicePublicKeyHex);
    if (derived !== binding.peerId) {
      return false;
    }

    // 2. Verify delegation consistency
    if (
      binding.delegation.deviceId !== binding.deviceId ||
      binding.delegation.devicePublicKeyHex !== binding.devicePublicKeyHex ||
      binding.delegation.parentDid !== binding.masterDid
    ) {
      return false;
    }

    // 3. Verify Master DID signature on delegation
    const isDelegationValid = verifyDeviceDelegation(binding.delegation);
    if (!isDelegationValid) {
      return false;
    }

    // 4. Verify device signature on binding
    if (!binding.signatureHex) {
      return false;
    }
    const payloadToVerify = {
      peerId: binding.peerId,
      deviceId: binding.deviceId,
      devicePublicKeyHex: binding.devicePublicKeyHex,
      masterDid: binding.masterDid,
      timestamp: binding.timestamp,
    };
    const canonicalBytes = new TextEncoder().encode(canonicalJsonSerialize(payloadToVerify));
    const devicePubBytes = hexToBytes(binding.devicePublicKeyHex);
    const sigBytes = hexToBytes(binding.signatureHex);
    const isSignatureValid = verifyEd25519(devicePubBytes, canonicalBytes, sigBytes);
    if (!isSignatureValid) {
      return false;
    }

    // 5. Check RevocationRegistry
    if (revocationRegistry) {
      if (revocationRegistry.isKeyRevoked(binding.devicePublicKeyHex)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export interface SignedPeerRecord {
  readonly version: 1;
  readonly peerId: string;
  readonly did: string;
  readonly multiaddrs: readonly string[];
  readonly httpUrl?: string | undefined;
  readonly region?: string | undefined;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
  readonly signatureHex: string;
}

export interface CreateSignedPeerRecordOptions {
  readonly peerId: string;
  readonly did: string;
  readonly multiaddrs: readonly string[];
  readonly signingKey: SovraDeviceKey | Uint8Array;
  readonly httpUrl?: string | undefined;
  readonly region?: string | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly issuedAt?: number | undefined;
}

function buildCanonicalPeerRecordPayload(record: Omit<SignedPeerRecord, 'signatureHex'>): Uint8Array {
  const payload = {
    version: record.version,
    peerId: record.peerId,
    did: record.did,
    multiaddrs: [...record.multiaddrs],
    httpUrl: record.httpUrl ?? null,
    region: record.region ?? null,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    nonce: record.nonce,
  };
  return new TextEncoder().encode(canonicalJsonSerialize(payload));
}

/**
 * Signs a self-certified peer advertisement using the node's Ed25519 PeerID keypair.
 */
export function createSignedPeerRecord(opts: CreateSignedPeerRecordOptions): SignedPeerRecord {
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(30, opts.ttlSeconds ?? 3600);
  const expiresAt = issuedAt + ttlSeconds;
  const nonce = bytesToHex(secureRandomBytes(16));

  const unsigned: Omit<SignedPeerRecord, 'signatureHex'> = {
    version: 1,
    peerId: opts.peerId,
    did: opts.did,
    multiaddrs: opts.multiaddrs,
    ...(opts.httpUrl ? { httpUrl: opts.httpUrl.trim().replace(/\/+$/, '') } : {}),
    ...(opts.region ? { region: opts.region } : {}),
    issuedAt,
    expiresAt,
    nonce,
  };

  const canonicalBytes = buildCanonicalPeerRecordPayload(unsigned);
  const sigBytes =
    opts.signingKey instanceof Uint8Array
      ? signEd25519(opts.signingKey, canonicalBytes)
      : opts.signingKey.sign(canonicalBytes);

  return {
    ...unsigned,
    signatureHex: bytesToHex(sigBytes),
  };
}

/**
 * Cryptographically verifies a SignedPeerRecord against the public key embedded in record.peerId
 * and returns a structured Result explaining why any invalid record was rejected (fail closed).
 */
export function verifySignedPeerRecordResult(
  record: SignedPeerRecord,
  seenNonces?: Set<string>,
  nowSec = Math.floor(Date.now() / 1000),
): Result<SignedPeerRecord> {
  try {
    if (!record || record.version !== 1) {
      return err(new ValidationError('Invalid signed peer record version'));
    }
    if (!record.peerId || !record.did || !record.nonce || !record.signatureHex) {
      return err(new ValidationError('Missing required signed peer record fields'));
    }
    if (!Array.isArray(record.multiaddrs) || record.multiaddrs.length === 0) {
      return err(new ValidationError('Signed peer record must include at least one multiaddr'));
    }
    if (record.expiresAt <= record.issuedAt) {
      return err(new ValidationError('Signed peer record lifetime must be strictly positive'));
    }
    if (record.expiresAt < nowSec) {
      return err(new ValidationError('Signed peer record has expired'));
    }
    if (record.issuedAt > nowSec + 300) {
      return err(new ValidationError('Signed peer record issuedAt exceeds maximum clock skew'));
    }

    const replayKey = `${record.peerId}:${record.nonce}`;
    if (seenNonces && seenNonces.has(replayKey)) {
      return err(new ValidationError('Replayed signed peer record nonce rejected'));
    }

    const peerPubBytes = extractPublicKeyFromPeerId(record.peerId);
    const sigBytes = hexToBytes(record.signatureHex);
    if (sigBytes.length !== 64) {
      return err(new ValidationError('Invalid Ed25519 signature length on signed peer record'));
    }

    const canonicalBytes = buildCanonicalPeerRecordPayload(record);
    const valid = verifyEd25519(peerPubBytes, canonicalBytes, sigBytes);
    if (!valid) {
      return err(new ValidationError('Invalid Ed25519 signature on signed peer record'));
    }
    if (seenNonces) {
      seenNonces.add(replayKey);
    }
    return ok(record);
  } catch (e) {
    return err(new ValidationError(e instanceof Error ? e.message : 'Signed peer record verification failed'));
  }
}

/**
 * Cryptographically verifies a SignedPeerRecord against the public key embedded in record.peerId.
 * Rejects tampered payloads, forged PeerIDs, expired records, future clock skew (>5m), and replayed nonces.
 */
export function verifySignedPeerRecord(
  record: SignedPeerRecord,
  seenNonces?: Set<string>,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  return verifySignedPeerRecordResult(record, seenNonces, nowSec).ok;
}
