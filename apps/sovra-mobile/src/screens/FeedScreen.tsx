/**
 * @file apps/sovra-mobile/src/screens/FeedScreen.tsx
 * Instagram-Style Feed Screen for Mobile App.
 *
 * Implements:
 * 1. Horizontal Stories Carousel with 24h ephemeral gradient rings.
 * 2. Feed cards with photo preview, double-tap heart, and optimistic CRDT likes.
 */

import React, { useState } from 'react';
import type { MobileStoryItem } from '../types.js';

export const INITIAL_STORIES: MobileStoryItem[] = [
  {
    id: 's-1',
    creatorHandle: 'alice_p2p',
    creatorName: 'Alice',
    avatarEmoji: '⚡',
    avatarBg: '#312e81',
    isSeen: false,
    hoursRemaining: 23,
  },
  {
    id: 's-2',
    creatorHandle: 'bob_live',
    creatorName: 'Bob',
    avatarEmoji: '📡',
    avatarBg: '#065f46',
    isSeen: false,
    hoursRemaining: 18,
  },
  {
    id: 's-3',
    creatorHandle: 'carol_sound',
    creatorName: 'Carol',
    avatarEmoji: '🎧',
    avatarBg: '#831843',
    isSeen: true,
    hoursRemaining: 12,
  },
];

export interface FeedPost {
  id: string;
  creatorHandle: string;
  creatorName: string;
  avatarEmoji: string;
  imageEmoji: string;
  caption: string;
  likes: number;
  timeAgo: string;
  isLiked?: boolean;
}

export const INITIAL_POSTS: FeedPost[] = [
  {
    id: 'post-1',
    creatorHandle: 'alice_p2p',
    creatorName: 'Alice ⚡ P2P Architect',
    avatarEmoji: '⚡',
    imageEmoji: '🌌',
    caption: 'Zero central servers! Streaming raw UnixFS blocks over pure UDP QUIC. ⚡',
    likes: 412,
    timeAgo: '2h ago',
  },
  {
    id: 'post-2',
    creatorHandle: 'bob_live',
    creatorName: 'Bob | 5G Telecom',
    avatarEmoji: '📡',
    imageEmoji: '🚀',
    caption: 'Direct IPv6-to-IPv6 hole punch verified on Indian 5G carrier! No relay lag.',
    likes: 289,
    timeAgo: '5h ago',
  },
];

export function FeedScreen(): React.JSX.Element {
  const [stories, setStories] = useState<MobileStoryItem[]>(INITIAL_STORIES);
  const [posts, setPosts] = useState<FeedPost[]>(INITIAL_POSTS);

  const toggleStorySeen = (id: string) => {
    setStories(prev =>
      prev.map(s => (s.id === id ? { ...s, isSeen: true } : s)),
    );
  };

  const toggleLike = (id: string) => {
    setPosts(prev =>
      prev.map(p =>
        p.id === id
          ? {
              ...p,
              isLiked: !p.isLiked,
              likes: p.isLiked ? p.likes - 1 : p.likes + 1,
            }
          : p,
      ),
    );
  };

  return (
    <div style={{ flex: 1, backgroundColor: '#090d16', color: '#fff', overflowY: 'auto' }}>
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: -0.5 }}>SOVRA</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <span>❤️</span>
          <span>💬</span>
        </div>
      </div>

      {/* Stories Carousel */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          overflowX: 'auto',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Your Story */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: '50%',
              backgroundColor: '#1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid #38bdf8',
            }}
          >
            <span style={{ fontSize: '1.2rem', color: '#38bdf8' }}>+</span>
          </div>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Your Story</span>
        </div>

        {/* Other Stories */}
        {stories.map(story => (
          <div
            key={story.id}
            onClick={() => toggleStorySeen(story.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                padding: 2.5,
                background: story.isSeen
                  ? '#374151'
                  : 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  backgroundColor: story.avatarBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.1rem',
                  border: '2px solid #090d16',
                }}
              >
                {story.avatarEmoji}
              </div>
            </div>
            <span style={{ fontSize: 10, color: '#cbd5e1' }}>{story.creatorName}</span>
          </div>
        ))}
      </div>

      {/* Feed Posts */}
      <div style={{ paddingBottom: 64 }}>
        {posts.map(post => (
          <div
            key={post.id}
            style={{
              marginBottom: 16,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              paddingBottom: 12,
            }}
          >
            {/* Post Author */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  backgroundColor: '#312e81',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {post.avatarEmoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{post.creatorName}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>@{post.creatorHandle}</div>
              </div>
              <span style={{ color: '#64748b' }}>•••</span>
            </div>

            {/* Media Canvas */}
            <div
              onDoubleClick={() => toggleLike(post.id)}
              style={{
                width: '100%',
                height: 320,
                backgroundColor: '#111827',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '4.5rem',
                position: 'relative',
              }}
            >
              {post.imageEmoji}
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 16px',
                fontSize: '1.2rem',
              }}
            >
              <div style={{ display: 'flex', gap: 14 }}>
                <span
                  onClick={() => toggleLike(post.id)}
                  style={{ cursor: 'pointer', color: post.isLiked ? '#ef4444' : '#fff' }}
                >
                  {post.isLiked ? '❤️' : '🤍'}
                </span>
                <span>💬</span>
                <span>↗️</span>
              </div>
              <span>🔖</span>
            </div>

            {/* Post Likes & Caption */}
            <div style={{ padding: '0 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                {post.likes} likes
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, marginRight: 6 }}>{post.creatorHandle}</span>
                {post.caption}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{post.timeAgo}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
