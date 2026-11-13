/**
 * SOVRA CLIENT-SIDE WALLET & TRANSACTION SIGNING MODULE
 *
 * Provides non-custodial transaction creation, Ed25519 signing, address derivation,
 * and canonical byte serialization compatible with Sovra Layer-1 blockchain (chain/node/types.go).
 *
 * Cryptographic Architecture & WebAuthn PRF Compatibility:
 * 1. The Sovra Layer-1 consensus engine (Go / CometBFT) validates pure RFC 8032 Ed25519 signatures.
 * 2. WebAuthn credentials natively produce ES256 (NIST P-256) or RS256 assertions, which cannot be
 *    directly verified by an Ed25519 blockchain state machine without custom zero-knowledge precompiles.
 * 3. To bridge consumer biometrics and Layer-1 consensus without compromising security:
 *    - The user's biometric hardware authenticator (FaceID / TouchID / Android Titan) uses the
 *      WebAuthn PRF (Pseudo-Random Function) extension (hmac-secret) to derive a 256-bit secret.
 *    - This biometric secret unwraps a client-side Zero-Knowledge encrypted vault (EncryptedCloudVault)
 *      holding the user's master Ed25519 wallet private key.
 *    - The client signs the Layer-1 transaction locally in the browser / mobile enclave using `signTransaction()`.
 *    - The private key NEVER leaves the client device and is NEVER transmitted to the gateway or logged.
 * 4. The Gateway only acts as an untrusted validation & relay node (`SignedTransaction` relay).
 */

import {
    getEd25519PublicKey,
  signEd25519,
  verifyEd25519,
  sha256,
  bytesToHex,
  hexToBytes,
} from './primitives.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha512';
import { hmac } from '@noble/hashes/hmac';
import { generateBip39Mnemonic, validateBip39Mnemonic } from './bip39.js';
import { CryptoError } from './errors.js';

export type TxType =
  | 'send'
  | 'burn'
  | 'store_code'
  | 'instantiate'
  | 'execute'
  | 'delegate'
  | 'undelegate'
  | string;

export interface ChainTxPayload {
  type: TxType;
  sender: string;
  recipient?: string;
  amount?: string;
  nonce: number;
  fee: string;
  wasm_bytecode?: string;
  code_id?: number;
  contract?: string;
  label?: string;
  admin?: string;
  msg?: string;
  funds?: string;
  validator?: string;
}

export interface SignedTransaction extends ChainTxPayload {
  pub_key: string; // 32-byte Ed25519 public key as 64 hex characters
  sig: string;     // 64-byte Ed25519 signature as 128 hex characters
}

export interface WalletKeyPair {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly pubKeyHex: string;
  readonly privKeyHex: string;
  readonly mnemonic?: string;
  readonly accountIndex?: number;
  readonly derivationPath?: string;
}

export interface SignatureVerificationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Derives a deterministic Sovra Layer-1 address from an Ed25519 public key:
 * address = "sovra1" + hex(sha256(pubKey)[:20])
 * Exactly matches chain/x/auth/keeper.go#ComputeAddressFromPubKey.
 */
export function computeAddressFromPubKey(publicKey: Uint8Array | string): string {
  const pubBytes = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;
  if (pubBytes.length !== 32) {
    throw new CryptoError('Ed25519 public key must be exactly 32 bytes (64 hex characters)');
  }
  const hash = sha256(pubBytes);
  const truncatedHex = bytesToHex(hash.subarray(0, 20));
  return `sovra1${truncatedHex}`;
}

/**
 * Derives a 64-byte seed from a BIP-39 mnemonic phrase using PBKDF2-HMAC-SHA512 (2048 iterations).
 */
export function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Uint8Array {
  const normalizedMnemonic = mnemonic.trim().normalize('NFKD');
  const normalizedPassphrase = (passphrase || '').normalize('NFKD');
  const salt = new TextEncoder().encode(`mnemonic${normalizedPassphrase}`);
  return pbkdf2(sha512, new TextEncoder().encode(normalizedMnemonic), salt, { c: 2048, dkLen: 64 });
}

/**
 * Derives an Ed25519 private key seed using SLIP-0010 hardened derivation:
 * Path: m/44'/999'/<accountIndex>'/0'
 */
