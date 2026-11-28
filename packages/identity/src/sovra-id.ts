import {
  bytesToHex,
  canonicalCborDecode,
  canonicalCborEncode,
  decodeBech32m,
  decryptChaCha20Poly1305,
  encodeBech32m,
  encryptChaCha20Poly1305,
  generateEd25519KeyPair,
  generateX25519KeyPair,
  getEd25519PublicKey,
  getX25519PublicKey,
  hexToBytes,
  scryptDerive,
  secureRandomBytes,
  sha256,
  signEd25519,
  verifyEd25519,
} from '@sovra/crypto';
import { ValidationError } from '@sovra/shared';

export const SOVRA_ID_VERSION = 1;
export const SOVRA_ID_HRP = 'sovra';
export const SOVRA_ENC_ID_HRP = 'sovraenc';
export const SOVRA_ID_DOMAIN_TAG = 'SOVRA-ID-v1';
export const SOVRA_ENC_ID_DOMAIN_TAG = 'SOVRA-ENC-ID-v1';
export const SOVRA_ID_OBJ_SIGN_TAG = 'SOVRA-ID-OBJ-v1';
export const SOVRA_DEVICE_AUTH_TAG = 'SOVRA-DEV-AUTH-v1';
export const SOVRA_DEVICE_REVOKE_TAG = 'SOVRA-DEV-REVOKE-v1';
export const SOVRA_EPOCH_ROTATE_TAG = 'SOVRA-EPOCH-ROTATE-v1';
export const SOVRA_ENC_ROTATE_TAG = 'SOVRA-ENC-ROTATE-v1';
export const SOVRA_PEER_BIND_TAG = 'SOVRA-PEER-BIND-v1';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Derives the frozen SHA-256("SOVRA-ID-v1" || signingPublicKey32) digest.
 */
export function deriveSovraIdDigest(signingPublicKey: Uint8Array): Uint8Array {
  if (signingPublicKey.length !== 32) {
    throw new ValidationError(`Ed25519 signing public key must be 32 bytes, got ${signingPublicKey.length}`);
  }
  return sha256(concatBytes(textEncoder.encode(SOVRA_ID_DOMAIN_TAG), signingPublicKey));
}

/**
 * Encodes a 32-byte Ed25519 signing public key into canonical Bech32m `sovra1...` identity ID.
 */
export function encodeSovraIdentityId(signingPublicKey: Uint8Array): string {
  const digest = deriveSovraIdDigest(signingPublicKey);
  const versioned = new Uint8Array(33);
  versioned[0] = SOVRA_ID_VERSION;
  versioned.set(digest, 1);
  return encodeBech32m(SOVRA_ID_HRP, versioned);
}

/**
 * Derives the domain-separated Encryption Key ID digest SHA-256("SOVRA-ENC-ID-v1" || x25519PublicKey32).
 */
export function deriveSovraEncryptionKeyDigest(encryptionPublicKey: Uint8Array): Uint8Array {
  if (encryptionPublicKey.length !== 32) {
    throw new ValidationError(`X25519 encryption public key must be 32 bytes, got ${encryptionPublicKey.length}`);
  }
  return sha256(concatBytes(textEncoder.encode(SOVRA_ENC_ID_DOMAIN_TAG), encryptionPublicKey));
}

/**
 * Encodes a 32-byte X25519 public key into canonical Bech32m `sovraenc1...` Encryption Key ID.
 */
export function encodeSovraEncryptionKeyId(encryptionPublicKey: Uint8Array): string {
  const digest = deriveSovraEncryptionKeyDigest(encryptionPublicKey);
  const versioned = new Uint8Array(33);
  versioned[0] = SOVRA_ID_VERSION;
  versioned.set(digest, 1);
  return encodeBech32m(SOVRA_ENC_ID_HRP, versioned);
}

export function decodeSovraEncryptionKeyId(encKeyId: string): { version: number; digestHex: string } {
  const { data } = decodeBech32m(encKeyId, SOVRA_ENC_ID_HRP);
  if (data.length !== 33 || data[0] !== SOVRA_ID_VERSION) {
    throw new ValidationError(`Invalid SOVRA Encryption Key ID '${encKeyId}'`);
  }
  return { version: data[0]!, digestHex: bytesToHex(data.subarray(1)) };
}

