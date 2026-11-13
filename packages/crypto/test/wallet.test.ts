import { describe, it, expect } from 'vitest';
import {
  generateWallet,
  createWalletFromPrivateKey,
  computeAddressFromPubKey,
  getSignBytes,
  signTransaction,
  verifyTransactionSignature,
  sha256,
  bytesToHex,
  hexToBytes,
} from '../src/index.js';

describe('@sovra/crypto Wallet & Non-Custodial Transaction Signing', () => {
  it('generates wallet keypair with deterministic sovra1 address', () => {
    const wallet = generateWallet();
    expect(wallet.publicKey.length).toBe(32);
    expect(wallet.privateKey.length).toBe(32);
    expect(wallet.pubKeyHex.length).toBe(64);
    expect(wallet.privKeyHex.length).toBe(64);
    expect(wallet.address.startsWith('sovra1')).toBe(true);
    // sovra1 + 20 bytes hex (40 chars) = 46 chars
    expect(wallet.address.length).toBe(46);

    // Verify address derivation is deterministic
    const derivedAddr = computeAddressFromPubKey(wallet.publicKey);
    expect(derivedAddr).toBe(wallet.address);

    const derivedFromHex = computeAddressFromPubKey(wallet.pubKeyHex);
    expect(derivedFromHex).toBe(wallet.address);
  });

  it('re-creates identical wallet from private key', () => {
    const original = generateWallet();
    const restored = createWalletFromPrivateKey(original.privateKey);

    expect(restored.address).toBe(original.address);
    expect(restored.pubKeyHex).toBe(original.pubKeyHex);
    expect(restored.privKeyHex).toBe(original.privKeyHex);
  });

  it('replicates Go chain address derivation algorithm exactly', () => {
    // Known test vector
    const testPubKeyHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const pubBytes = hexToBytes(testPubKeyHex);
    const hash = sha256(pubBytes);
    const expectedAddress = 'sovra1' + bytesToHex(hash.subarray(0, 20));

    const computed = computeAddressFromPubKey(testPubKeyHex);
    expect(computed).toBe(expectedAddress);
  });

  it('constructs canonical sign bytes matching Go struct ordering and omitempty', () => {
    const tx = {
      type: 'send',
      sender: 'sovra1testuser00000000000000000000000000000',
      recipient: 'sovra1recipient000000000000000000000000000',
      amount: '500000',
      nonce: 0,
      fee: '100',
    };

    const signBytes = getSignBytes(tx);
    const jsonStr = new TextDecoder().decode(signBytes);
    const parsed = JSON.parse(jsonStr);

    // Verify exact keys and values
    expect(parsed).toEqual(tx);

    // Verify raw JSON string key order matches Go struct
    const keysInOrder = Object.keys(parsed);
    expect(keysInOrder).toEqual(['type', 'sender', 'recipient', 'amount', 'nonce', 'fee']);
  });

  it('omits empty optional fields from sign bytes according to omitempty rules', () => {
    const burnTx = {
      type: 'burn',
      sender: 'sovra1burner000000000000000000000000000000',
      amount: '1000000',
      nonce: 1,
      fee: '0',
      // Optional empty fields that must be omitted
      recipient: '',
      contract: '',
      wasm_bytecode: '',
      code_id: 0,
    };

    const signBytes = getSignBytes(burnTx);
    const jsonStr = new TextDecoder().decode(signBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.recipient).toBeUndefined();
    expect(parsed.contract).toBeUndefined();
    expect(parsed.wasm_bytecode).toBeUndefined();
    expect(parsed.code_id).toBeUndefined();
    expect(parsed.type).toBe('burn');
    expect(parsed.amount).toBe('1000000');
    expect(parsed.nonce).toBe(1);
    expect(parsed.fee).toBe('0');
  });

  it('signs transaction locally and verifies signature successfully', () => {
    const wallet = generateWallet();
    const rawTx = {
      type: 'send',
      recipient: 'sovra1recipient000000000000000000000000000',
      amount: '2500000',
      nonce: 3,
      fee: '100',
    };

    const signedTx = signTransaction(rawTx, wallet.privateKey);

    expect(signedTx.sender).toBe(wallet.address);
    expect(signedTx.pub_key).toBe(wallet.pubKeyHex);
    expect(signedTx.sig.length).toBe(128); // 64 bytes hex

    const verification = verifyTransactionSignature(signedTx);
    expect(verification.valid).toBe(true);
    expect(verification.error).toBeUndefined();
  });

  it('rejects tampered transaction amount or recipient', () => {
    const wallet = generateWallet();
    const signedTx = signTransaction({
      type: 'send',
      recipient: 'sovra1alice000000000000000000000000000000',
      amount: '1000000',
      nonce: 0,
      fee: '100',
    }, wallet.privateKey);

    // Tamper with amount
    const tamperedAmount = { ...signedTx, amount: '999999999' };
    const resAmount = verifyTransactionSignature(tamperedAmount);
    expect(resAmount.valid).toBe(false);
    expect(resAmount.error).toContain('verification failed');

    // Tamper with recipient
    const tamperedRecipient = { ...signedTx, recipient: 'sovra1attacker00000000000000000000000000000' };
    const resRecipient = verifyTransactionSignature(tamperedRecipient);
    expect(resRecipient.valid).toBe(false);
    expect(resRecipient.error).toContain('verification failed');
  });

  it('rejects transaction when sender does not match public key (spoofing attempt)', () => {
    const alice = generateWallet();
    const bob = generateWallet();

    // Alice signs transaction
    const signedTx = signTransaction({
      type: 'send',
      recipient: 'sovra1someone0000000000000000000000000000',
      amount: '500000',
      nonce: 0,
      fee: '100',
    }, alice.privateKey);

    // Attacker alters sender to Bob's address while keeping Alice's pub_key & signature
    const spoofedTx = { ...signedTx, sender: bob.address };
    const res = verifyTransactionSignature(spoofedTx);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Public key does not match sender address');
  });

  it('rejects malformed public key or signature hex', () => {
    const wallet = generateWallet();
    const signedTx = signTransaction({
      type: 'burn',
      amount: '1000',
      nonce: 0,
      fee: '0',
    }, wallet.privateKey);

    // Invalid length public key
    const invalidPub = { ...signedTx, pub_key: 'abcdef' };
    expect(verifyTransactionSignature(invalidPub).valid).toBe(false);

    // Invalid length signature
    const invalidSig = { ...signedTx, sig: '1234' };
    expect(verifyTransactionSignature(invalidSig).valid).toBe(false);
  });
});
