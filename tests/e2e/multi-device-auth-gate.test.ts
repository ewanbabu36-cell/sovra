import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sovraDb } from '../../scripts/database-engine.ts';

describe('Multi-Device Sovereign Landing & Authentication Gate Suite', () => {
  let devServerCode: string;

  beforeAll(() => {
    devServerCode = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf-8');
  });

  it('proves dev-server does NOT auto-seed host profile for unauthenticated visitors', () => {
    // Check that auto-seeding host on null profile is eliminated from client initialization
    expect(devServerCode).not.toContain("myProfile = {\n        did: '${masterKey.did}',\n        handle: isMobileDevice ? '@phone_user'");
    expect(devServerCode).toContain("currentUserHandle = myProfile ? myProfile.handle : '@guest'");
  });

  it('proves modern landing gate contains dual segmented tabs: Create Account and Sign In', () => {
    expect(devServerCode).toContain('id="womTabRegisterBtn"');
    expect(devServerCode).toContain('id="womTabLoginBtn"');
    expect(devServerCode).toContain('id="womRegisterForm"');
    expect(devServerCode).toContain('id="womLoginForm"');
    expect(devServerCode).toContain('switchWomAuthTab');
    expect(devServerCode).toContain('triggerUserLogin');
    expect(devServerCode).toContain('showAuthLandingGate');
  });

  it('proves gate locks unauthenticated visitors by preventing modal dismissal without session', () => {
    expect(devServerCode).toContain('id="womCloseBtn"');
    expect(devServerCode).toContain("if (!myProfile || !myProfile.sessionToken)");
    expect(devServerCode).toContain('showAccountToast(\'⚠️ Please create an account or sign in to enter Sovra.\')');
  });

  it('proves registration creates distinct cryptographic users with isolated DIDs and sessions', async () => {
    const timestamp = Date.now();
    const phoneHandle = `@mobile_peer_${timestamp}`;
    const laptopHandle = `@laptop_peer_${timestamp}`;

    // 1. Register User B on mobile phone
    const regResB = sovraDb.registerUser({
      did: `did:sovra:phone_${timestamp}`,
      handle: phoneHandle,
      displayName: 'Rahul Phone',
      deviceType: 'Mobile',
    });
    expect(regResB.ok).toBe(true);
    if (!regResB.ok) return;

    // 2. Register User A on laptop
    const regResA = sovraDb.registerUser({
      did: `did:sovra:laptop_${timestamp}`,
      handle: laptopHandle,
      displayName: 'Host Laptop',
      deviceType: 'Desktop',
    });
    expect(regResA.ok).toBe(true);
    if (!regResA.ok) return;

    // 3. Verify distinct cryptographic identities
    expect(regResB.user.did).not.toBe(regResA.user.did);
    expect(regResB.user.sessionToken).not.toBe(regResA.user.sessionToken);
    expect(regResB.user.handle).toBe(phoneHandle);
    expect(regResA.user.handle).toBe(laptopHandle);

    // 4. Verify bilateral peer discovery in mesh
    const peersForB = sovraDb.getAllPeers(regResB.user.did);
    const peerBFoundA = peersForB.some(p => p.did === regResA.user.did);
    expect(peerBFoundA).toBe(true);

    const peersForA = sovraDb.getAllPeers(regResA.user.did);
    const peerAFoundB = peersForA.some(p => p.did === regResB.user.did);
    expect(peerAFoundB).toBe(true);

    // 5. Verify independent login capability for both users
    const loginB = sovraDb.loginUser(phoneHandle, 'Phone PWA', '10.96.44.224', 'Mobile Safari');
    expect(loginB.ok).toBe(true);
    expect(loginB.user?.handle).toBe(phoneHandle);

    const loginA = sovraDb.loginUser(laptopHandle, 'Laptop Desktop', '127.0.0.1', 'Desktop Chrome');
    expect(loginA.ok).toBe(true);
    expect(loginA.user?.handle).toBe(laptopHandle);

    // 6. Verify logout isolation: logging out User B does not revoke User A
    sovraDb.logoutUser(loginB.sessionToken);
    expect(sovraDb.findUserBySessionToken(loginB.sessionToken)).toBeUndefined();
    expect(sovraDb.findUserBySessionToken(loginA.sessionToken)).toBeDefined();
  }, 30000);
});
