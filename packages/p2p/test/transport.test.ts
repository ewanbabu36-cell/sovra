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

  it('executes mutual authenticated Noise_XX handshake establishing encrypted session with forward secrecy', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    // 1. Alice initiates: -> e
    const aliceInit = SecureTransportHandshake.initiate();

    // 2. Bob responds: <- e, ee, s, es
    const bobResp = SecureTransportHandshake.respond(
      aliceInit.message1,
      bobDevice,
      bobBinding,
    );

    // 3. Alice processes Message 2 and creates Message 3: -> s, se
    const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
      bobResp.message2,
      aliceInit.symmetricState,
      aliceInit.ephemeralKeyPair.privateKey,
      aliceDevice,
      aliceBinding,
    );

    // 4. Bob finalizes session
    const bobFinal = SecureTransportHandshake.finalizeResponder(
      aliceFinal.message3,
      bobResp.symmetricState,
      bobResp.ephemeralKeyPair.privateKey,
    );

    expect(aliceFinal.channel.remotePeerId).toBe(bobBinding.peerId);
    expect(bobFinal.channel.remotePeerId).toBe(aliceBinding.peerId);

    // 5. Encrypted data transmission Alice -> Bob
    const plainMsg1 = new TextEncoder().encode('Hello Bob from Alice via ChaCha20-Poly1305');
    const encryptedByAlice = aliceFinal.channel.encrypt(plainMsg1);
    const decryptedByBob = bobFinal.channel.decrypt(encryptedByAlice);
    expect(constantTimeEquals(plainMsg1, decryptedByBob)).toBe(true);

    // 6. Encrypted data transmission Bob -> Alice
    const plainMsg2 = new TextEncoder().encode('Hello Alice from Bob! Verified Noise_XX.');
    const encryptedByBob = bobFinal.channel.encrypt(plainMsg2);
    const decryptedByAlice = aliceFinal.channel.decrypt(encryptedByBob);
    expect(constantTimeEquals(plainMsg2, decryptedByAlice)).toBe(true);
  });

  it('rejects tampered handshake messages or ciphertexts', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const aliceInit = SecureTransportHandshake.initiate();
    const bobResp = SecureTransportHandshake.respond(
      aliceInit.message1,
      bobDevice,
      bobBinding,
    );

    // Tamper with message2 ciphertext bytes
    const tamperedBytes = new Uint8Array(bobResp.message2.rawBytes);
    tamperedBytes[tamperedBytes.length - 1]! ^= 0x55;
    const tamperedMessage2 = { rawBytes: tamperedBytes };

    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        tamperedMessage2,
        aliceInit.symmetricState,
        aliceInit.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
      ),
    ).toThrow();
  });

  it('rejects replay of encrypted frame with lower sequence number', () => {
    const { aliceDevice, aliceBinding, bobDevice, bobBinding } = setupTestPeers();

    const aliceInit = SecureTransportHandshake.initiate();
    const bobResp = SecureTransportHandshake.respond(
      aliceInit.message1,
      bobDevice,
      bobBinding,
    );
    const aliceFinal = SecureTransportHandshake.processMessage2AndCreateMessage3(
      bobResp.message2,
      aliceInit.symmetricState,
      aliceInit.ephemeralKeyPair.privateKey,
      aliceDevice,
      aliceBinding,
    );
    const bobFinal = SecureTransportHandshake.finalizeResponder(
      aliceFinal.message3,
      bobResp.symmetricState,
      bobResp.ephemeralKeyPair.privateKey,
    );

    const frame0 = aliceFinal.channel.encrypt(new TextEncoder().encode('Message 0'));
    const frame1 = aliceFinal.channel.encrypt(new TextEncoder().encode('Message 1'));

    // Bob processes frame 0 then frame 1
    bobFinal.channel.decrypt(frame0);
    bobFinal.channel.decrypt(frame1);

    // Attacker replays frame 0
    expect(() => bobFinal.channel.decrypt(frame0)).toThrowError(/Replay attack detected/);
  });

  it('rejects handshake if remote peer device key is revoked', () => {
    const { aliceDevice, aliceBinding, bobMaster, bobDevice, bobBinding } = setupTestPeers();

    const registry = new RevocationRegistry();
    const revocation = createRevocationAssertion(
      bobMaster,
      bobDevice.publicKeyHex,
      'device',
      'device_lost',
      1,
    );
    registry.registerRevocation(revocation);

    const aliceInit = SecureTransportHandshake.initiate();
    const bobResp = SecureTransportHandshake.respond(
      aliceInit.message1,
      bobDevice,
      bobBinding,
    );

    expect(() =>
      SecureTransportHandshake.processMessage2AndCreateMessage3(
        bobResp.message2,
        aliceInit.symmetricState,
        aliceInit.ephemeralKeyPair.privateKey,
        aliceDevice,
        aliceBinding,
        undefined,
        registry,
      ),
    ).toThrowError(/invalid or revoked/);
  });
});
