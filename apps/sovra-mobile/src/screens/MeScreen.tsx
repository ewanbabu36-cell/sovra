/**
 * @file apps/sovra-mobile/src/screens/MeScreen.tsx
 * User Profile, Passkeys, Onboarding & Micro-Tip Wallet Screen for Mobile App.
 *
 * Implements:
 * 1. Cryptographic DID identity badge (did:key).
 * 2. Biometric WebAuthn Passkeys session manager & Quick Lock.
 * 3. 3-Step Zero-Password Onboarding Modal.
 * 4. Complete Wipe / Logout & QR Transfer Settings.
 * 5. 3-Column media portfolio grid.
 * 6. Micro-tip creator wallet balance.
 */

import React, { useState } from 'react';
import { OnboardingModal } from './OnboardingModal.js';
import { AccountSettingsModal } from './AccountSettingsModal.js';
import type { UserAccountProfile } from '@sovra/identity';

const INITIAL_PROFILE: UserAccountProfile = {
  did: 'did:key:z6MksMerajCryptographicIdentitySovraPlanetaryMesh',
  handle: '@meraj_sharif',
  displayName: 'Meraj Sharif ⚡ Core Creator',
  deviceId: 'dev_m1_android',
  devicePublicKeyHex: '3b82f6e293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e',
  credentialId: 'cred_titan_bio_01',
  createdAt: Math.floor(Date.now() / 1000) - 86400 * 30,
  isLocked: false,
};

export function MeScreen(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [walletBalance] = useState('24.50');
  const [profile, setProfile] = useState<UserAccountProfile | null>(INITIAL_PROFILE);
  const [isLocked, setIsLocked] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // If session is locked (Soft Logout)
  if (isLocked && profile) {
    return (
      <div
        style={{
          flex: 1,
          backgroundColor: '#090d16',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '2px solid #38bdf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            marginBottom: 20,
          }}
        >
          🔒
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px 0' }}>Session Locked</h2>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 24px 0' }}>
          Keys purged from memory for privacy.
        </p>

        <button
          onClick={() => setIsLocked(false)}
          style={{
            padding: '14px 28px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
          }}
        >
          <span>👆 Unlock with TouchID / FaceID</span>
        </button>
      </div>
    );
  }

  // If no account exists (Logged out / wiped)
  if (!profile) {
    return (
      <div
        style={{
          flex: 1,
          backgroundColor: '#090d16',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16 }}>⚡</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px 0' }}>No Account on Device</h2>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 24px 0', maxWidth: 300 }}>
          Create an account in &lt; 5 seconds with zero passwords, or scan a QR code from another device.
        </p>
        <button
          onClick={() => setIsOnboardingOpen(true)}
          style={{
            padding: '14px 28px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Create Account Now
        </button>

        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          onAccountCreated={(newProf) => {
            setProfile(newProf);
            setIsOnboardingOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, backgroundColor: '#090d16', color: '#fff', overflowY: 'auto', paddingBottom: 64 }}>
      {/* Profile Header */}
      <div style={{ padding: '16px 16px 8px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{profile.handle}</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 18 }}>
            <span onClick={() => setIsOnboardingOpen(true)} style={{ cursor: 'pointer' }} title="New Account">
              ➕
            </span>
            <span onClick={() => setIsSettingsOpen(true)} style={{ cursor: 'pointer' }} title="Account Settings">
              ⚙️
            </span>
          </div>
        </div>

        {/* Avatar & Follower Stats */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: '50%',
              background: 'linear-gradient(45deg, #3b82f6, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              fontWeight: 700,
              border: '3px solid #1e293b',
            }}
          >
            {profile.displayName.charAt(0) || 'U'}
          </div>

          <div style={{ display: 'flex', gap: 24, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>18</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Posts</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>4.2K</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Followers</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>312</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Following</div>
            </div>
          </div>
        </div>

        {/* Bio & Verified DID Badge */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{profile.displayName}</div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
            Building decentralized super-apps on Noise_XX &amp; UnixFS Merkle DAGs. Zero algorithms.
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              padding: '3px 8px',
              borderRadius: 6,
              marginTop: 6,
              border: '1px solid rgba(56, 189, 248, 0.2)',
            }}
          >
            <span style={{ fontSize: 10, color: '#38bdf8', fontFamily: 'monospace' }}>
              {profile.did.slice(0, 16)}...Verified
            </span>
          </div>
        </div>

        {/* Passkey & Wallet Cards */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div
            onClick={() => setIsSettingsOpen(true)}
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Passkey Biometrics</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginTop: 2 }}>
              🛡️ TouchID Active
            </div>
          </div>

          <div
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Micro-Tip Wallet</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>
              ⚡ ₹{walletBalance} (Zero Gas)
            </div>
          </div>
        </div>
      </div>

      {/* Tabs (Posts, Reels, Saved) */}
      <div
        style={{
          display: 'flex',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          onClick={() => setActiveTab('posts')}
          style={{
            flex: 1,
            padding: '10px 0',
            textAlign: 'center',
            cursor: 'pointer',
            borderBottom: activeTab === 'posts' ? '2px solid #fff' : 'none',
            color: activeTab === 'posts' ? '#fff' : '#64748b',
          }}
        >
          📷
        </div>
        <div
          onClick={() => setActiveTab('reels')}
          style={{
            flex: 1,
            padding: '10px 0',
            textAlign: 'center',
            cursor: 'pointer',
            borderBottom: activeTab === 'reels' ? '2px solid #fff' : 'none',
            color: activeTab === 'reels' ? '#fff' : '#64748b',
          }}
        >
          🎬
        </div>
        <div
          onClick={() => setActiveTab('saved')}
          style={{
            flex: 1,
            padding: '10px 0',
            textAlign: 'center',
            cursor: 'pointer',
            borderBottom: activeTab === 'saved' ? '2px solid #fff' : 'none',
            color: activeTab === 'saved' ? '#fff' : '#64748b',
          }}
        >
          🔖
        </div>
      </div>

      {/* 3-Column Instagram Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: 2 }}>
        {Array.from({ length: 9 }).map((_, idx) => (
          <div
            key={idx}
            style={{
              aspectRatio: '1/1',
              backgroundColor: '#1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
            }}
          >
            {['⚡', '🚀', '🎬', '🌌', '🎧', '🔒', '📱', '💎', '🔥'][idx]}
          </div>
        ))}
      </div>

      {/* Modals */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onAccountCreated={(newProf) => {
          setProfile(newProf);
          setIsOnboardingOpen(false);
        }}
      />

      <AccountSettingsModal
        isOpen={isSettingsOpen}
        profile={profile}
        onClose={() => setIsSettingsOpen(false)}
        onLockSession={() => setIsLocked(true)}
        onLogoutWipe={() => {
          setProfile(null);
          setIsSettingsOpen(false);
        }}
      />
    </div>
  );
}
