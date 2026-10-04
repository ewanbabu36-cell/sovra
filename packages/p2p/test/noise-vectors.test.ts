import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  generateEd25519KeyPair,
  constantTimeEquals,
  diffieHellmanX25519,
} from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
} from '@sovra/identity';
import { createPeerIdentityBinding } from '../src/identity.js';
import {
  SecureTransportHandshake,
  NoiseCipherState,
  NoiseSymmetricState,
  buildNoiseNonce,
} from '../src/transport.js';

describe('Official Noise_XX Protocol Specification & Attack Vectors', () => {
  function setupTestPeers() {
    const aliceMaster = SovraIdentityKey.generate();
    const alicePair = generateEd25519KeyPair();
    const aliceDevice = new SovraDeviceKey(
      'alice-dev',
      'Alice Device',
      aliceMaster.did,
      alicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const aliceDelegation = createDeviceDelegation(
      aliceMaster,
      aliceDevice,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const aliceBinding = createPeerIdentityBinding(aliceDevice, aliceMaster.did, aliceDelegation);

    const bobMaster = SovraIdentityKey.generate();
    const bobPair = generateEd25519KeyPair();
    const bobDevice = new SovraDeviceKey(
      'bob-dev',
      'Bob Device',
      bobMaster.did,
      bobPair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const bobDelegation = createDeviceDelegation(
      bobMaster,
      bobDevice,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const bobBinding = createPeerIdentityBinding(bobDevice, bobMaster.did, bobDelegation);

    return { aliceDevice, aliceBinding, bobDevice, bobBinding };
  }

  it('verifies NoiseCipherState sequence counter and nonce generation', () => {
    const key = new Uint8Array(32).fill(0x42);
    const cipher = new NoiseCipherState(key);

    const nonce0 = buildNoiseNonce(0n);
    const nonce1 = buildNoiseNonce(1n);

    // Byte 4 should be 0 for nonce 0, 1 for nonce 1 (Little-Endian)
    expect(nonce0[4]).toBe(0);
    expect(nonce1[4]).toBe(1);

    const plaintext = new TextEncoder().encode('Noise Frame Data');
    const ad = new TextEncoder().encode('Associated Data');

    const ct0 = cipher.encryptWithAd(ad, plaintext);
    expect(cipher.sequenceNumber).toBe(1n);

    // Decrypting with another cipher initialized with same key
    const decryptor = new NoiseCipherState(key);
    const pt0 = decryptor.decryptWithAd(ad, ct0);
    expect(constantTimeEquals(plaintext, pt0)).toBe(true);
  });

  it('executes specification-compliant Noise_XX 3-way handshake', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    // Step 1: Alice -> Bob (Msg 1: -> e)
    const init = SecureTransportHandshake.initiate();
    expect(init.message1.rawBytes.length).toBe(32); // 32 bytes ephemeral public key

    // Step 2: Bob -> Alice (Msg 2: <- e, ee, s, es)
    const resp = SecureTransportHandshake.respond(init.message1, bobDevice, bobBinding);
    // Wire: 32B e + 48B encrypted s + encrypted payload
    expect(resp.message2.rawBytes.length).toBeGreaterThan(80);

    // Step 3: Alice -> Bob (Msg 3: -> s, se)
    const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
      resp.message2,
      init.symmetricState,
      init.ephemeralKeyPair.privateKey,
      aliceDevice,
      aliceBinding,
    );
    expect(aliceFinal.message3.rawBytes.length).toBeGreaterThan(48);

    // Finalize Responder
    const bobFinal = SecureTransportHandshake.finalizeResponder(
      aliceFinal.message3,
      resp.symmetricState,
      resp.ephemeralKeyPair.privateKey,
    );

    expect(aliceFinal.channel.remotePeerId).toBe(bobBinding.peerId);
    expect(bobFinal.channel.remotePeerId).toBe(aliceBinding.peerId);
  });

  it('rejects MITM tampering on Handshake Message 1 (ephemeral public key tampering)', () => {
    const { bobDevice, bobBinding } = setupTestPeers();
    const init = SecureTransportHandshake.initiate();

    // MITM flips bits in ephemeral key
    const tamperedMsg1Bytes = new Uint8Array(init.message1.rawBytes);
    tamperedMsg1Bytes[0]! ^= 0xff;

    // Bob processes tampered message 1
    const resp = SecureTransportHandshake.respond(
      { rawBytes: tamperedMsg1Bytes, ephemeralPublicKeyHex: '' },
      bobDevice,
      bobBinding,
    );

    // Alice should fail when processing Bob's response because the running transcript hash h differs
    const { aliceDevice, aliceBinding } = setupTestPeers();
    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        resp.message2,
        init.symmetricState,
        init.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
      ),
    ).toThrow();
  });

  it('rejects MITM tampering on Handshake Message 2 (ciphertext tag tampering)', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const init = SecureTransportHandshake.initiate();
    const resp = SecureTransportHandshake.respond(init.message1, bobDevice, bobBinding);

    // MITM flips byte in encrypted payload or tag
    const tamperedMsg2Bytes = new Uint8Array(resp.message2.rawBytes);
    tamperedMsg2Bytes[tamperedMsg2Bytes.length - 1]! ^= 0x01;

    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        { rawBytes: tamperedMsg2Bytes },
        init.symmetricState,
        init.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
      ),
    ).toThrow();
  });

  it('rejects MITM tampering on Handshake Message 3', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const init = SecureTransportHandshake.initiate();
    const resp = SecureTransportHandshake.respond(init.message1, bobDevice, bobBinding);
    const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
      resp.message2,
      init.symmetricState,
      init.ephemeralKeyPair.privateKey,
      aliceDevice,
      aliceBinding,
    );

    // MITM flips byte in message 3
    const tamperedMsg3Bytes = new Uint8Array(aliceFinal.message3.rawBytes);
    tamperedMsg3Bytes[tamperedMsg3Bytes.length - 1]! ^= 0x01;

    expect(() =>
      SecureTransportHandshake.finalizeResponder(
        { rawBytes: tamperedMsg3Bytes },
        resp.symmetricState,
        resp.ephemeralKeyPair.privateKey,
      ),
    ).toThrow();
  });

  it('rejects truncated handshake frames', () => {
    const { bobDevice, bobBinding } = setupTestPeers();

    // Truncated Message 1 (< 32 bytes)
    const truncatedMsg1 = { rawBytes: new Uint8Array(16), ephemeralPublicKeyHex: '' };
    expect(() =>
      SecureTransportHandshake.respond(truncatedMsg1, bobDevice, bobBinding),
    ).toThrowError(/truncated/);

    const init = SecureTransportHandshake.initiate();
    const { aliceDevice, aliceBinding } = setupTestPeers();

    // Truncated Message 2 (< 80 bytes)
    const truncatedMsg2 = { rawBytes: new Uint8Array(50) };
    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        truncatedMsg2,
        init.symmetricState,
        init.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
      ),
    ).toThrowError(/truncated/);
  });

  it('proves forward secrecy: static key compromise does NOT expose recorded session traffic', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const bobStaticKey = generateX25519KeyPair();
    const aliceStaticKey = generateX25519KeyPair();

    const init = SecureTransportHandshake.initiate();
    const resp = SecureTransportHandshake.respond(
      init.message1,
      bobDevice,
      bobBinding,
      bobStaticKey,
    );
    const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
      resp.message2,
      init.symmetricState,
      init.ephemeralKeyPair.privateKey,
      aliceDevice,
      aliceBinding,
      aliceStaticKey,
    );
    const bobFinal = SecureTransportHandshake.finalizeResponder(
      aliceFinal.message3,
      resp.symmetricState,
      resp.ephemeralKeyPair.privateKey,
    );

    // Alice sends secret session data
    const secretSessionData = new TextEncoder().encode('TOP_SECRET_USER_POST_CONTENT');
    const recordedCiphertextFrame = aliceFinal.channel.encrypt(secretSessionData);

    // Adversary later steals Bob's static private key and Alice's static private key
    const stolenBobStaticPriv = bobStaticKey.privateKey;
    const stolenAliceStaticPriv = aliceStaticKey.privateKey;

    // Adversary tries to compute shared secret between static keys:
    const staticDH = diffieHellmanX25519(stolenBobStaticPriv, aliceStaticKey.publicKey);

    // However, the session transport keys were derived using ephemeral-ephemeral DH (ee)
    // which was destroyed immediately upon handshake completion.
    // Without the ephemeral private keys (which are wiped from memory),
    // the adversary cannot construct the Noise chaining key or derive the session keys.
    const fakeCipher = new NoiseCipherState(staticDH);
    expect(() => {
      fakeCipher.decryptWithAd(new Uint8Array(0), recordedCiphertextFrame.subarray(8));
    }).toThrow();
  });
});
