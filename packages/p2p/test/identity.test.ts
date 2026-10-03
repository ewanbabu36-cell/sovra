import { describe, it, expect } from 'vitest';
import { generateEd25519KeyPair, hexToBytes, bytesToHex } from '@sovra/crypto';
import {
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  RevocationRegistry,
  createRevocationAssertion,
} from '@sovra/identity';
import {
  derivePeerId,
  extractPublicKeyFromPeerId,
  createPeerIdentity,
  createPeerIdentityBinding,
  verifyPeerIdentityBinding,
} from '../src/identity.js';

describe('P2P Peer Identity & DID Binding Suite', () => {
  it('derives a standard libp2p Ed25519 Peer ID starting with 12D3KooW', () => {
    const keyPair = generateEd25519KeyPair();
    const peerId = derivePeerId(keyPair.publicKey);

    expect(peerId).toBeTypeOf('string');
    expect(peerId.startsWith('12D3KooW')).toBe(true);

    const extracted = extractPublicKeyFromPeerId(peerId);
    expect(bytesToHex(extracted)).toBe(bytesToHex(keyPair.publicKey));
  });

  it('verifies deterministic derivation against standard W3C/libp2p vector', () => {
    // Official Ed25519 vector public key: d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
    const pubHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const peerId = derivePeerId(pubHex);

    expect(peerId.startsWith('12D3KooW')).toBe(true);
    const roundtrip = extractPublicKeyFromPeerId(peerId);
    expect(bytesToHex(roundtrip)).toBe(pubHex);
  });

  it('creates and verifies a valid PeerIdentityBinding linking Master DID, Device Key, and Peer ID', () => {
    const masterKey = SovraIdentityKey.generate();
    const devicePair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'dev-laptop-01',
      'MacBook Pro',
      masterKey.did,
      devicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400 * 30,
    );

    const delegation = createDeviceDelegation(
      masterKey,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400 * 30,
    );

    const binding = createPeerIdentityBinding(deviceKey, masterKey.did, delegation);

    expect(binding.peerId.startsWith('12D3KooW')).toBe(true);
    expect(binding.deviceId).toBe('dev-laptop-01');
    expect(binding.devicePublicKeyHex).toBe(deviceKey.publicKeyHex);
    expect(binding.masterDid).toBe(masterKey.did);

    const isValid = verifyPeerIdentityBinding(binding);
    expect(isValid).toBe(true);
  });

  it('rejects tampered Peer ID in binding', () => {
    const masterKey = SovraIdentityKey.generate();
    const devicePair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'dev-phone-01',
      'iPhone 16',
      masterKey.did,
      devicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delegation = createDeviceDelegation(
      masterKey,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400,
    );

    const binding = createPeerIdentityBinding(deviceKey, masterKey.did, delegation);

    // Tamper with peerId
    const otherPair = generateEd25519KeyPair();
    const fakePeerId = derivePeerId(otherPair.publicKey);
    const tamperedBinding = { ...binding, peerId: fakePeerId };

    expect(verifyPeerIdentityBinding(tamperedBinding)).toBe(false);
  });

  it('rejects tampered delegation or forged master DID in binding', () => {
    const masterKey = SovraIdentityKey.generate();
    const evilMasterKey = SovraIdentityKey.generate();
    const devicePair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'dev-phone-02',
      'Android Pixel',
      masterKey.did,
      devicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delegation = createDeviceDelegation(
      masterKey,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400,
    );

    const binding = createPeerIdentityBinding(deviceKey, masterKey.did, delegation);

    // Replace master DID with evil master DID
    const forgedBinding = { ...binding, masterDid: evilMasterKey.did };
    expect(verifyPeerIdentityBinding(forgedBinding)).toBe(false);
  });

  it('rejects binding when device key is marked revoked in RevocationRegistry', () => {
    const masterKey = SovraIdentityKey.generate();
    const devicePair = generateEd25519KeyPair();
    const deviceKey = new SovraDeviceKey(
      'dev-compromised',
      'Stolen Device',
      masterKey.did,
      devicePair.privateKey,
      Math.floor(Date.now() / 1000) + 86400,
    );
    const delegation = createDeviceDelegation(
      masterKey,
      deviceKey,
      Math.floor(Date.now() / 1000) + 86400,
    );

    const binding = createPeerIdentityBinding(deviceKey, masterKey.did, delegation);

    const registry = new RevocationRegistry();
    expect(verifyPeerIdentityBinding(binding, registry)).toBe(true);

    // Revoke compromised device key
    const revocation = createRevocationAssertion(
      masterKey,
      deviceKey.publicKeyHex,
      'device',
      'device_lost',
      1,
    );
    registry.registerRevocation(revocation);

    // Now binding verification must fail
    expect(verifyPeerIdentityBinding(binding, registry)).toBe(false);
  });
});
