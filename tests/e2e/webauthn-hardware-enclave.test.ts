import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sovraDb, toPublicUserDTO } from '../../scripts/database-engine.ts';
import {
  toBase64Url,
  generateRegistrationOptions,
  generateLoginOptions,
  verifyLoginResponse,
} from '../../scripts/webauthn-engine.ts';

describe('E2E Native WebAuthn Fingerprint / Face ID Hardware Enclave Suite (Phase 1)', () => {
  let devServerCode: string;

  beforeAll(() => {
    devServerCode = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf-8');
  });

  it('proves dev-server exposes all 5 W3C WebAuthn API endpoints', () => {
    expect(devServerCode).toContain("pathname === '/api/auth/webauthn/register-options'");
    expect(devServerCode).toContain("pathname === '/api/auth/webauthn/register-verify'");
    expect(devServerCode).toContain("pathname === '/api/auth/webauthn/login-options'");
    expect(devServerCode).toContain("pathname === '/api/auth/webauthn/login-verify'");
    expect(devServerCode).toContain("pathname === '/api/auth/webauthn/credentials'");
  });

  it('proves client UI exposes biometric login and hardware passkey linking controls', () => {
    expect(devServerCode).toContain('id="womBiometricLoginBtn"');
    expect(devServerCode).toContain('id="almLinkBiometricsBtn"');
    expect(devServerCode).toContain('id="almBiometricsBadge"');
    expect(devServerCode).toContain('id="womStep3LinkBiometricBtn"');
    expect(devServerCode).toContain('triggerWebAuthnBiometricLogin');
    expect(devServerCode).toContain('triggerWebAuthnBiometricRegister');
  });

  it('completes full lifecycle: user registration -> biometric enrollment -> 1-touch resident-key login -> credential revocation', () => {
    const ts = Date.now();
    const handle = `@enclave_peer_${ts}`;
    const did = `did:sovra:enclave_${ts}`;

    // 1. Register new Sovereign user
    const reg = sovraDb.registerUser({
      did,
      handle,
      displayName: 'Hardware Enclave Tester',
      deviceType: 'Mobile',
    });
    expect(reg.ok).toBe(true);
    expect(toPublicUserDTO(reg.user)?.hasWebAuthn).toBe(false);

    // 2. Generate registration options for user
    const fullUser = sovraDb.findUserByDid(did);
    expect(fullUser).toBeDefined();
    const regOptions = generateRegistrationOptions(fullUser!, 'reflector-grafting-clergyman.ngrok-free.dev');
    expect(regOptions.rp.id).toBe('reflector-grafting-clergyman.ngrok-free.dev');
    expect(regOptions.authenticatorSelection.authenticatorAttachment).toBe('platform');
    expect(regOptions.authenticatorSelection.userVerification).toBe('preferred');

    // 3. Generate hardware P-256 keypair & persist credential to database
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = `cred_mobile_touchid_${ts}`;

    const added = sovraDb.addWebauthnCredential(did, {
      id: credentialId,
      jwk,
      counter: 0,
      transports: ['internal'],
      deviceLabel: 'Android Biometric Sensor',
      createdAt: Date.now(),
    });
    expect(added).toBe(true);

    // 4. Verify Resident-Key Auto-Discovery (1-Touch Login without handle!)
    const discoveredUser = sovraDb.findUserByWebauthnCredentialId(credentialId);
    expect(discoveredUser).toBeDefined();
    expect(discoveredUser?.did).toBe(did);
    expect(discoveredUser?.handle).toBe(handle);

    // 5. Generate Login Challenge & Perform Cryptographic Hardware Signature Assertion
    const loginOpts = generateLoginOptions(discoveredUser, 'reflector-grafting-clergyman.ngrok-free.dev');
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: loginOpts.challenge,
        origin: 'https://reflector-grafting-clergyman.ngrok-free.dev',
      })
    );
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();

    const authDataBuf = Buffer.alloc(37);
    crypto.randomBytes(32).copy(authDataBuf, 0);
    authDataBuf[32] = 0x05; // UP + UV
    authDataBuf.writeUInt32BE(1, 33); // counter = 1

    const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);
    const signer = crypto.createSign('SHA256');
    signer.update(signedPayload);
    const signature = signer.sign(privateKey);

    const verResult = verifyLoginResponse(
      {
        id: credentialId,
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authDataBuf),
          signature: toBase64Url(signature),
        },
      },
      discoveredUser!.webauthnCredentials!
    );

    expect(verResult.ok).toBe(true);
    expect(verResult.credential?.counter).toBe(1);

    // 6. Complete session issuance and verify DTO reflects hasWebAuthn = true
    const sessionLogin = sovraDb.loginUser(handle, 'Mobile Biometric', '127.0.0.1', 'Android Chrome');
    expect(sessionLogin.ok).toBe(true);
    expect(toPublicUserDTO(sessionLogin.user)?.hasWebAuthn).toBe(true);

    // 7. Revoke biometric credential and verify cleanup
    const removed = sovraDb.removeWebauthnCredential(did, credentialId);
    expect(removed).toBe(true);
    expect(sovraDb.findUserByWebauthnCredentialId(credentialId)).toBeUndefined();
  });
});
