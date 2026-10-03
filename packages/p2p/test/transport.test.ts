import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, constantTimeEquals } from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  RevocationRegistry,
  createRevocationAssertion,
} from '@sovra/identity';
import { createPeerIdentityBinding } from '../src/identity.js';
import { SecureTransportHandshake } from '../src/transport.js';

describe('P2P Secure Transport & Noise Handshake Suite', () => {
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

    return {
      aliceMaster,
      aliceDevice,
      aliceBinding,
      bobMaster,
      bobDevice,
      bobBinding,
    };
  }

  it('executes mutual authenticated handshake establishing encrypted session with forward secrecy', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    // 1. Alice initiates
    const { message1, ephemeralKeyPair: aliceEphemeral } = SecureTransportHandshake.initiate();

    // 2. Bob responds
    const {
      message2,
      ephemeralKeyPair: bobEphemeral,
      initiatorEphemeralPub,
    } = SecureTransportHandshake.respond(message1, bobDevice, bobBinding);

    // 3. Alice verifies Bob and creates Message 3
    const { message3, channel: aliceChannel } =
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        message1,
        message2,
        aliceEphemeral.privateKey,
        aliceDevice,
        aliceBinding,
      );

    // 4. Bob finalizes
    const bobChannel = SecureTransportHandshake.finalizeResponder(
      message1,
      message2,
      message3,
      bobEphemeral.privateKey,
      initiatorEphemeralPub,
    );

    expect(aliceChannel.remotePeerId).toBe(bobBinding.peerId);
    expect(bobChannel.remotePeerId).toBe(aliceBinding.peerId);

    // 5. Encrypted data transmission Alice -> Bob
    const plainMsg1 = new TextEncoder().encode('Hello Bob from Alice via ChaCha20-Poly1305');
    const encryptedByAlice = aliceChannel.encrypt(plainMsg1);
    const decryptedByBob = bobChannel.decrypt(encryptedByAlice);
    expect(constantTimeEquals(plainMsg1, decryptedByBob)).toBe(true);

    // 6. Encrypted data transmission Bob -> Alice
    const plainMsg2 = new TextEncoder().encode('Hello Alice from Bob! Verified.');
    const encryptedByBob = bobChannel.encrypt(plainMsg2);
    const decryptedByAlice = aliceChannel.decrypt(encryptedByBob);
    expect(constantTimeEquals(plainMsg2, decryptedByAlice)).toBe(true);
  });

  it('rejects tampered handshake messages or transcript signatures', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const { message1, ephemeralKeyPair: aliceEphemeral } = SecureTransportHandshake.initiate();
    const { message2 } = SecureTransportHandshake.respond(message1, bobDevice, bobBinding);

    // Tamper with message2 signature
    const tamperedSig = message2.signatureHex.slice(0, -2) + 'ff';
    const tamperedMessage2 = { ...message2, signatureHex: tamperedSig };

    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        message1,
        tamperedMessage2,
        aliceEphemeral.privateKey,
        aliceDevice,
        aliceBinding,
      ),
    ).toThrowError(/signature is invalid/);
  });

  it('rejects replay of encrypted frame with lower sequence number', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const { message1, ephemeralKeyPair: aliceEphemeral } = SecureTransportHandshake.initiate();
    const {
      message2,
      ephemeralKeyPair: bobEphemeral,
      initiatorEphemeralPub,
    } = SecureTransportHandshake.respond(message1, bobDevice, bobBinding);
    const { message3, channel: aliceChannel } =
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        message1,
        message2,
        aliceEphemeral.privateKey,
        aliceDevice,
        aliceBinding,
      );
    const bobChannel = SecureTransportHandshake.finalizeResponder(
      message1,
      message2,
      message3,
      bobEphemeral.privateKey,
      initiatorEphemeralPub,
    );

    const frame0 = aliceChannel.encrypt(new TextEncoder().encode('Message 0'));
    const frame1 = aliceChannel.encrypt(new TextEncoder().encode('Message 1'));

    // Bob processes frame 0 then frame 1
    bobChannel.decrypt(frame0);
    bobChannel.decrypt(frame1);

    // Attacker replays frame 0
    expect(() => bobChannel.decrypt(frame0)).toThrowError(/Replay attack detected/);
  });

  it('rejects handshake if remote peer device key is revoked', () => {
    const { aliceDevice, aliceBinding, bobMaster, bobDevice, bobBinding } = setupTestPeers();

    const registry = new RevocationRegistry();
    // Revoke Bob's device key
    const revocation = createRevocationAssertion(
      bobMaster,
      bobDevice.publicKeyHex,
      'device',
      'device_lost',
      1,
    );
    registry.registerRevocation(revocation);

    const { message1, ephemeralKeyPair: aliceEphemeral } = SecureTransportHandshake.initiate();
    const { message2 } = SecureTransportHandshake.respond(message1, bobDevice, bobBinding);

    // Alice checks against registry with revoked Bob
    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        message1,
        message2,
        aliceEphemeral.privateKey,
        aliceDevice,
        aliceBinding,
        registry,
      ),
    ).toThrowError(/invalid or revoked/);
  });
});
