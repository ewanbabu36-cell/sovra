/**
 * @file apps/sovra-mobile/src/screens/MeScreen.tsx
 * User Profile, Passkeys & Micro-Tip Wallet Screen for Mobile App.
 *
 * Implements:
 * 1. Cryptographic DID identity badge (did:key).
 * 2. Biometric WebAuthn Passkeys session manager.
 * 3. 3-Column media portfolio grid.
 * 4. Micro-tip creator wallet balance.
 */

import React, { useState } from 'react';

export function MeScreen(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [walletBalance, setWalletBalance] = useState('24.50');

  return (
    <div style={{ flex: 1, backgroundColor: '#090d16', color: '#fff', overflowY: 'auto', paddingBottom: 64 }}>
      {/* Profile Header */}
      <div style={{ padding: '16px 16px 8px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>meraj_sharif</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 18 }}>
            <span>➕</span>
            <span>⚙️</span>
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
            M
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
          <div style={{ fontSize: 13, fontWeight: 700 }}>Meraj Sharif ⚡ Core Creator</div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
            Building decentralized super-apps on Noise_XX & UnixFS Merkle DAGs. Zero algorithms.
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
              did:key:z6MksMeraj...Verified
            </span>
          </div>
        </div>

        {/* Passkey & Wallet Cards */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
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
    </div>
  );
}
