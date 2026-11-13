/**
 * @file apps/sovra-mobile/src/screens/profile/ProfileScreen.tsx
 * Modular Sovereign Profile Screen: Bio, Verified Identity, Social Stats & Media Grid.
 */

import React, { useState } from 'react';
import type { UserAccountProfile } from '@sovra/identity';

export interface ProfileScreenProps {
  readonly profile: UserAccountProfile;
  readonly stats: {
    readonly followersCount: number;
    readonly followingCount: number;
    readonly friendsCount: number;
    readonly postsCount: number;
  };
  readonly posts: any[];
  readonly bookmarkedPosts?: any[];
  readonly onOpenSettings: () => void;
  readonly onOpenStudio?: () => void;
  readonly onOpenWallet?: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  profile,
  stats,
  posts,
  bookmarkedPosts = [],
  onOpenSettings,
  onOpenStudio,
  onOpenWallet,
}) => {
  const [activeTab, setActiveTab] = useState<'posts' | 'saved'>('posts');

  return (
    <div style={{ padding: '16px 16px 80px 16px', color: '#f8fafc', maxWidth: 480, margin: '0 auto' }}>
      {/* Top Header Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{profile.handle || '@sovereign'}</span>
          <span style={{ color: '#38bdf8', fontSize: 14 }} title="Verified Peer">✓</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onOpenStudio && (
            <button
              onClick={onOpenStudio}
              style={{
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#818cf8',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🎨 Studio
            </button>
          )}
          <button
            onClick={onOpenSettings}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#f8fafc',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Profile Header Card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 800,
            border: '2px solid rgba(255,255,255,0.15)',
            flexShrink: 0,
          }}
        >
          {profile.displayName?.charAt(0)?.toUpperCase() || 'S'}
        </div>
        <div style={{ display: 'flex', flex: 1, justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{stats.postsCount || posts.length}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Posts</div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{stats.followersCount}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Followers</div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{stats.followingCount}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Following</div>
          </div>
        </div>
      </div>

      {/* Name, Bio, and Verified Badge */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{profile.displayName || 'Sovereign Peer'}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, lineHeight: 1.4 }}>
          {profile.deviceId ? 'Decentralized Sovereign Citizen & P2P Mesh Node' : 'Self-Sovereign Identity on Sovra Network'}
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            padding: '2px 8px',
            borderRadius: 6,
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 10, color: '#34d399', fontWeight: 700 }}>
            🛡️ Hardware Passkey Protected &bull; Zero Central Tracking
          </span>
        </div>
      </div>

      {/* 2-Column Action Pill Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={onOpenWallet}
          style={{
            flex: 1,
            backgroundColor: '#1e293b',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#f8fafc',
            borderRadius: 10,
            padding: '10px 0',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🪙 Wallet Hub
        </button>
        <button
          onClick={onOpenSettings}
          style={{
            flex: 1,
            backgroundColor: '#1e293b',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#f8fafc',
            borderRadius: 10,
            padding: '10px 0',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Edit Profile
        </button>
      </div>

      {/* Content Tabs: Grid & Saved */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 12 }}>
        <button
          onClick={() => setActiveTab('posts')}
          style={{
            flex: 1,
            padding: '10px 0',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'posts' ? '2px solid #38bdf8' : '2px solid transparent',
            color: activeTab === 'posts' ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          📸 Posts ({posts.length})
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          style={{
            flex: 1,
            padding: '10px 0',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'saved' ? '2px solid #38bdf8' : '2px solid transparent',
            color: activeTab === 'saved' ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🔖 Saved ({bookmarkedPosts.length})
        </button>
      </div>

      {/* 3-Column Portfolio Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {activeTab === 'posts' ? (
          posts.length === 0 ? (
            <div style={{ gridColumn: 'span 3', textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: 13 }}>
              No sovereign posts published yet. Tap [+] to share your first story!
            </div>
          ) : (
            posts.map((p, idx) => (
              <div
                key={p.id || idx}
                style={{
                  aspectRatio: '1',
                  backgroundColor: '#1e293b',
                  borderRadius: 4,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: '#94a3b8',
                  position: 'relative',
                }}
              >
                {p.mediaUrl ? (
                  <img src={p.mediaUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ padding: 6, textAlign: 'center', fontSize: 10 }}>{p.content?.slice(0, 30) || 'Post'}</div>
                )}
              </div>
            ))
          )
        ) : (
          bookmarkedPosts.map((p, idx) => (
            <div
              key={p.id || idx}
              style={{
                aspectRatio: '1',
                backgroundColor: '#1e293b',
                borderRadius: 4,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ padding: 6, textAlign: 'center', fontSize: 10, color: '#94a3b8' }}>
                {p.content?.slice(0, 30) || 'Bookmark'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