export function isValidSovraEncryptionKeyId(encKeyId: string): boolean {
  try {
    decodeSovraEncryptionKeyId(encKeyId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes and checksum-verifies a `sovra1...` identity ID back to version & SHA-256 digest.
 */
export function decodeSovraIdentityId(identityId: string): { version: number; digestHex: string } {
  const { data } = decodeBech32m(identityId, SOVRA_ID_HRP);
  if (data.length !== 33) {
    throw new ValidationError(`Invalid sovra identity binary length: expected 33 bytes, got ${data.length}`);
  }
  const version = data[0]!;
  if (version !== SOVRA_ID_VERSION) {
    throw new ValidationError(`Unsupported SOVRA-ID version ${version}`);
  }
  return {
    version,
    digestHex: bytesToHex(data.subarray(1)),
  };
}

export function isValidSovraIdentityId(identityId: string): boolean {
  try {
    decodeSovraIdentityId(identityId);
    return true;
  } catch {
    return false;
  }
}

export type SovraIdentityCapability = 'social' | 'messaging' | 'commerce' | 'business' | 'governance' | 'apps';

export interface UnsignedSovraIdentityObject {
  readonly version: 1;
  readonly identity_id: string;
  readonly signing_public_key: string;
  readonly encryption_public_key: string;
  readonly created_at: number;
  readonly key_epoch: number;
  readonly capabilities: readonly SovraIdentityCapability[];
}

export interface SovraIdentityObject extends UnsignedSovraIdentityObject {
  readonly signature: string;
}

export interface SovraDeviceRecord {
  readonly version: 1;
  readonly identity_id: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly device_public_key: string;
  readonly capabilities: readonly string[];
  readonly key_epoch: number;
  readonly authorized_at: number;
  readonly expires_at: number;
  readonly revoked_at?: number | undefined;
  readonly authorization_signature: string;
}

export interface SovraDeviceRevocationRecord {
  readonly version: 1;
  readonly identity_id: string;
  readonly device_id: string;
  readonly device_public_key: string;
  readonly key_epoch: number;
  readonly revoked_at: number;
  readonly reason: string;
  readonly signature: string;
}

export interface SovraKeyEpochRotationRecord {
  readonly version: 1;
  readonly previous_identity_id: string;
  readonly previous_signing_public_key: string;
  readonly new_identity_id: string;
  readonly new_signing_public_key: string;
  readonly new_encryption_public_key: string;
  readonly previous_epoch: number;
  readonly new_epoch: number;
  readonly rotated_at: number;
  readonly previous_key_signature: string;
  readonly new_key_signature: string;
}

export interface SovraEncryptedIdentityBackup {
  readonly version: 1;
  readonly identity_id: string;
  readonly key_epoch: number;
  readonly kdf: 'scrypt';
  readonly kdf_params: {
    readonly N: number;
    readonly r: number;
    readonly p: number;
  };
  readonly salt_hex: string;
  readonly nonce_hex: string;
  readonly ciphertext_hex: string;
}

export interface SovraLocalIdentitySecrets {
  readonly identity_id: string;
  readonly signing_private_key_hex: string;
  readonly signing_public_key_hex: string;
  readonly encryption_private_key_hex: string;
  readonly encryption_public_key_hex: string;
  readonly key_epoch: number;
  readonly created_at: number;
  readonly capabilities: readonly SovraIdentityCapability[];
}

function signDomainCbor(domainTag: string, payload: unknown, signingPrivateKey: Uint8Array): string {
  const cborBytes = canonicalCborEncode(payload);
  const digest = sha256(concatBytes(textEncoder.encode(domainTag), cborBytes));
  return bytesToHex(signEd25519(signingPrivateKey, digest));
}

function verifyDomainCbor(
  domainTag: string,
  payload: unknown,
  signatureHex: string,
  signingPublicKey: Uint8Array,
): boolean {
  try {
    const cborBytes = canonicalCborEncode(payload);
    const digest = sha256(concatBytes(textEncoder.encode(domainTag), cborBytes));
    return verifyEd25519(signingPublicKey, digest, hexToBytes(signatureHex));
  } catch {
    return false;
  }
}

export function createSovraIdentityObject(params: {
  signingPrivateKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
  createdAt?: number;
  keyEpoch?: number;
  capabilities?: readonly SovraIdentityCapability[];
}): SovraIdentityObject {
  const signingPublicKey = getEd25519PublicKey(params.signingPrivateKey);
  const signingHex = bytesToHex(signingPublicKey);
  const encryptionHex = bytesToHex(params.encryptionPublicKey);
  if (signingHex === encryptionHex) {
    throw new ValidationError('Signing and encryption keys MUST be cryptographically separate');
  }
  const unsigned: UnsignedSovraIdentityObject = {
    version: 1,
    identity_id: encodeSovraIdentityId(signingPublicKey),
    signing_public_key: signingHex,
    encryption_public_key: encryptionHex,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    key_epoch: params.keyEpoch ?? 1,
    capabilities: params.capabilities ?? ['social', 'messaging', 'commerce'],
  };
  return {
    ...unsigned,
    signature: signDomainCbor(SOVRA_ID_OBJ_SIGN_TAG, unsigned, params.signingPrivateKey),
  };
}

export function verifySovraIdentityObject(obj: SovraIdentityObject): boolean {
  if (!obj || obj.version !== 1 || obj.key_epoch < 1) return false;
  if (!obj.signing_public_key || !obj.encryption_public_key) return false;
  if (obj.signing_public_key.toLowerCase() === obj.encryption_public_key.toLowerCase()) return false;
  try {
    const signingPub = hexToBytes(obj.signing_public_key);
    const derivedId = encodeSovraIdentityId(signingPub);
    if (derivedId !== obj.identity_id) return false;
    const unsigned: UnsignedSovraIdentityObject = {
      version: 1,
      identity_id: obj.identity_id,
      signing_public_key: obj.signing_public_key,
      encryption_public_key: obj.encryption_public_key,
      created_at: obj.created_at,
      key_epoch: obj.key_epoch,
      capabilities: obj.capabilities,
    };
    return verifyDomainCbor(SOVRA_ID_OBJ_SIGN_TAG, unsigned, obj.signature, signingPub);
  } catch {
    return false;
  }
}

export function authorizeSovraDevice(params: {
  identityObject: SovraIdentityObject;
  signingPrivateKey: Uint8Array;
  deviceId: string;
  deviceName: string;
  devicePublicKeyHex: string;
  capabilities?: readonly string[] | undefined;
  authorizedAt?: number | undefined;
  expiresAt?: number | undefined;
}): SovraDeviceRecord {
  const pub = getEd25519PublicKey(params.signingPrivateKey);
  if (bytesToHex(pub) !== params.identityObject.signing_public_key) {
    throw new ValidationError('Signing private key does not match owner identity object');
  }
  const authorizedAt = params.authorizedAt ?? Math.floor(Date.now() / 1000);
  const expiresAt = params.expiresAt ?? authorizedAt + 365 * 86400;
  if (expiresAt <= authorizedAt) {
    throw new ValidationError('Device expiration must be after authorization timestamp');
  }
  const unsigned = {
    version: 1 as const,
    identity_id: params.identityObject.identity_id,
    device_id: params.deviceId,
    device_name: params.deviceName,
    device_public_key: params.devicePublicKeyHex.toLowerCase(),
    capabilities: params.capabilities ?? ['social', 'messaging', 'commerce'],
    key_epoch: params.identityObject.key_epoch,
    authorized_at: authorizedAt,
    expires_at: expiresAt,
  };
  return {
    ...unsigned,
    authorization_signature: signDomainCbor(SOVRA_DEVICE_AUTH_TAG, unsigned, params.signingPrivateKey),
  };
}

export function verifySovraDeviceAuthorization(
  record: SovraDeviceRecord,
  ownerSigningPublicKeyHex: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!record || record.version !== 1) return false;
  if (record.revoked_at !== undefined) return false;
  if (nowSec > record.expires_at) return false;
  try {
    const ownerPub = hexToBytes(ownerSigningPublicKeyHex);
    if (encodeSovraIdentityId(ownerPub) !== record.identity_id) return false;
    const unsigned = {
      version: 1,
      identity_id: record.identity_id,
      device_id: record.device_id,
      device_name: record.device_name,
      device_public_key: record.device_public_key.toLowerCase(),
      capabilities: record.capabilities,
      key_epoch: record.key_epoch,
      authorized_at: record.authorized_at,
      expires_at: record.expires_at,
    };
    return verifyDomainCbor(SOVRA_DEVICE_AUTH_TAG, unsigned, record.authorization_signature, ownerPub);
  } catch {
    return false;
  }
}

export function revokeSovraDevice(params: {
  identityObject: SovraIdentityObject;
  signingPrivateKey: Uint8Array;
  deviceId: string;
  devicePublicKeyHex: string;
  reason?: string;
  revokedAt?: number;
}): SovraDeviceRevocationRecord {
  const pub = getEd25519PublicKey(params.signingPrivateKey);
  if (bytesToHex(pub) !== params.identityObject.signing_public_key) {
    throw new ValidationError('Signing private key does not match identity owner');
  }
  const unsigned = {
    version: 1 as const,
    identity_id: params.identityObject.identity_id,
    device_id: params.deviceId,
    device_public_key: params.devicePublicKeyHex.toLowerCase(),
    key_epoch: params.identityObject.key_epoch,
    revoked_at: params.revokedAt ?? Math.floor(Date.now() / 1000),
    reason: params.reason ?? 'revoked_by_owner',
  };
  return {
    ...unsigned,
    signature: signDomainCbor(SOVRA_DEVICE_REVOKE_TAG, unsigned, params.signingPrivateKey),
  };
}

export function verifySovraDeviceRevocation(
  revocation: SovraDeviceRevocationRecord,
  ownerSigningPublicKeyHex: string,
): boolean {
  if (!revocation || revocation.version !== 1) return false;
  try {
    const ownerPub = hexToBytes(ownerSigningPublicKeyHex);
    if (encodeSovraIdentityId(ownerPub) !== revocation.identity_id) return false;
    const unsigned = {
      version: 1,
      identity_id: revocation.identity_id,
      device_id: revocation.device_id,
      device_public_key: revocation.device_public_key.toLowerCase(),
      key_epoch: revocation.key_epoch,
      revoked_at: revocation.revoked_at,
      reason: revocation.reason,
    };
    return verifyDomainCbor(SOVRA_DEVICE_REVOKE_TAG, unsigned, revocation.signature, ownerPub);
  } catch {
    return false;
  }
}

export function rotateSovraIdentityEpoch(params: {
  previousIdentity: SovraIdentityObject;
  previousSigningPrivateKey: Uint8Array;
  newSigningPrivateKey?: Uint8Array;
  newEncryptionPrivateKey?: Uint8Array;
  rotatedAt?: number;
}): {
  newIdentityObject: SovraIdentityObject;
  rotationRecord: SovraKeyEpochRotationRecord;
  newSigningPrivateKey: Uint8Array;
  newEncryptionPrivateKey: Uint8Array;
} {
  const prevPub = getEd25519PublicKey(params.previousSigningPrivateKey);
  if (bytesToHex(prevPub) !== params.previousIdentity.signing_public_key) {
    throw new ValidationError('Previous signing key mismatch');
  }
  const nextSignPair = params.newSigningPrivateKey
    ? { privateKey: params.newSigningPrivateKey, publicKey: getEd25519PublicKey(params.newSigningPrivateKey) }
    : generateEd25519KeyPair();
  const nextEncPair = params.newEncryptionPrivateKey
    ? {
        privateKey: params.newEncryptionPrivateKey,
        publicKey: getX25519PublicKey(params.newEncryptionPrivateKey),
      }
    : generateX25519KeyPair();

  const rotatedAt = params.rotatedAt ?? Math.floor(Date.now() / 1000);
  const newEpoch = params.previousIdentity.key_epoch + 1;
  const newIdentityObject = createSovraIdentityObject({
    signingPrivateKey: nextSignPair.privateKey,
    encryptionPublicKey: nextEncPair.publicKey,
    createdAt: rotatedAt,
    keyEpoch: newEpoch,
    capabilities: params.previousIdentity.capabilities,
  });

  const unsignedRotation = {
    version: 1 as const,
    previous_identity_id: params.previousIdentity.identity_id,
    previous_signing_public_key: params.previousIdentity.signing_public_key,
    new_identity_id: newIdentityObject.identity_id,
    new_signing_public_key: newIdentityObject.signing_public_key,
    new_encryption_public_key: newIdentityObject.encryption_public_key,
    previous_epoch: params.previousIdentity.key_epoch,
    new_epoch: newEpoch,
    rotated_at: rotatedAt,
  };

  return {
    newIdentityObject,
    rotationRecord: {
      ...unsignedRotation,
      previous_key_signature: signDomainCbor(
        SOVRA_EPOCH_ROTATE_TAG,
        unsignedRotation,
        params.previousSigningPrivateKey,
      ),
      new_key_signature: signDomainCbor(SOVRA_EPOCH_ROTATE_TAG, unsignedRotation, nextSignPair.privateKey),
    },
    newSigningPrivateKey: nextSignPair.privateKey,
    newEncryptionPrivateKey: nextEncPair.privateKey,
  };
}

export function verifySovraKeyEpochRotation(record: SovraKeyEpochRotationRecord): boolean {
  if (!record || record.version !== 1) return false;
  if (record.new_epoch !== record.previous_epoch + 1) return false;
  try {
    const prevPub = hexToBytes(record.previous_signing_public_key);
    const nextPub = hexToBytes(record.new_signing_public_key);
    if (encodeSovraIdentityId(prevPub) !== record.previous_identity_id) return false;
    if (encodeSovraIdentityId(nextPub) !== record.new_identity_id) return false;
    const unsigned = {
      version: 1,
      previous_identity_id: record.previous_identity_id,
      previous_signing_public_key: record.previous_signing_public_key,
      new_identity_id: record.new_identity_id,
      new_signing_public_key: record.new_signing_public_key,
      new_encryption_public_key: record.new_encryption_public_key,
      previous_epoch: record.previous_epoch,
      new_epoch: record.new_epoch,
      rotated_at: record.rotated_at,
    };
    return (
      verifyDomainCbor(SOVRA_EPOCH_ROTATE_TAG, unsigned, record.previous_key_signature, prevPub) &&
      verifyDomainCbor(SOVRA_EPOCH_ROTATE_TAG, unsigned, record.new_key_signature, nextPub)
    );
  } catch {
    return false;
  }
}

export function exportEncryptedIdentityBackup(
  secrets: SovraLocalIdentitySecrets,
  passphrase: string,
  scryptOptions: { N?: number; r?: number; p?: number } = {},
): SovraEncryptedIdentityBackup {
  if (!passphrase || passphrase.length < 8) {
    throw new ValidationError('Backup passphrase must be at least 8 characters');
  }
  const N = scryptOptions.N ?? 4096;
  const r = scryptOptions.r ?? 8;
  const p = scryptOptions.p ?? 1;
  const salt = secureRandomBytes(16);
  const nonce = secureRandomBytes(12);
  const key = scryptDerive(passphrase, salt, { N, r, p, dkLen: 32 });
  const plaintext = canonicalCborEncode(secrets);
  const aad = textEncoder.encode(`SOVRA-BACKUP-v1:${secrets.identity_id}:${secrets.key_epoch}`);
  const ciphertext = encryptChaCha20Poly1305(key, nonce, plaintext, aad);
  key.fill(0);

  return {
    version: 1,
    identity_id: secrets.identity_id,
    key_epoch: secrets.key_epoch,
    kdf: 'scrypt',
    kdf_params: { N, r, p },
    salt_hex: bytesToHex(salt),
    nonce_hex: bytesToHex(nonce),
    ciphertext_hex: bytesToHex(ciphertext),
  };
}

export function restoreEncryptedIdentityBackup(
  backup: SovraEncryptedIdentityBackup,
  passphrase: string,
): SovraLocalIdentitySecrets {
  if (!backup || backup.version !== 1 || backup.kdf !== 'scrypt') {
    throw new ValidationError('Unsupported backup envelope format');
  }
  const salt = hexToBytes(backup.salt_hex);
  const nonce = hexToBytes(backup.nonce_hex);
  const ciphertext = hexToBytes(backup.ciphertext_hex);
  const key = scryptDerive(passphrase, salt, {
    N: backup.kdf_params.N,
    r: backup.kdf_params.r,
    p: backup.kdf_params.p,
    dkLen: 32,
  });
  const aad = textEncoder.encode(`SOVRA-BACKUP-v1:${backup.identity_id}:${backup.key_epoch}`);
  const plaintext = decryptChaCha20Poly1305(key, nonce, ciphertext, aad);
  key.fill(0);
  const decoded = canonicalCborDecode<SovraLocalIdentitySecrets>(plaintext);
  if (decoded.identity_id !== backup.identity_id) {
    throw new ValidationError('Restored identity ID does not match backup envelope');
  }
  return decoded;
}

/**
 * Local Node Identity Module implementing Section 17.2 Identity APIs:
 * identity.{create, getPublicIdentity, authorizeDevice, revokeDevice, rotateKey, exportBackup, restoreBackup, verifySignature}
 */
export class SovraIdentityModule {
  private signingPrivateKey?: Uint8Array;
  private encryptionPrivateKey?: Uint8Array;
  private identityObject?: SovraIdentityObject;
  private readonly devices = new Map<string, SovraDeviceRecord>();
  private readonly revokedDeviceIds = new Set<string>();
  private readonly revokedPubKeys = new Set<string>();
  private readonly deviceSecrets = new Map<string, Uint8Array>();

  public create(capabilities: readonly SovraIdentityCapability[] = ['social', 'messaging', 'commerce']): SovraIdentityObject {
    const signPair = generateEd25519KeyPair();
    const encPair = generateX25519KeyPair();
    this.signingPrivateKey = signPair.privateKey;
    this.encryptionPrivateKey = encPair.privateKey;
    this.identityObject = createSovraIdentityObject({
      signingPrivateKey: signPair.privateKey,
      encryptionPublicKey: encPair.publicKey,
      capabilities,
    });
    return this.identityObject;
  }

  public getPublicIdentity(): SovraIdentityObject {
    if (!this.identityObject) {
      throw new ValidationError('No local SOVRA identity initialized');
    }
    return this.identityObject;
  }

  public signBytes(payload: Uint8Array, deviceId?: string): string {
    if (deviceId) {
      if (this.revokedDeviceIds.has(deviceId)) {
        throw new ValidationError(`Device '${deviceId}' is revoked`);
      }
      const devPriv = this.deviceSecrets.get(deviceId);
      if (!devPriv) {
        throw new ValidationError(`Device '${deviceId}' private key not loaded locally`);
      }
      return bytesToHex(signEd25519(devPriv, payload));
    }
    if (!this.signingPrivateKey) {
      throw new ValidationError('No local signing private key initialized');
    }
    return bytesToHex(signEd25519(this.signingPrivateKey, payload));
  }

  public authorizeDevice(params: {
    deviceId: string;
    deviceName: string;
    devicePublicKeyHex?: string;
    capabilities?: readonly string[];
    expiresAt?: number;
  }): { record: SovraDeviceRecord; devicePrivateKeyHex?: string } {
    if (!this.identityObject || !this.signingPrivateKey) {
      throw new ValidationError('No local SOVRA identity initialized');
    }
    if (this.revokedDeviceIds.has(params.deviceId)) {
      throw new ValidationError(`Cannot re-authorize permanently revoked device '${params.deviceId}'`);
    }
    let devPubHex = params.devicePublicKeyHex;
    let devPrivHex: string | undefined;
    if (!devPubHex) {
      const pair = generateEd25519KeyPair();
      devPubHex = bytesToHex(pair.publicKey);
      devPrivHex = bytesToHex(pair.privateKey);
      this.deviceSecrets.set(params.deviceId, pair.privateKey);
    }
    const record = authorizeSovraDevice({
      identityObject: this.identityObject,
      signingPrivateKey: this.signingPrivateKey,
      deviceId: params.deviceId,
      deviceName: params.deviceName,
      devicePublicKeyHex: devPubHex,
      capabilities: params.capabilities,
      expiresAt: params.expiresAt,
    });
    this.devices.set(params.deviceId, record);
    return devPrivHex ? { record, devicePrivateKeyHex: devPrivHex } : { record };
  }

  public revokeDevice(deviceId: string, reason = 'device_compromised'): SovraDeviceRevocationRecord {
    if (!this.identityObject || !this.signingPrivateKey) {
      throw new ValidationError('No local SOVRA identity initialized');
    }
    const existing = this.devices.get(deviceId);
    if (!existing) {
      throw new ValidationError(`Unknown device '${deviceId}'`);
    }
    const rev = revokeSovraDevice({
      identityObject: this.identityObject,
      signingPrivateKey: this.signingPrivateKey,
      deviceId: existing.device_id,
      devicePublicKeyHex: existing.device_public_key,
      reason,
    });
    this.revokedDeviceIds.add(existing.device_id);
    this.revokedPubKeys.add(existing.device_public_key.toLowerCase());
    this.devices.set(existing.device_id, {
      ...existing,
      revoked_at: rev.revoked_at,
    });
    this.deviceSecrets.delete(existing.device_id);
    return rev;
  }

  public isDeviceAuthorized(deviceId: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
    if (!this.identityObject) return false;
    if (this.revokedDeviceIds.has(deviceId)) return false;
    const rec = this.devices.get(deviceId);
    if (!rec) return false;
    if (this.revokedPubKeys.has(rec.device_public_key.toLowerCase())) return false;
    return verifySovraDeviceAuthorization(rec, this.identityObject.signing_public_key, nowSec);
  }

  public getDeviceRecord(deviceId: string): SovraDeviceRecord | undefined {
    return this.devices.get(deviceId);
  }

  public rotateKey(): SovraKeyEpochRotationRecord {
    if (!this.identityObject || !this.signingPrivateKey) {
      throw new ValidationError('No local SOVRA identity initialized');
    }
    const res = rotateSovraIdentityEpoch({
      previousIdentity: this.identityObject,
      previousSigningPrivateKey: this.signingPrivateKey,
    });
    this.signingPrivateKey = res.newSigningPrivateKey;
    this.encryptionPrivateKey = res.newEncryptionPrivateKey;
    this.identityObject = res.newIdentityObject;
    return res.rotationRecord;
  }

  public exportBackup(passphrase: string, scryptOptions?: { N?: number; r?: number; p?: number }): SovraEncryptedIdentityBackup {
    if (!this.identityObject || !this.signingPrivateKey || !this.encryptionPrivateKey) {
      throw new ValidationError('No local SOVRA identity initialized');
    }
    return exportEncryptedIdentityBackup(
      {
        identity_id: this.identityObject.identity_id,
        signing_private_key_hex: bytesToHex(this.signingPrivateKey),
        signing_public_key_hex: this.identityObject.signing_public_key,
        encryption_private_key_hex: bytesToHex(this.encryptionPrivateKey),
        encryption_public_key_hex: this.identityObject.encryption_public_key,
        key_epoch: this.identityObject.key_epoch,
        created_at: this.identityObject.created_at,
        capabilities: this.identityObject.capabilities,
      },
      passphrase,
      scryptOptions,
    );
  }

  public restoreBackup(backup: SovraEncryptedIdentityBackup, passphrase: string): SovraIdentityObject {
    const secrets = restoreEncryptedIdentityBackup(backup, passphrase);
    this.signingPrivateKey = hexToBytes(secrets.signing_private_key_hex);
    this.encryptionPrivateKey = hexToBytes(secrets.encryption_private_key_hex);
    this.identityObject = createSovraIdentityObject({
      signingPrivateKey: this.signingPrivateKey,
      encryptionPublicKey: hexToBytes(secrets.encryption_public_key_hex),
      createdAt: secrets.created_at,
      keyEpoch: secrets.key_epoch,
      capabilities: secrets.capabilities,
    });
    return this.identityObject;
  }

  public verifySignature(params: {
    payload: Uint8Array;
    signatureHex: string;
    signingPublicKeyHex: string;
    deviceId?: string;
    nowSec?: number;
  }): boolean {
    if (params.deviceId) {
      if (!this.isDeviceAuthorized(params.deviceId, params.nowSec)) return false;
      const dev = this.devices.get(params.deviceId);
      if (!dev || dev.device_public_key.toLowerCase() !== params.signingPublicKeyHex.toLowerCase()) {
        return false;
      }
    }
    if (this.revokedPubKeys.has(params.signingPublicKeyHex.toLowerCase())) {
      return false;
    }
    try {
      return verifyEd25519(hexToBytes(params.signingPublicKeyHex), params.payload, hexToBytes(params.signatureHex));
    } catch {
      return false;
    }
  }

  public toSafeJSON(): Record<string, unknown> {
    return {
      identity: this.identityObject ?? null,
      encryptionKeyId: this.identityObject
        ? encodeSovraEncryptionKeyId(hexToBytes(this.identityObject.encryption_public_key))
        : null,
      activeDevices: [...this.devices.values()].filter((d) => !this.revokedDeviceIds.has(d.device_id)),
      revokedDeviceCount: this.revokedDeviceIds.size,
    };
  }

  public getFourIdentifierSummary(peerId?: string, deviceId?: string): {
    identityId: string;
    deviceId: string | null;
    peerId: string | null;
    encryptionKeyId: string;
  } {
    const id = this.getPublicIdentity();
    return {
      identityId: id.identity_id,
      deviceId: deviceId ?? ([...this.devices.keys()][0] ?? null),
      peerId: peerId ?? null,
      encryptionKeyId: encodeSovraEncryptionKeyId(hexToBytes(id.encryption_public_key)),
    };
  }
}

export interface SovraEncryptionKeyRotationRecord {
  readonly version: 1;
  readonly identity_id: string;
  readonly previous_encryption_key_id: string;
  readonly new_encryption_key_id: string;
  readonly new_encryption_public_key: string;
  readonly enc_epoch: number;
  readonly rotated_at: number;
  readonly signature: string;
}

export function rotateSovraEncryptionKey(params: {
  identityObject: SovraIdentityObject;
  signingPrivateKey: Uint8Array;
  newEncryptionPublicKey: Uint8Array;
  encEpoch: number;
  rotatedAt?: number | undefined;
}): SovraEncryptionKeyRotationRecord {
  const prevEncId = encodeSovraEncryptionKeyId(hexToBytes(params.identityObject.encryption_public_key));
  const newEncId = encodeSovraEncryptionKeyId(params.newEncryptionPublicKey);
  if (prevEncId === newEncId) {
    throw new ValidationError('New encryption key must differ from current encryption key');
  }
  const unsigned = {
    version: 1 as const,
    identity_id: params.identityObject.identity_id,
    previous_encryption_key_id: prevEncId,
    new_encryption_key_id: newEncId,
    new_encryption_public_key: bytesToHex(params.newEncryptionPublicKey),
    enc_epoch: params.encEpoch,
    rotated_at: params.rotatedAt ?? Math.floor(Date.now() / 1000),
  };
  return {
    ...unsigned,
    signature: signDomainCbor(SOVRA_ENC_ROTATE_TAG, unsigned, params.signingPrivateKey),
  };
}

export function verifySovraEncryptionKeyRotation(
  rec: SovraEncryptionKeyRotationRecord,
  ownerSigningPublicKey: Uint8Array,
): boolean {
  try {
    if (encodeSovraIdentityId(ownerSigningPublicKey) !== rec.identity_id) return false;
    if (encodeSovraEncryptionKeyId(hexToBytes(rec.new_encryption_public_key)) !== rec.new_encryption_key_id) {
      return false;
    }
    const { signature, ...unsigned } = rec;
    return verifyDomainCbor(SOVRA_ENC_ROTATE_TAG, unsigned, signature, ownerSigningPublicKey);
  } catch {
    return false;
  }
}

export interface SovraPeerIdentityBindingRecord {
  readonly version: 1;
  readonly identity_id: string;
  readonly device_id: string;
  readonly peer_id: string;
  readonly peer_public_key: string;
  readonly encryption_key_id: string;
  readonly issued_at: number;
  readonly expires_at: number;
  readonly identity_signature: string;
  readonly peer_signature: string;
}

/**
 * Cryptographically binds all four IA-01 identifiers (Sovra Identity ID, Device ID, Peer ID, Encryption Key ID)
 * via dual Ed25519 signatures from BOTH the user identity key and the P2P node peer key.
 */
export function bindPeerToSovraIdentity(params: {
  identityObject: SovraIdentityObject;
  identitySigningPrivateKey: Uint8Array;
  deviceId: string;
  peerId: string;
  peerPrivateKey: Uint8Array;
  peerPublicKey: Uint8Array;
  issuedAt?: number | undefined;
  expiresAt?: number | undefined;
}): SovraPeerIdentityBindingRecord {
  const issued_at = params.issuedAt ?? Math.floor(Date.now() / 1000);
  const expires_at = params.expiresAt ?? issued_at + 30 * 86400;
  const encryption_key_id = encodeSovraEncryptionKeyId(hexToBytes(params.identityObject.encryption_public_key));
  const unsigned = {
    version: 1 as const,
    identity_id: params.identityObject.identity_id,
    device_id: params.deviceId,
    peer_id: params.peerId,
    peer_public_key: bytesToHex(params.peerPublicKey),
    encryption_key_id,
    issued_at,
    expires_at,
  };
  return {
    ...unsigned,
    identity_signature: signDomainCbor(SOVRA_PEER_BIND_TAG, unsigned, params.identitySigningPrivateKey),
    peer_signature: signDomainCbor(SOVRA_PEER_BIND_TAG, unsigned, params.peerPrivateKey),
  };
}

export function verifySovraPeerIdentityBinding(
  binding: SovraPeerIdentityBindingRecord,
  ownerSigningPublicKey: Uint8Array,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!binding || binding.version !== 1 || nowSec > binding.expires_at) return false;
  try {
    if (encodeSovraIdentityId(ownerSigningPublicKey) !== binding.identity_id) return false;
    if (!isValidSovraEncryptionKeyId(binding.encryption_key_id)) return false;
    const peerPub = hexToBytes(binding.peer_public_key);
    const { identity_signature, peer_signature, ...unsigned } = binding;
    return (
      verifyDomainCbor(SOVRA_PEER_BIND_TAG, unsigned, identity_signature, ownerSigningPublicKey) &&
      verifyDomainCbor(SOVRA_PEER_BIND_TAG, unsigned, peer_signature, peerPub)
    );
  } catch {
    return false;
  }
}

export { textDecoder };
