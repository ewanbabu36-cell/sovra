import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  toBase64Url,
  fromBase64Url,
  decodeCbor,
  coseKeyToJwk,
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateLoginOptions,
  verifyLoginResponse,
} from '../../scripts/webauthn-engine.ts';
import type { UserRecord, WebAuthnCredentialRecord } from '../../scripts/database-engine.ts';

describe('Sovra Native WebAuthn & Hardware Enclave Biometrics Suite', () => {
  const dummyUser: UserRecord = {
    did: 'did:sovra:user_phone_biometrics_test',
    handle: '@biometric_user',
    displayName: 'Biometric Test User',
    avatar: 'B',
    avatarBg: '#6366f1',
    bio: 'Testing biometric passkey integration',
    deviceType: 'Mobile',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('generates standard W3C WebAuthn registration options with platform authenticator', () => {
    const options = generateRegistrationOptions(dummyUser, 'localhost:3001');
    expect(options.challenge).toBeDefined();
    expect(options.challenge.length).toBeGreaterThanOrEqual(32);
    expect(options.user.name).toBe('@biometric_user');
    expect(options.user.displayName).toBe('Biometric Test User');
    expect(options.authenticatorSelection.authenticatorAttachment).toBe('platform');
    expect(options.pubKeyCredParams).toContainEqual({ alg: -7, type: 'public-key' });
  });

  it('correctly decodes CBOR and extracts JWK from simulated hardware attestation', () => {
    // 1. Generate real EC P-256 key pair to simulate phone hardware enclave
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwkOriginal = publicKey.export({ format: 'jwk' });
    const xBuf = fromBase64Url(jwkOriginal.x!);
    const yBuf = fromBase64Url(jwkOriginal.y!);

    // 2. Build COSE EC2 Map
    const coseMap = new Map<number, any>();
    coseMap.set(1, 2); // kty = EC2
    coseMap.set(3, -7); // alg = ES256
    coseMap.set(-1, 1); // crv = P-256
    coseMap.set(-2, xBuf);
    coseMap.set(-3, yBuf);

    const convertedJwk = coseKeyToJwk(coseMap);
    expect(convertedJwk.kty).toBe('EC');
    expect(convertedJwk.crv).toBe('P-256');
    expect(convertedJwk.x).toBe(jwkOriginal.x);
    expect(convertedJwk.y).toBe(jwkOriginal.y);

    // Verify key imports into Node.js crypto engine
    const imported = crypto.createPublicKey({ key: convertedJwk as any, format: 'jwk' });
    expect(imported).toBeDefined();
  });

  it('end-to-end verifies biometric assertion signature during mobile login', () => {
    // 1. Generate real biometric credential
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = 'cred_biometric_' + Date.now();

    const storedCred: WebAuthnCredentialRecord = {
      id: credentialId,
      jwk,
      counter: 0,
      transports: ['internal'],
      createdAt: Date.now(),
    };

    // 2. Generate login challenge options
    const dummyUserWithCred: UserRecord = {
      ...dummyUser,
      webauthnCredentials: [storedCred],
    };
    const loginOptions = generateLoginOptions(dummyUserWithCred, 'localhost');
    expect(loginOptions.challenge).toBeDefined();
    expect(loginOptions.allowCredentials[0]!.id).toBe(credentialId);

    // 3. Simulate phone hardware enclave signing assertion
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: loginOptions.challenge,
        origin: 'http://localhost:3001',
      })
    );
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();

    // 37 bytes authData (32 bytes rpIdHash + 1 byte flags with UP bit 0x01 + 4 bytes counter)
    const authDataBuf = Buffer.alloc(37);
    crypto.randomBytes(32).copy(authDataBuf, 0); // rpIdHash
    authDataBuf[32] = 0x05; // flags: UP (0x01) + UV (0x04) = User Present & Biometrically Verified!
    authDataBuf.writeUInt32BE(1, 33); // signCount = 1

    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sign = crypto.createSign('SHA256');
    sign.update(signedData);
    const signature = sign.sign(privateKey);

    // 4. Server verifies assertion payload
    const verification = verifyLoginResponse(
      {
        id: credentialId,
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authDataBuf),
          signature: toBase64Url(signature),
        },
      },
      [storedCred]
    );

    expect(verification.ok).toBe(true);
    expect(verification.credential?.id).toBe(credentialId);
    expect(verification.credential?.counter).toBe(1);
  });

  it('rejects tampered or forged biometric signatures with strict error', () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = 'cred_tampered_test';

    const storedCred: WebAuthnCredentialRecord = {
      id: credentialId,
      jwk,
      counter: 0,
      createdAt: Date.now(),
    };

    const loginOptions = generateLoginOptions(undefined, 'localhost');

    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: loginOptions.challenge,
        origin: 'http://localhost:3001',
      })
    );
    const authDataBuf = Buffer.alloc(37);
    authDataBuf[32] = 0x01; // UP

    // Forged signature
    const fakeSignature = crypto.randomBytes(64);

    const result = verifyLoginResponse(
      {
        id: credentialId,
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authDataBuf),
          signature: toBase64Url(fakeSignature),
        },
      },
      [storedCred]
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('verification failed');
  });
});
