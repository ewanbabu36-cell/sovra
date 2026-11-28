import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  decodeBech32m,
  encodeBech32m,
  getEd25519PublicKey,
  hexToBytes,
} from '@sovra/crypto';
import {
  SovraIdentityModule,
  authorizeSovraDevice,
  bindPeerToSovraIdentity,
  createSovraIdentityObject,
  decodeSovraEncryptionKeyId,
  decodeSovraIdentityId,
  encodeSovraEncryptionKeyId,
  encodeSovraIdentityId,
  isValidSovraEncryptionKeyId,
  isValidSovraIdentityId,
  revokeSovraDevice,
  rotateSovraEncryptionKey,
  rotateSovraIdentityEpoch,
  verifySovraDeviceAuthorization,
  verifySovraDeviceRevocation,
  verifySovraEncryptionKeyRotation,
  verifySovraIdentityObject,
  verifySovraKeyEpochRotation,
  verifySovraPeerIdentityBinding,
} from '../src/index.js';

describe('SOVRA-ID v1.0 Protocol & RFC Test Vectors', () => {
  const VECTOR_PRIV = '0101010101010101010101010101010101010101010101010101010101010101';
  const VECTOR_PUB = '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c';
  const VECTOR_ENC_PUB = '2222222222222222222222222222222222222222222222222222222222222222';
  const EXPECTED_SOVRA_ID = 'sovra1qycxelj9jsrn35nxd08m46d5dlcp3tzjvgsmfhn99nfm2jq9s3tfch4gull';
  const EXPECTED_SIGNATURE =
    '36e11e6a11a6a4ea42608512f652312205ce46377cd282ce8519a1a308375606cab870f749febdc8dd08d6bc76f99ff84c5769918a52c49ff66726a1728b6403';

  it('matches frozen RFC SOVRA-ID-v1 Bech32m derivation & IdentityObject signature vector byte-for-byte', () => {
    const priv = hexToBytes(VECTOR_PRIV);
    const pub = getEd25519PublicKey(priv);
    expect(bytesToHex(pub)).toBe(VECTOR_PUB);

    const sovraId = encodeSovraIdentityId(pub);
    expect(sovraId).toBe(EXPECTED_SOVRA_ID);
    expect(isValidSovraIdentityId(sovraId)).toBe(true);

    const decoded = decodeSovraIdentityId(sovraId);
    expect(decoded.version).toBe(1);
    expect(decoded.digestHex).toHaveLength(64);

    const idObj = createSovraIdentityObject({
      signingPrivateKey: priv,
      encryptionPublicKey: hexToBytes(VECTOR_ENC_PUB),
      createdAt: 1700000000,
      keyEpoch: 1,
      capabilities: ['social', 'messaging', 'commerce'],
    });
    expect(idObj.identity_id).toBe(EXPECTED_SOVRA_ID);
    expect(idObj.signature).toBe(EXPECTED_SIGNATURE);
    expect(verifySovraIdentityObject(idObj)).toBe(true);
  });

  it('enforces BIP-350 Bech32m checksums, mixed-case rejection, and tampered ID rejection', () => {
    const raw = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const encoded = encodeBech32m('sovra', raw);
    expect(decodeBech32m(encoded, 'sovra').data).toEqual(raw);

    // Tamper 1 character
    const chars = EXPECTED_SOVRA_ID.split('');
    chars[10] = chars[10] === 'q' ? 'p' : 'q';
    expect(isValidSovraIdentityId(chars.join(''))).toBe(false);
    // Mixed case rejected
    expect(isValidSovraIdentityId(EXPECTED_SOVRA_ID.slice(0, 12).toUpperCase() + EXPECTED_SOVRA_ID.slice(12))).toBe(false);
  });

  it('executes full SovraIdentityModule lifecycle: separate keys, multi-device revocation, key epoch rotation & encrypted backup', () => {
    const mod = new SovraIdentityModule();
    const idObj = mod.create();
    expect(isValidSovraIdentityId(idObj.identity_id)).toBe(true);
    expect(idObj.signing_public_key).not.toBe(idObj.encryption_public_key);

    // Safe serialization never leaks private keys
    const jsonText = JSON.stringify(mod.toSafeJSON());
    expect(jsonText).not.toContain('private');

    // Authorize device and sign
    const dev = mod.authorizeDevice({ deviceId: 'phone-1', deviceName: 'Android Pixel' });
    expect(mod.isDeviceAuthorized('phone-1')).toBe(true);
    const payload = new TextEncoder().encode('hello device auth');
    const devSig = mod.signBytes(payload, 'phone-1');
    expect(
      mod.verifySignature({
        payload,
        signatureHex: devSig,
        signingPublicKeyHex: dev.record.device_public_key,
        deviceId: 'phone-1',
      }),
    ).toBe(true);

    // Revoke compromised device without abandoning root identity
    mod.revokeDevice('phone-1', 'compromised');
    expect(mod.isDeviceAuthorized('phone-1')).toBe(false);
    expect(
      mod.verifySignature({
        payload,
        signatureHex: devSig,
        signingPublicKeyHex: dev.record.device_public_key,
        deviceId: 'phone-1',
      }),
    ).toBe(false);
    expect(() => mod.authorizeDevice({ deviceId: 'phone-1', deviceName: 'Reused Evil' })).toThrow();

    // Encrypted backup & restore under scrypt + ChaCha20-Poly1305
    const backup = mod.exportBackup('correct horse battery staple', { N: 1024 });
    const restoredMod = new SovraIdentityModule();
    expect(() => restoredMod.restoreBackup(backup, 'wrong passphrase')).toThrow();
    const restoredObj = restoredMod.restoreBackup(backup, 'correct horse battery staple');
    expect(restoredObj.identity_id).toBe(idObj.identity_id);

    // Key epoch rotation advances key_epoch 1 -> 2 with dual signature proof
    const rot = mod.rotateKey();
    expect(rot.previous_epoch).toBe(1);
    expect(rot.new_epoch).toBe(2);
    expect(verifySovraKeyEpochRotation(rot)).toBe(true);
  });

  it('matches all 8 frozen IA-01 Sec 3 deterministic vectors (IDs, DevAuth, DevRevoke, Rotations, PeerBinding)', () => {
    const priv1 = hexToBytes(VECTOR_PRIV);
    const encPub1 = hexToBytes(VECTOR_ENC_PUB);
    const encPub2 = hexToBytes('3333333333333333333333333333333333333333333333333333333333333333');
    const devPub = getEd25519PublicKey(hexToBytes('0404040404040404040404040404040404040404040404040404040404040404'));
    const priv2 = hexToBytes('0505050505050505050505050505050505050505050505050505050505050505');
    const peerPriv = hexToBytes('0606060606060606060606060606060606060606060606060606060606060606');
    const peerPub = getEd25519PublicKey(peerPriv);

    const idObj = createSovraIdentityObject({
      signingPrivateKey: priv1,
      encryptionPublicKey: encPub1,
      createdAt: 1700000000,
      keyEpoch: 1,
      capabilities: ['social', 'messaging', 'commerce'],
    });
    const encKeyId1 = encodeSovraEncryptionKeyId(encPub1);
    expect(encKeyId1).toBe('sovraenc1qynwej8k93xrr305p0p7dap4jvpucnefzw8fsc3u78yz6a2ftxk8khm44lw');
    expect(isValidSovraEncryptionKeyId(encKeyId1)).toBe(true);
    expect(decodeSovraEncryptionKeyId(encKeyId1).version).toBe(1);

    // Vector 4: Device Authorization
    const devAuth = authorizeSovraDevice({
      identityObject: idObj,
      signingPrivateKey: priv1,
      deviceId: 'dev_vec_1',
      deviceName: 'Vector Device',
      devicePublicKeyHex: bytesToHex(devPub),
      capabilities: ['social'],
      authorizedAt: 1700000001,
      expiresAt: 1731536001,
    });
    expect(devAuth.authorization_signature).toBe(
      'c4c23ec9e319116cf54c7d78a30ea72fc8e097751d52ca393a0bd942b6bc139c66de0c99aca6454c5e38f93c85a1180908308e35893f0804a332d5730d0bad0c',
    );
    expect(verifySovraDeviceAuthorization(devAuth, VECTOR_PUB, 1700000010)).toBe(true);

    // Vector 5: Device Revocation
    const devRev = revokeSovraDevice({
      identityObject: idObj,
      signingPrivateKey: priv1,
      deviceId: 'dev_vec_1',
      devicePublicKeyHex: bytesToHex(devPub),
      reason: 'compromised',
      revokedAt: 1700000050,
    });
    expect(devRev.signature).toBe(
      'fd45dc007c65a5e4f623dd54c79f1b34b6b10e4786a0630dff6b966863b56b4e0edfce2ba90494fa7fe4e0b42c35ffbcc12039d13bd90328f544b2caa86b4503',
    );
    expect(verifySovraDeviceRevocation(devRev, VECTOR_PUB)).toBe(true);

    // Vector 6: Epoch Rotation & Independent Encryption Key Rotation
    const encPriv2 = hexToBytes('0707070707070707070707070707070707070707070707070707070707070707');
    const epochRot = rotateSovraIdentityEpoch({
      previousIdentity: idObj,
      previousSigningPrivateKey: priv1,
      newSigningPrivateKey: priv2,
      newEncryptionPrivateKey: encPriv2,
      rotatedAt: 1700000100,
    });
    const epochRotRepeat = rotateSovraIdentityEpoch({
      previousIdentity: idObj,
      previousSigningPrivateKey: priv1,
      newSigningPrivateKey: priv2,
      newEncryptionPrivateKey: encPriv2,
      rotatedAt: 1700000100,
    });
    expect(epochRot.rotationRecord).toEqual(epochRotRepeat.rotationRecord);
    expect(epochRot.newIdentityObject.encryption_public_key).toBe(
      '13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d',
    );
    expect(epochRot.newIdentityObject.identity_id).toBe(
      'sovra1qytkmau584rk45gducsmzzxfvwn8tstcgxa6ja28za7j3865h3ezcja8k5f',
    );
    expect(epochRot.rotationRecord.previous_key_signature).toBe(
      '17ddf1620149c317c372fb55f86d9eda1f6f50bd6e2b5850b56bf595a69fc1f3ba2ff400cda3f808913c7be81914421ed49fa0f9ca55d06d77c35d9677b9e500',
    );
    expect(epochRot.rotationRecord.new_key_signature).toBe(
      '9242fa0ec14a55f49dbc70c7656616e30c70127106df47a4519ae7dfdc93aa5283414b0a47fc6ce348256ba23ed333553bc7733ddc6bf42b3757e00405f09d0c',
    );
    expect(verifySovraKeyEpochRotation(epochRot.rotationRecord)).toBe(true);
    expect(() =>
      rotateSovraIdentityEpoch({
        previousIdentity: idObj,
        previousSigningPrivateKey: priv1,
        newSigningPrivateKey: priv2,
        newEncryptionPrivateKey: new Uint8Array(16),
        rotatedAt: 1700000100,
      }),
    ).toThrow();
    const encRot = rotateSovraEncryptionKey({
      identityObject: idObj,
      signingPrivateKey: priv1,
      newEncryptionPublicKey: encPub2,
      encEpoch: 2,
      rotatedAt: 1700000120,
    });
    expect(encRot.new_encryption_key_id).toBe(
      'sovraenc1qy8s5hyw3fv8j3d0q5yw5hx8vjp386hhyhmajdes035mpwxngyezzlmlwku',
    );
    expect(encRot.signature).toBe(
      '0c5ad0ce70b7ed17e85f1255dae896211b36d2f8cab243b67638916eb3e417daa59af754985624188055e8aeecd65d2947dba14ffcfbc64e29ad802f4e56e802',
    );
    expect(verifySovraEncryptionKeyRotation(encRot, hexToBytes(VECTOR_PUB))).toBe(true);

    // Vector 8: Dual-Signed Peer Identity Binding connecting all 4 Identifiers
    const peerBind = bindPeerToSovraIdentity({
      identityObject: idObj,
      identitySigningPrivateKey: priv1,
      deviceId: 'dev_vec_1',
      peerId: '12D3KooWVectorPeerExample000000000000000000000000001',
      peerPrivateKey: peerPriv,
      peerPublicKey: peerPub,
      issuedAt: 1700000010,
      expiresAt: 1702592010,
    });
    expect(peerBind.identity_signature).toBe(
      '4d258c8cb3f01471aacb0a1df9fa106452aadc1190e3efa72e474f2633840d4dee6ef3406759d2d960e899af45b42c55d3def3dd340187d7c1e29836b58e7e0a',
    );
    expect(peerBind.peer_signature).toBe(
      '7963529ea25c4dda59e69a5ebdb28fc5588a67e1aef8254b10c8b460792507f28ede868619cec292b414fec21ddd57f48d92add3758ef4c1b610361daf43290a',
    );
    expect(verifySovraPeerIdentityBinding(peerBind, hexToBytes(VECTOR_PUB), 1700000100)).toBe(true);
    expect(verifySovraPeerIdentityBinding(peerBind, hexToBytes(VECTOR_PUB), 1702592099)).toBe(false); // Expired
  });
});
