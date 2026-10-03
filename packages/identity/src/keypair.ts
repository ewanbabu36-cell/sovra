import {
  generateEd25519KeyPair,
  signEd25519,
  bytesToHex,
  hexToBytes,
  getEd25519PublicKey,
} from '@sovra/crypto';
import { encodeEd25519DidKey } from './did.js';
import { KeyRole } from './keys.js';

/**
 * Concrete Identity Key implementation.
 * Holds root Ed25519 keypair for identity assertions and device delegations.
 * Private key is kept strictly within private state and is NEVER serialized to JSON.
 */
export class SovraIdentityKey {
  public readonly id: string;
  public readonly role: KeyRole = 'identity';
  public readonly did: string;
  public readonly publicKeyBytes: Uint8Array;
  public readonly publicKeyHex: string;
  public readonly createdAt: number;

  #privateKey: Uint8Array;

  constructor(privateKey: Uint8Array, createdAt = Math.floor(Date.now() / 1000)) {
    this.publicKeyBytes = getEd25519PublicKey(privateKey);
    this.publicKeyHex = bytesToHex(this.publicKeyBytes);
    this.did = encodeEd25519DidKey(this.publicKeyBytes);
    this.id = `ik-${this.did.slice(-8)}`;
    this.createdAt = createdAt;
    this.#privateKey = new Uint8Array(privateKey);
  }

  public static generate(createdAt?: number): SovraIdentityKey {
    const pair = generateEd25519KeyPair();
    return new SovraIdentityKey(pair.privateKey, createdAt);
  }

  public static fromPrivateKeyHex(hex: string, createdAt?: number): SovraIdentityKey {
    const bytes = hexToBytes(hex);
    return new SovraIdentityKey(bytes, createdAt);
  }

  public sign(message: Uint8Array): Uint8Array {
    return signEd25519(this.#privateKey, message);
  }

  public signHex(message: Uint8Array): string {
    return bytesToHex(this.sign(message));
  }

  /**
   * Safe serialization: Private key is NEVER exposed in JSON.
   */
  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      role: this.role,
      did: this.did,
      publicKeyHex: this.publicKeyHex,
      createdAt: this.createdAt,
    };
  }
}

/**
 * Concrete Device Key implementation.
 * Holds delegated device Ed25519 keypair bound to a physical hardware client.
 */
export class SovraDeviceKey {
  public readonly id: string;
  public readonly role: KeyRole = 'device';
  public readonly deviceId: string;
  public readonly deviceName: string;
  public readonly parentDid: string;
  public readonly publicKeyBytes: Uint8Array;
  public readonly publicKeyHex: string;
  public readonly createdAt: number;
  public readonly validUntil: number;
  public delegationSignature: string | null = null;

  #privateKey: Uint8Array;

  constructor(
    deviceId: string,
    deviceName: string,
    parentDid: string,
    privateKey: Uint8Array,
    validUntil: number,
    createdAt = Math.floor(Date.now() / 1000),
  ) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.parentDid = parentDid;
    this.publicKeyBytes = getEd25519PublicKey(privateKey);
    this.publicKeyHex = bytesToHex(this.publicKeyBytes);
    this.id = `dk-${deviceId}`;
    this.createdAt = createdAt;
    this.validUntil = validUntil;
    this.#privateKey = new Uint8Array(privateKey);
  }

  public static generate(
    deviceId: string,
    deviceName: string,
    parentDid: string,
    validUntilSeconds: number,
  ): SovraDeviceKey {
    const pair = generateEd25519KeyPair();
    return new SovraDeviceKey(deviceId, deviceName, parentDid, pair.privateKey, validUntilSeconds);
  }

  public sign(message: Uint8Array): Uint8Array {
    return signEd25519(this.#privateKey, message);
  }

  public signHex(message: Uint8Array): string {
    return bytesToHex(this.sign(message));
  }

  public attachDelegation(signatureHex: string): void {
    this.delegationSignature = signatureHex;
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      role: this.role,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      parentDid: this.parentDid,
      publicKeyHex: this.publicKeyHex,
      createdAt: this.createdAt,
      validUntil: this.validUntil,
      delegationSignature: this.delegationSignature,
    };
  }
}
