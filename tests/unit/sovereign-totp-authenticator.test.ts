import { describe, it, expect } from 'vitest';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Sovereign RFC 6238 TOTP Authenticator & Multi-Factor Security Suite', () => {
  it('generates cryptographic Base32 secrets and calculates valid 6-digit RFC 6238 TOTP codes', () => {
    const secret = sovraDb.generateTotpSecret(20);
    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);

    const code = sovraDb.computeTotpCode(secret);
    expect(code).toBeDefined();
    expect(code.length).toBe(6);
    expect(/^\d{6}$/.test(code)).toBe(true);

    // Timing drift verification (±1 step tolerance)
    expect(sovraDb.verifyTotpCode(secret, code)).toBe(true);

    const codeNext = sovraDb.computeTotpCode(secret, 1);
    expect(sovraDb.verifyTotpCode(secret, codeNext)).toBe(true); // +1 step within window

    const codePrev = sovraDb.computeTotpCode(secret, -1);
    expect(sovraDb.verifyTotpCode(secret, codePrev)).toBe(true); // -1 step within window

    const codeFar = sovraDb.computeTotpCode(secret, 5);
    expect(sovraDb.verifyTotpCode(secret, codeFar)).toBe(false); // +5 steps outside window

    expect(sovraDb.verifyTotpCode(secret, '000000')).toBe(false);
  });

  it('correctly constructs standard otpauth:// URI for QR code generation', () => {
    const handle = '@satya_creator';
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = sovraDb.getTotpUri(handle, secret);
    expect(uri).toContain('otpauth://totp/Sovra:satya_creator');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Sovra');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('enforces timing-safe 6-digit Security PIN verification and updates', () => {
    const hash = sovraDb.hashSecurityPin('849201');
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);

    expect(sovraDb.verifySecurityPin('849201', hash)).toBe(true);
    expect(sovraDb.verifySecurityPin('123456', hash)).toBe(false);
    expect(sovraDb.verifySecurityPin('', hash)).toBe(false);
  });

  it('generates 12-word cryptographic seed phrases for disaster recovery', () => {
    const phrase = sovraDb.generateRecoveryPhrase();
    expect(phrase).toBeDefined();
    const words = phrase.split(' ');
    expect(words.length).toBe(12);
    words.forEach(w => expect(w.length).toBeGreaterThanOrEqual(3));
  });

  it('proves end-to-end user lifecycle with PIN protection, TOTP activation, and login factor gates', () => {
    const ts = Date.now();
    const handle = `@totp_test_user_${ts}`;
    const did = `did:sovra:totp_test_${ts}`;
    const initialPin = '654321';

    // 1. Register user with custom 6-digit Security PIN
    const regRes = sovraDb.registerUser({
      did,
      handle,
      displayName: 'TOTP Test Persona',
      deviceType: 'Desktop',
      securityPin: initialPin,
    });
    expect(regRes.ok).toBe(true);
    const user = sovraDb.findUserByDid(did);
    expect(user).toBeDefined();
    expect(user?.totpEnabled).toBe(false);
    expect(user?.recoveryPhrase).toBeDefined();

    // 2. Login requires correct PIN when factor is provided
    const wrongPinLogin = sovraDb.loginUser(handle, 'Desktop', { pin: '000000' });
    expect(wrongPinLogin.ok).toBe(false);
    expect(wrongPinLogin.error).toContain('Incorrect Security PIN');

    const correctPinLogin = sovraDb.loginUser(handle, 'Desktop', { pin: initialPin });
    expect(correctPinLogin.ok).toBe(true);

    // 3. Enable TOTP using live rolling code
    const userSecret = user?.totpSecret!;
    expect(userSecret).toBeDefined();

    const badCodeRes = sovraDb.enableUserTotp(did, '000000');
    expect(badCodeRes.ok).toBe(false);

    const validCode = sovraDb.computeTotpCode(userSecret);
    const enableRes = sovraDb.enableUserTotp(did, validCode);
    expect(enableRes.ok).toBe(true);

    // 4. Once 2FA is active, login requires rolling TOTP code
    const loginWithoutTotp = sovraDb.loginUser(handle, 'Desktop', { pin: initialPin });
    expect(loginWithoutTotp.ok).toBe(false);
    expect(loginWithoutTotp.error).toContain('Google Authenticator 2FA code is required');

    const freshCode = sovraDb.computeTotpCode(userSecret);
    const loginWithTotp = sovraDb.loginUser(handle, 'Desktop', { pin: initialPin, totpCode: freshCode });
    expect(loginWithTotp.ok).toBe(true);

    // 5. Update Security PIN
    const badOldPinRes = sovraDb.updateSecurityPin(did, '999999', '112233');
    expect(badOldPinRes.ok).toBe(false);

    const goodPinUpdateRes = sovraDb.updateSecurityPin(did, initialPin, '112233');
    expect(goodPinUpdateRes.ok).toBe(true);

    // 6. Disable 2FA using new Security PIN
    const disableWrongPinRes = sovraDb.disableUserTotp(did, 'wrong_pin');
    expect(disableWrongPinRes.ok).toBe(false);

    const disableGoodPinRes = sovraDb.disableUserTotp(did, '112233');
    expect(disableGoodPinRes.ok).toBe(true);

    // 7. After disabling TOTP, login succeeds with the updated PIN alone
    const loginAfterDisable = sovraDb.loginUser(handle, 'Desktop', { pin: '112233' });
    expect(loginAfterDisable.ok).toBe(true);
  }, 30000);
});