export function deriveSlip0010Ed25519(
  seed: Uint8Array,
  path: string = "m/44'/999'/0'/0'",
): { privateKey: Uint8Array; chainCode: Uint8Array } {
  const masterKey = new TextEncoder().encode('ed25519 seed');
  const master = hmac(sha512, masterKey, seed);
  let key = master.subarray(0, 32);
  let chainCode = master.subarray(32, 64);

  const cleanPath = path.replace(/^m\/?/i, '');
  if (!cleanPath) {
    return { privateKey: key, chainCode };
  }

  const segments = cleanPath.split('/').filter(Boolean);
  for (const seg of segments) {
    const rawNum = parseInt(seg.replace(/['hH]$/, ''), 10);
    if (isNaN(rawNum) || rawNum < 0) {
      throw new CryptoError(`Invalid path segment: ${seg}`);
    }
    // SLIP-0010 specifies Ed25519 supports only hardened child key derivation (index >= 0x80000000)
    const index = 0x80000000 + rawNum;

    const data = new Uint8Array(37);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;

    const I = hmac(sha512, chainCode, data);
    key = I.subarray(0, 32);
    chainCode = I.subarray(32, 64);
  }

  return { privateKey: key, chainCode };
}

/**
 * Validates a BIP-39 mnemonic phrase (word count, dictionary validation, and SHA-256 checksum).
 */
export function validateMnemonic(phrase: string): boolean {
  return validateBip39Mnemonic(phrase);
}

/**
 * Derives a full Ed25519 WalletKeyPair from a 12-to-24 word BIP-39 mnemonic phrase.
 * Deterministic path: m/44'/999'/<accountIndex>'/0'
 */
export function generateWalletFromMnemonic(
  mnemonic: string,
  accountIndex: number = 0,
  passphrase?: string,
): WalletKeyPair {
  if (!validateBip39Mnemonic(mnemonic)) {
    throw new CryptoError('Invalid BIP-39 mnemonic phrase or checksum failure');
  }
  if (typeof accountIndex !== 'number' || isNaN(accountIndex) || accountIndex < 0) {
    throw new CryptoError('Account index must be a non-negative integer');
  }

  const path = `m/44'/999'/${accountIndex}'/0'`;
  const seed = mnemonicToSeed(mnemonic, passphrase);
  const { privateKey } = deriveSlip0010Ed25519(seed, path);
  const publicKey = getEd25519PublicKey(privateKey);
  const address = computeAddressFromPubKey(publicKey);

  return {
    address,
    publicKey,
    privateKey,
    pubKeyHex: bytesToHex(publicKey),
    privKeyHex: bytesToHex(privateKey),
    mnemonic: mnemonic.trim(),
    accountIndex,
    derivationPath: path,
  };
}

/**
 * Exports the 12-to-24 word BIP-39 recovery mnemonic from an initialized WalletKeyPair.
 */
export function exportWalletMnemonic(wallet: WalletKeyPair): string {
  if (!wallet.mnemonic) {
    throw new CryptoError('Wallet was not initialized from a mnemonic or seed phrase was not retained');
  }
  return wallet.mnemonic;
}

/**
 * Generates a brand-new self-custody wallet with a cryptographically secure 12-word BIP-39 seed phrase.
 */
export function generateWalletWithMnemonic(
  accountIndex: number = 0,
  passphrase?: string,
): WalletKeyPair & { mnemonic: string } {
  const mnemonic = generateBip39Mnemonic(12);
  return generateWalletFromMnemonic(mnemonic, accountIndex, passphrase) as WalletKeyPair & { mnemonic: string };
}

/**
 * Generates a new random Ed25519 wallet keypair with derived address, hex encodings,
 * and 12-word BIP-39 self-custody recovery phrase.
 */
export function generateWallet(): WalletKeyPair {
  return generateWalletWithMnemonic(0);
}

/**
 * Reconstructs a wallet keypair from an existing 32-byte Ed25519 private key.
 */
export function createWalletFromPrivateKey(privateKey: Uint8Array | string): WalletKeyPair {
  const privBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
  if (privBytes.length !== 32) {
    throw new CryptoError('Ed25519 private key must be exactly 32 bytes (64 hex characters)');
  }
  const publicKey = getEd25519PublicKey(privBytes);
  const address = computeAddressFromPubKey(publicKey);
  return {
    address,
    publicKey,
    privateKey: privBytes,
    pubKeyHex: bytesToHex(publicKey),
    privKeyHex: bytesToHex(privBytes),
  };
}

/**
 * Canonical serialization of a transaction payload for cryptographic signing.
 * Exactly replicates Go's `SignedTransaction.GetSignBytes()` in `chain/node/types.go#L46`:
 *
 * Struct definition order:
 * 1. type (string)
 * 2. sender (string)
 * 3. recipient (string, omitempty)
 * 4. amount (string, omitempty)
 * 5. nonce (uint64)
 * 6. fee (string)
 * 7. wasm_bytecode (string, omitempty)
 * 8. code_id (uint64, omitempty)
 * 9. contract (string, omitempty)
 * 10. label (string, omitempty)
 * 11. admin (string, omitempty)
 * 12. msg (string, omitempty)
 * 13. funds (string, omitempty)
 * 14. validator (string, omitempty)
 */
export function getSignBytes(tx: ChainTxPayload): Uint8Array {
  if (!tx.type) throw new CryptoError('Transaction type is required');
  if (!tx.sender) throw new CryptoError('Transaction sender is required');
  if (typeof tx.nonce !== 'number' || isNaN(tx.nonce) || tx.nonce < 0) {
    throw new CryptoError('Transaction nonce must be a non-negative number');
  }
  if (!tx.fee) throw new CryptoError('Transaction fee is required');

  const canonical: Record<string, any> = {};
  canonical.type = tx.type;
  canonical.sender = tx.sender;

  if (tx.recipient !== undefined && tx.recipient !== '') {
    canonical.recipient = tx.recipient;
  }
  if (tx.amount !== undefined && tx.amount !== '') {
    canonical.amount = tx.amount;
  }

  canonical.nonce = Math.floor(tx.nonce);
  canonical.fee = tx.fee;

  if (tx.wasm_bytecode !== undefined && tx.wasm_bytecode !== '') {
    canonical.wasm_bytecode = tx.wasm_bytecode;
  }
  if (tx.code_id !== undefined && tx.code_id !== 0) {
    canonical.code_id = Math.floor(tx.code_id);
  }
  if (tx.contract !== undefined && tx.contract !== '') {
    canonical.contract = tx.contract;
  }
  if (tx.label !== undefined && tx.label !== '') {
    canonical.label = tx.label;
  }
  if (tx.admin !== undefined && tx.admin !== '') {
    canonical.admin = tx.admin;
  }
  if (tx.msg !== undefined && tx.msg !== '') {
    canonical.msg = tx.msg;
  }
  if (tx.funds !== undefined && tx.funds !== '') {
    canonical.funds = tx.funds;
  }
  if (tx.validator !== undefined && tx.validator !== '') {
    canonical.validator = tx.validator;
  }

  const jsonStr = JSON.stringify(canonical);
  return new TextEncoder().encode(jsonStr);
}

/**
 * Signs a transaction payload using the client's private key.
 * Derives public key and sender address automatically if not already set.
 * Returns a complete SignedTransaction ready for gateway relay or L1 broadcast.
 */
export function signTransaction(
  tx: Omit<ChainTxPayload, 'sender'> & { sender?: string },
  privateKey: Uint8Array | string,
): SignedTransaction {
  const privBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
  if (privBytes.length !== 32) {
    throw new CryptoError('Ed25519 private key must be exactly 32 bytes (64 hex characters)');
  }

  const publicKey = getEd25519PublicKey(privBytes);
  const derivedAddress = computeAddressFromPubKey(publicKey);

  if (tx.sender && tx.sender !== derivedAddress) {
    throw new CryptoError(
      `Transaction sender '${tx.sender}' does not match key address '${derivedAddress}'`,
    );
  }

  const fullTx: ChainTxPayload = {
    ...tx,
    sender: derivedAddress,
  };

  const signBytes = getSignBytes(fullTx);
  const sigBytes = signEd25519(privBytes, signBytes);

  return {
    ...fullTx,
    pub_key: bytesToHex(publicKey),
    sig: bytesToHex(sigBytes),
  };
}

/**
 * Validates a SignedTransaction against cryptographic invariants:
 * 1. Public key format (32 bytes / 64 hex characters).
 * 2. Signature format (64 bytes / 128 hex characters).
 * 3. Address binding: sender === computeAddressFromPubKey(pub_key).
 * 4. Ed25519 signature validity over canonical GetSignBytes(tx).
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, error: ... }` on violation.
 */
export function verifyTransactionSignature(tx: SignedTransaction): SignatureVerificationResult {
  if (!tx || typeof tx !== 'object') {
    return { valid: false, error: 'Transaction payload must be an object' };
  }

  if (!tx.pub_key || typeof tx.pub_key !== 'string' || tx.pub_key.length !== 64) {
    return { valid: false, error: 'Public key must be a 64-character hex string (32 bytes)' };
  }

  if (!tx.sig || typeof tx.sig !== 'string' || tx.sig.length !== 128) {
    return { valid: false, error: 'Signature must be a 128-character hex string (64 bytes)' };
  }

  if (!tx.sender || typeof tx.sender !== 'string') {
    return { valid: false, error: 'Transaction sender address is required' };
  }

  let pubBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubBytes = hexToBytes(tx.pub_key);
    sigBytes = hexToBytes(tx.sig);
  } catch (err: any) {
    return { valid: false, error: `Invalid hex in transaction: ${err?.message || err}` };
  }

  // 1. Validate sender address binding
  const derivedAddress = computeAddressFromPubKey(pubBytes);
  if (derivedAddress !== tx.sender) {
    return {
      valid: false,
      error: `Public key does not match sender address: derived ${derivedAddress} != sender ${tx.sender}`,
    };
  }

  // 2. Compute canonical sign bytes
  let signBytes: Uint8Array;
  try {
    signBytes = getSignBytes(tx);
  } catch (err: any) {
    return { valid: false, error: `Failed to construct canonical sign bytes: ${err?.message || err}` };
  }

  // 3. Verify Ed25519 signature
  const isSigValid = verifyEd25519(pubBytes, signBytes, sigBytes);
  if (!isSigValid) {
    return { valid: false, error: 'Cryptographic signature verification failed' };
  }

  return { valid: true };
}
