/**
 * @file apps/sovra-mobile/src/screens/FeedScreen.tsx
 * Instagram-Style Feed Screen for Mobile App.
 *
 * Implements:
 * 1. Dynamic P2P / Backend Stories Carousel with 24h ephemeral gradient rings.
 * 2. Real Feed cards with photo preview, double-tap heart, optimistic likes with rollback.
 * 3. Complete State: Initial/Loading Shimmer, Populated, Empty, Error with Retry.
 * 4. Real Post Creation modal with duplicate-submission protection.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { MobileStoryItem } from '../types.js';
import {
  fetchFeedPosts,
  likeFeedPost,
  createFeedPost,
  fetchStories,
  markStorySeen,
} from '../services/api.js';

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
  mediaImage?: string;
  mediaGradient?: string;
  commentsCount?: number;
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // New post modal state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newCaption, setNewCaption] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Toast notification for errors / feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [storiesData, postsData] = await Promise.allSettled([
        fetchStories(),
        fetchFeedPosts(),
      ]);

      if (storiesData.status === 'fulfilled' && storiesData.value.length > 0) {
        setStories(storiesData.value);
      }
      if (postsData.status === 'fulfilled') {
        setPosts(postsData.value);
      } else if (postsData.status === 'rejected') {
        throw postsData.reason;
      }
    } catch (err: any) {
      console.warn('[FeedScreen] Load error:', err);
      setError(err?.message || 'Failed to load swarm feed. Using cached state.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const toggleStorySeen = async (id: string) => {
    setStories(prev =>
      prev.map(s => (s.id === id ? { ...s, isSeen: true } : s)),
    );
    try {
      await markStorySeen(id);
    } catch {
      // Non-critical background failure
    }
  };

  const toggleLike = async (id: string) => {
    const postIndex = posts.findIndex(p => p.id === id);
    if (postIndex === -1) return;
    const post = posts[postIndex]!;
    const previousIsLiked = !!post.isLiked;
    const previousLikes = post.likes;
    const newIsLiked = !previousIsLiked;
    const newLikes = newIsLiked ? previousLikes + 1 : Math.max(0, previousLikes - 1);

    // Optimistic update
    setPosts(prev =>
      prev.map(p =>
        p.id === id
          ? {
              ...p,
              isLiked: newIsLiked,
              likes: newLikes,
            }
          : p,
      ),
    );

    try {
      await likeFeedPost(id, newIsLiked);
    } catch (err: any) {
      // Rollback on failure
      setPosts(prev =>
        prev.map(p =>
          p.id === id
            ? {
                ...p,
                isLiked: previousIsLiked,
                likes: previousLikes,
              }
            : p,
        ),
      );
      showToast(`Like failed: ${err.message || 'Network error'}`);
    }
  };

  const handleCreatePost = async () => {
    const caption = newCaption.trim();
    if (!caption) {
      setCreateError('Please enter a caption for your post');
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const res = await createFeedPost(caption);
      if (res.ok && res.post) {
        const newPost: FeedPost = {
          id: res.post.id,
          creatorHandle: res.post.authorName
            ? res.post.authorName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
            : 'you',
          creatorName: res.post.authorName || 'You',
          avatarEmoji: res.post.authorAvatar || '⚡',
          imageEmoji: res.post.mediaEmoji || '🌌',
          mediaImage: res.post.mediaImage,
          caption: res.post.caption,
          likes: 0,
          timeAgo: 'Just now',
          isLiked: false,
        };
        setPosts(prev => [newPost, ...prev]);
        setNewCaption('');
        setIsCreateOpen(false);
        showToast('✓ Post published to sovereign peer swarm!');
      } else {
        throw new Error(res.error || 'Failed to publish post');
      }
    } catch (err: any) {
      setCreateError(err.message || 'Could not publish post to network');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#090d16',
        color: '#fff',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: '#090d16',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: -0.5 }}>SOVRA</span>
          <span
            style={{
              fontSize: 10,
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            P2P MESH
          </span>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button
            onClick={() => setIsCreateOpen(true)}
            aria-label="Create Post"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#38bdf8',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ➕
          </button>
          <button
            onClick={handleRefresh}
            aria-label="Refresh Feed"
            disabled={isRefreshing}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '1.1rem',
              cursor: isRefreshing ? 'wait' : 'pointer',
              opacity: isRefreshing ? 0.5 : 1,
              padding: 0,
            }}
          >
            🔄
          </button>
        </div>
      </header>

      {/* Toast Alert */}
      {toastMessage && (
        <div
          role="alert"
          style={{
            position: 'sticky',
            top: 50,
            zIndex: 50,
            backgroundColor: '#0284c7',
            color: '#fff',
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Error Banner with Retry */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: '#f87171',
          }}
        >
          <span>⚠️ {error}</span>
          <button
            onClick={loadData}
            style={{
              padding: '4px 10px',
              backgroundColor: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Stories Carousel */}
      <section
        aria-label="Stories Carousel"
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          overflowX: 'auto',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Your Story Button */}
        <div
          onClick={() => setIsCreateOpen(true)}
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

        {/* Stories Items */}
        {stories.map(story => (
          <div
            key={story.id}
            role="button"
            tabIndex={0}
            onClick={() => toggleStorySeen(story.id)}
            onKeyDown={e => e.key === 'Enter' && toggleStorySeen(story.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              outline: 'none',
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
                transition: 'background 0.3s',
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
            <span style={{ fontSize: 10, color: '#cbd5e1', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {story.creatorName}
            </span>
          </div>
        ))}
      </section>

      {/* Feed Posts */}
      <section aria-label="Feed Stream" style={{ flex: 1, paddingBottom: 64 }}>
        {/* Loading Skeleton */}
        {isLoading && (
          <div style={{ padding: 16 }}>
            {[1, 2].map(k => (
              <div
                key={k}
                style={{
                  marginBottom: 24,
                  backgroundColor: '#111827',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: '#1f2937' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ width: 120, height: 12, backgroundColor: '#1f2937', borderRadius: 4, marginBottom: 6 }} />
                    <div style={{ width: 70, height: 10, backgroundColor: '#1f2937', borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ width: '100%', height: 260, backgroundColor: '#1f2937' }} />
                <div style={{ padding: 12 }}>
                  <div style={{ width: '80%', height: 12, backgroundColor: '#1f2937', borderRadius: 4, marginBottom: 8 }} />
                  <div style={{ width: '50%', height: 10, backgroundColor: '#1f2937', borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && posts.length === 0 && (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 44 }}>🌌</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>No Peer Posts in Mesh</h3>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, maxWidth: 280 }}>
              Your sovereign feed is completely empty. Be the first to broadcast a post to the network!
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              style={{
                marginTop: 8,
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Broadcast First Post ⚡
            </button>
          </div>
        )}

        {/* Populated Posts */}
        {!isLoading &&
          posts.map(post => (
            <article
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.creatorName}
                  </div>
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
                  background: post.mediaGradient || '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '4.5rem',
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
              >
                {post.mediaImage ? (
                  <img
                    src={post.mediaImage}
                    alt={post.caption || 'Feed post image'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  post.imageEmoji || '🌌'
                )}
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
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <button
                    onClick={() => toggleLike(post.id)}
                    aria-label={post.isLiked ? 'Unlike' : 'Like'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1.2rem',
                      padding: 0,
                      color: post.isLiked ? '#ef4444' : '#fff',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    {post.isLiked ? '❤️' : '🤍'}
                  </button>
                  <span style={{ cursor: 'pointer' }}>💬</span>
                  <span style={{ cursor: 'pointer' }}>↗️</span>
                </div>
                <span style={{ cursor: 'pointer' }}>🔖</span>
              </div>

              {/* Post Likes & Caption */}
              <div style={{ padding: '0 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  {post.likes} {post.likes === 1 ? 'like' : 'likes'}
                </div>
                <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4, wordBreak: 'break-word' }}>
                  <span style={{ fontWeight: 700, marginRight: 6 }}>{post.creatorHandle}</span>
                  {post.caption}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{post.timeAgo}</div>
              </div>
            </article>
          ))}
      </section>

      {/* Create Post Modal */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              backgroundColor: '#111827',
              borderRadius: 16,
              padding: 20,
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Create Sovereign Post</h3>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setCreateError(null);
                }}
                disabled={isSubmitting}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {createError && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#f87171',
                  marginBottom: 12,
                }}
              >
                {createError}
              </div>
            )}

            <textarea
              value={newCaption}
              onChange={e => setNewCaption(e.target.value)}
              placeholder="What's happening on the P2P mesh network?"
              disabled={isSubmitting}
              rows={4}
              style={{
                width: '100%',
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 10,
                color: '#fff',
                padding: 12,
                fontSize: 13,
                resize: 'none',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 16,
              }}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setCreateError(null);
                }}
                disabled={isSubmitting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#374151',
                  color: '#cbd5e1',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={isSubmitting || !newCaption.trim()}
                style={{
                  padding: '8px 20px',
                  backgroundColor: isSubmitting || !newCaption.trim() ? '#475569' : '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isSubmitting || !newCaption.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isSubmitting ? 'Broadcasting...' : 'Broadcast Post ⚡'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
