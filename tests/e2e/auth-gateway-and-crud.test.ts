/**
 * @file tests/e2e/auth-gateway-and-crud.test.ts
 * SOVRA ENTERPRISE AUTH GATEWAY, PUBLIC LANDING & ROLE-BASED WORKSPACE CRUD TEST SUITE
 *
 * Verifies:
 * 1. Pre-flight auth guard: Zero-flash of private layouts, unauthenticated mode styling.
 * 2. Sovereign Public Landing Gateway: Hero proposition, 4 core pillars, header public auth group, login/register modals.
 * 3. Role-based workspace routing: Consumer -> Feed, Creator -> Studio, Admin -> Operations Console.
 * 4. Full CRUD suite:
 *    - Post Add/Edit/Delete with #editPostModal, (edited) badge, and /api/feed/edit & /api/feed/delete endpoints.
 *    - Profile metadata update (/api/user/update).
 *    - Active sessions manager and remote revocation (/api/user/sessions/revoke).
 * 5. Clean logout engine: #headerLogoutBtn -> #logoutConfirmModal -> POST /api/user/logout -> Public Landing Gateway.
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('👑 Sovra Enterprise Auth Gateway, Public Landing & Role-Based Workspace Engine', { timeout: 30000 }, () => {
  it('1. Pre-Flight Auth Guard & Zero-Flash Styling: hides private layout and serves Public Landing Gateway when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Head preflight script adds .sovra-unauthenticated before body rendering if tokens are missing
    expect(html).toContain("document.documentElement.classList.add('sovra-unauthenticated')");
    expect(html).toContain("localStorage.getItem('sovra_session_token')");
    expect(html).toContain("localStorage.getItem('sovra_user_profile')");

    // CSS rules enforce total privacy shielding
    expect(html).toContain('html.sovra-unauthenticated .app-layout');
    expect(html).toContain('html.sovra-unauthenticated .header-desktop-nav');
    expect(html).toContain('html.sovra-unauthenticated #currentUserPill');
    expect(html).toContain('html.sovra-unauthenticated #headerLogoutBtn');
    expect(html).toContain('html.sovra-unauthenticated #headerPublicAuthGroup');
    expect(html).toContain('html.sovra-unauthenticated #welcomeOnboardingModal');
  });

  it('2. Sovereign Public Landing Gateway: serves high-converting Hero, 4 Core Pillars, Header Public Auth Group, and Auth Forms', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // Header Public Auth Group
    expect(html).toContain('id="headerPublicAuthGroup"');
    expect(html).toContain('class="public-mesh-pill"');
    expect(html).toContain('Live Network');
    expect(html).toContain('id="headerPublicLoginBtn"');
    expect(html).toContain('id="headerPublicRegisterBtn"');
    expect(html).toContain("showAuthLandingModal('login')");
    expect(html).toContain("showAuthLandingModal('register')");

    // Hero Section
    expect(html).toContain('The Sovereign Social Network Owned By You.');
    expect(html).toContain('Zero surveillance algorithms. Zero corporate censorship.');

    // 4 Core Feature Pillars
    expect(html).toContain('Signal-Grade E2EE Encrypted Chats &amp; Calls');
    expect(html).toContain('4K Decentralized Video &amp; Creator Monetization');
    expect(html).toContain('Sovereign Multi-Asset Off-Chain Wallet');
    expect(html).toContain('Self-Sovereign Identity (Ed25519 DID)');

    // Interactive Authentication Modals
    expect(html).toContain('id="welcomeOnboardingModal"');
    expect(html).toContain('id="womTabLoginBtn"');
    expect(html).toContain('id="womTabRegisterBtn"');
    expect(html).toContain('id="womLoginHandleInput"');
    expect(html).toContain('id="womLoginPinInput"');
    expect(html).toContain('id="womLoginSubmitBtn"');
    expect(html).toContain('id="womNameInput"');
    expect(html).toContain('id="womHandleInput"');
    expect(html).toContain('id="womRegisterPinInput"');
    expect(html).toContain('id="womAvatarPreview"');
    expect(html).toContain('id="womRegisterSubmitBtn"');
  });

  it('3. Role-Based Respected Profile Workspace Routing: defines dynamic workspace switcher and role router', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // Client routing engine
    expect(html).toContain('function routeByRespectedProfileRole(role)');
    expect(html).toContain("switchTab('studio')");
    expect(html).toContain("switchTab('admin')");
    expect(html).toContain("switchTab('feed')");

    // Identity / persona switcher for instant in-app workspace switching
    expect(html).toContain('id="headerIdentitySwitcherPill"');
    expect(html).toContain('openIdentitySwitcherSheet(event)');
    expect(html).toContain('function switchToPersona(');
  });

  it('4. Full CRUD Suite: Post Options, Edit Post Modal, Delete Handler, and Edit/Delete APIs', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // Post Options Menu includes Edit Post and Delete Post buttons
    expect(html).toContain('id="postOptionEditBtn"');
    expect(html).toContain('id="postOptionDeleteBtn"');
    expect(html).toContain('triggerEditFromModal()');
    expect(html).toContain('triggerDeleteFromModal()');

    // Dedicated Edit Post Modal
    expect(html).toContain('id="editPostModal"');
    expect(html).toContain('id="editPostCaptionInput"');
    expect(html).toContain('id="saveEditPostBtn"');
    expect(html).toContain('id="cancelEditPostBtn"');

    // Client functions for editing and deleting posts with (edited) badge
    expect(html).toContain('function openEditPostModal(');
    expect(html).toContain('function closeEditPostModal(');
    expect(html).toContain('function submitEditPost(');
    expect(html).toContain('/api/feed/edit');
    expect(html).toContain('(edited)');
    expect(html).toContain('/api/feed/delete');

    // Profile & Sessions CRUD
    expect(html).toContain('/api/user/update');
    expect(html).toContain('/api/user/sessions');
    expect(html).toContain('/api/user/sessions/revoke');
  });

  it('5. Clean Session Termination & Logout Engine: Header Logout button, confirmation modal, and backend revocation', async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();

    // Header logout trigger
    expect(html).toContain('id="headerLogoutBtn"');
    expect(html).toContain('openLogoutModal(event)');

    // Logout confirmation modal and execution
    expect(html).toContain('id="logoutConfirmModal"');
    expect(html).toContain('id="confirmLogoutSubmitBtn"');
    expect(html).toContain('function executeUserLogout(');
    expect(html).toContain('/api/user/logout');
    expect(html).toContain('showAuthLandingGate()');
  });

  it('6. Backend API Handshake: /api/user/me responds correctly to unauthenticated requests without session leaks', async () => {
    const unauthRes = await fetch(`${BASE_URL}/api/user/me`);
    const data = await unauthRes.json();
    expect(data.ok).toBe(false);
  });

  it('7. Backend API Integrity: /api/feed/edit and /api/feed/delete enforce authentication', async () => {
    const editRes = await fetch(`${BASE_URL}/api/feed/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'test-fake-id', caption: 'Unauthorized edit' })
    });
    expect([401, 403]).toContain(editRes.status);

    const deleteRes = await fetch(`${BASE_URL}/api/feed/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'test-fake-id' })
    });
    expect([401, 403]).toContain(deleteRes.status);
  });
});
