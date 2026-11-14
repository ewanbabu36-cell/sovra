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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { MobileStoryItem } from '../types.js';
import {
  fetchFeedPosts,
  likeFeedPost,
  createFeedPost,
  voteFeedPoll,
  reportFeedPost,
  fetchStories,
  fetchStoriesSwarm,
  publishStory,
  markStorySeen,
  fetchFeedComments,
  addFeedComment,
  likeFeedComment,
  repostFeedPost,
  saveFeedPost,
  searchGlobal,
  followUser,
  unfollowUser,
  type GlobalSearchResult,
  type GlobalSearchUser,
} from '../services/api.js';
import { localDb } from '../services/local-database.js';
import { syncEngine } from '../services/sync-engine.js';
import { SovereignHeroAnchorCard } from '../components/SovereignHeroAnchorCard.js';
import {
  IdentitySwitcherModal,
  HeaderIdentitySwitcherPill,
  DEFAULT_PERSONAS,
  type SovereignPersona,
} from '../components/IdentitySwitcherModal.js';
import {
  SovereignCheckoutModal,
  type CheckoutItemPayload,
} from '../components/SovereignCheckoutModal.js';
import { SovraBrandLogo } from '../components/SovraBrandLogo.js';

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

export interface FeedPollOption {
  text: string;
  votes: number;
}

export interface FeedPoll {
  id: string;
  question: string;
  options: FeedPollOption[];
  totalVotes: number;
  userVotedIndex?: number | undefined;
  expiresAt: number;
}

export interface FeedPost {
  id: string;
  creatorHandle: string;
  creatorName: string;
  avatarEmoji: string;
  imageEmoji: string;
  caption: string;
  likes: number;
  timeAgo: string;
  isLiked?: boolean | undefined;
  mediaImage?: string | undefined;
  carouselImages?: string[] | undefined;
  mediaVideo?: string | undefined;
  mediaGradient?: string | undefined;
  commentsCount?: number | undefined;
  poll?: FeedPoll | undefined;
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

export function StoryComposerModal({
  isOpen,
  onClose,
  onStoryPublished,
}: {
  isOpen: boolean;
  onClose: () => void;
  onStoryPublished: (newStory: MobileStoryItem) => void;
}): React.JSX.Element | null {
  const [caption, setCaption] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedBg, setSelectedBg] = useState('#312e81');
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const bgPresets = ['#312e81', '#065f46', '#831843', '#7c2d12', '#1e293b'];

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleBroadcast = async () => {
    setIsPublishing(true);
    setError(null);
    try {
      const res = await publishStory({
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(imagePreview ? { mediaDataUrl: imagePreview } : {}),
        avatarBg: selectedBg,
        avatarEmoji: '⚡',
      });
      if (res.ok) {
        onStoryPublished({
          id: res.story?.id || `s_${Date.now()}`,
          creatorHandle: 'you',
          creatorName: 'You',
          avatarEmoji: '⚡',
          avatarBg: selectedBg,
          isSeen: false,
          hoursRemaining: 24,
        });
        setCaption('');
        setImagePreview(null);
        onClose();
      } else {
        throw new Error(res.error || 'Failed to publish story');
      }
    } catch (err: any) {
      setError(err?.message || 'Publish error');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Story Composer"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          backgroundColor: '#0f172a',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          color: '#fff',
          boxShadow: '0 20px 40px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Add to Your Story</h3>
            <span style={{ fontSize: 11, color: '#38bdf8' }}>⏳ 24h P2P Ephemeral Moment</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 8, fontSize: 11, color: '#f87171' }}>
            {error}
          </div>
        )}

        {/* Media Preview / Picker */}
        <div
          style={{
            height: 180,
            borderRadius: 14,
            background: imagePreview ? '#000' : selectedBg,
            border: '2px dashed rgba(255,255,255,0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          {imagePreview ? (
            <img src={imagePreview} alt="Story preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>📷</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Tap to select photo</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Zero server storage. Broadcast directly to peer swarm.</div>
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </div>

        {/* Color Presets */}
        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Background Aura</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {bgPresets.map(bg => (
              <div
                key={bg}
                onClick={() => setSelectedBg(bg)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: bg,
                  cursor: 'pointer',
                  border: selectedBg === bg ? '2px solid #fff' : '1px solid rgba(255,255,255,0.1)',
                  transform: selectedBg === bg ? 'scale(1.15)' : 'none',
                }}
              />
            ))}
          </div>
        </div>

        {/* Caption */}
        <div>
          <input
            type="text"
            placeholder="Add a moment caption..."
            value={caption}
            onChange={e => setCaption(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 10,
              color: '#fff',
              padding: '10px 12px',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={isPublishing}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#334155',
              color: '#cbd5e1',
              border: 'none',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleBroadcast}
            disabled={isPublishing}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#00a884',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: isPublishing ? 'not-allowed' : 'pointer',
            }}
          >
            {isPublishing ? 'Broadcasting...' : 'Broadcast ⚡'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExploreSearchModal({
  isOpen,
  onClose,
  onSelectPost,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectPost?: (postId: string) => void;
}): React.JSX.Element | null {
  if (!isOpen) return null;

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'people' | 'posts' | 'channels' | 'tags'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult>({ users: [], posts: [], topics: [], channels: [] });
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  const trendingTags = ['#sovra', '#p2p_mesh', '#webrtc', '#privacy', '#cosmwasm', '#zk_identity'];

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults({ users: [], posts: [], topics: [], channels: [] });
      setIsSearching(false);
      return;
    }

    let active = true;
    setIsSearching(true);
    const debounceTimer = setTimeout(async () => {
      try {
        const res = await searchGlobal(q, scope);
        if (active) {
          setResults(res);
        }
      } catch (err) {
        console.warn('[ExploreSearch] Search error:', err);
      } finally {
        if (active) setIsSearching(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(debounceTimer);
    };
  }, [query, scope]);

  const handleToggleFollow = async (user: GlobalSearchUser) => {
    const currentlyFollowing = !!followingMap[user.did];
    setFollowingMap(prev => ({ ...prev, [user.did]: !currentlyFollowing }));

    try {
      if (currentlyFollowing) {
        await unfollowUser(user.did);
      } else {
        await followUser(user.did);
      }
    } catch {
      setFollowingMap(prev => ({ ...prev, [user.did]: currentlyFollowing }));
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: '#090d16',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Search Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: '#0b141a',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            backgroundColor: '#182229',
            borderRadius: 24,
            padding: '8px 14px',
            gap: 8,
            border: '1px solid #334155',
          }}
        >
          <span style={{ fontSize: 14, color: '#94a3b8' }}>🔍</span>
          <input
            type="text"
            placeholder="Search @handles, #tags, posts, channels..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {query.length > 0 && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#38bdf8',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '6px 4px',
          }}
        >
          Done
        </button>
      </div>

      {/* Scope Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backgroundColor: '#090d16',
          overflowX: 'auto',
        }}
      >
        {(['all', 'people', 'posts', 'channels', 'tags'] as const).map(sc => (
          <button
            key={sc}
            onClick={() => setScope(sc)}
            style={{
              padding: '5px 12px',
              borderRadius: 16,
              border: 'none',
              backgroundColor: scope === sc ? '#38bdf8' : 'rgba(255,255,255,0.08)',
              color: scope === sc ? '#000' : '#cbd5e1',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
            }}
          >
            {sc}
          </button>
        ))}
      </div>

      {/* Results Viewport */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* Trending Tags (Shown when no search query) */}
        {!query.trim() && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 10, letterSpacing: 0.5 }}>
              🔥 TRENDING SWARM TOPICS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {trendingTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setQuery(tag)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 20,
                    color: '#38bdf8',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>Decentralized P2P Explorer</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Discover sovereign peers, community broadcast channels, and trending posts across the mesh network.
              </div>
            </div>
          </div>
        )}

        {/* Searching Loader */}
        {isSearching && (
          <div style={{ textAlign: 'center', padding: 24, color: '#38bdf8', fontSize: 12 }}>
            Searching swarm index... ⚡
          </div>
        )}

        {/* Users / People Results */}
        {(scope === 'all' || scope === 'people') && results.users.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>
              PEOPLE ({results.users.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.users.map(u => {
                const isFoll = followingMap[u.did] ?? u.isFollowing;
                return (
                  <div
                    key={u.did}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      backgroundColor: '#182229',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: '50%',
                          backgroundColor: '#0284c7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 16,
                          fontWeight: 700,
                        }}
                      >
                        {u.avatar || u.displayName.slice(0, 1)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{u.displayName}</div>
                        <div style={{ fontSize: 11, color: '#38bdf8' }}>@{u.handle.replace(/^@/, '')}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleFollow(u)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 18,
                        border: 'none',
                        backgroundColor: isFoll ? '#334155' : '#38bdf8',
                        color: isFoll ? '#cbd5e1' : '#000',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {isFoll ? 'Following' : 'Follow'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Channels Results */}
        {(scope === 'all' || scope === 'channels') && results.channels.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>
              CHANNELS ({results.channels.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.channels.map(c => (
                <div
                  key={c.id}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#182229',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {c.topic || 'Decentralized Peer Mesh Community'} &bull; 👥 {c.subscriberCount || 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Posts Results */}
        {(scope === 'all' || scope === 'posts') && results.posts.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>
              POSTS ({results.posts.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.posts.map(p => (
                <div
                  key={p.id}
                  onClick={() => onSelectPost?.(p.id)}
                  style={{
                    padding: '12px',
                    backgroundColor: '#182229',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                    cursor: onSelectPost ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>{p.authorName}</span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'Recent'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4 }}>{p.caption}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {query.trim() && !isSearching && results.users.length === 0 && results.posts.length === 0 && results.channels.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>No matches found for &ldquo;{query}&rdquo;</div>
            <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>
              Try searching by a different keyword or checking one of the trending tags above.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FeedScreen(): React.JSX.Element {
  const [stories, setStories] = useState<MobileStoryItem[]>(INITIAL_STORIES);
  const [posts, setPosts] = useState<FeedPost[]>(INITIAL_POSTS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [feedFilter, setFeedFilter] = useState<'for-you' | 'trending'>('for-you');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Full-screen Story Viewer state
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [storyProgress, setStoryProgress] = useState<number>(0);
  const [isStoryPaused, setIsStoryPaused] = useState<boolean>(false);

  // Story composer modal state
  const [isStoryComposerOpen, setIsStoryComposerOpen] = useState<boolean>(false);

  // New post modal state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newCaption, setNewCaption] = useState<string>('');
  const [postMediaImage, setPostMediaImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Toast notification for errors / feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Micro-Interaction: Instagram-Grade Double-Tap Floating Heart Burst
  const [postHeartAnim, setPostHeartAnim] = useState<{ postId: string; x: number; y: number; id: number } | null>(null);

  // Feed Comments Modal State
  const [activePostCommentsId, setActivePostCommentsId] = useState<string | null>(null);
  const [commentsList, setCommentsList] = useState<any[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState<boolean>(false);
  const [commentInputText, setCommentInputText] = useState<string>('');
  const [isSubmittingComment, setIsSubmittingComment] = useState<boolean>(false);

  // Post Actions State
  const [bookmarkedPosts, setBookmarkedPosts] = useState<Set<string>>(new Set());
  const [repostedPosts, setRepostedPosts] = useState<Set<string>>(new Set());

  // Phase 1.1: Virtualized Feed & Infinite Scroll Windowing
  const [visibleCount, setVisibleCount] = useState<number>(8);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);

  // Phase 1.2: Multi-Image Carousel & Video Composer State
  const [postCarouselImages, setPostCarouselImages] = useState<string[]>([]);
  const [postMediaVideo, setPostMediaVideo] = useState<string | null>(null);
  const [activeCarouselIndices, setActiveCarouselIndices] = useState<Record<string, number>>({});

  // Phase 1.3: Interactive Community Polls State
  const [isPollEnabled, setIsPollEnabled] = useState<boolean>(false);
  const [pollQuestion, setPollQuestion] = useState<string>('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [userPollVotes, setUserPollVotes] = useState<Record<string, number>>({});

  // Phase 1.4: Client-Side Post Trust & Safety Menu
  const [activePostMenuId, setActivePostMenuId] = useState<string | null>(null);
  const [mutedAuthors, setMutedAuthors] = useState<Set<string>>(new Set());
  const [blockedPeers, setBlockedPeers] = useState<Set<string>>(new Set());
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());

  // Phase 1.5: Real-Time "New Posts ↑" Floating Pill
  const [newIncomingPostsCount, setNewIncomingPostsCount] = useState<number>(0);

  // Airtel UX & Horizon Switcher States
  const [activePersona, setActivePersona] = useState<SovereignPersona>(DEFAULT_PERSONAS[0]!);
  const [isIdentitySwitcherOpen, setIsIdentitySwitcherOpen] = useState<boolean>(false);
  const [checkoutItem, setCheckoutItem] = useState<CheckoutItemPayload | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const openStoryViewer = (storyId: string) => {
    const idx = stories.findIndex(s => s.id === storyId);
    if (idx !== -1) {
      setActiveStoryIndex(idx);
      setStoryProgress(0);
      setIsStoryPaused(false);
      toggleStorySeen(storyId);
    }
  };

  const closeStoryViewer = () => {
    setActiveStoryIndex(null);
    setStoryProgress(0);
  };

  const nextStory = useCallback(() => {
    setActiveStoryIndex(prev => {
      if (prev === null) return null;
      if (prev < stories.length - 1) {
        const nextIdx = prev + 1;
        setStoryProgress(0);
        const storyItem = stories[nextIdx];
        if (storyItem) toggleStorySeen(storyItem.id);
        return nextIdx;
      }
      return null;
    });
  }, [stories]);

  const prevStory = useCallback(() => {
    setActiveStoryIndex(prev => {
      if (prev === null || prev === 0) return prev;
      setStoryProgress(0);
      return prev - 1;
    });
  }, []);

  // 5-second automatic progression timer for stories
  useEffect(() => {
    if (activeStoryIndex === null || isStoryPaused) return;
    const interval = setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) {
          nextStory();
          return 0;
        }
        return prev + 2; // 50 ticks of 100ms = 5000ms
      });
    }, 100);
    return () => clearInterval(interval);
  }, [activeStoryIndex, isStoryPaused, nextStory]);

  const loadData = useCallback(async (customFilter?: 'for-you' | 'trending') => {
    const activeFilter = customFilter || feedFilter;
    try {
      setError(null);
      const postsPromise =
        activeFilter === 'trending'
          ? fetch('/api/feed/trending')
              .then(r => (r.ok ? r.json() : null))
              .then(d => (d && d.ok && Array.isArray(d.posts) ? d.posts : fetchFeedPosts()))
              .catch(() => fetchFeedPosts())
          : fetchFeedPosts();

      const [storiesData, postsData] = await Promise.allSettled([
        fetchStoriesSwarm().catch(() => fetchStories()),
        postsPromise,
      ]);

      if (storiesData.status === 'fulfilled' && storiesData.value.length > 0) {
        setStories(storiesData.value);
      }
      if (postsData.status === 'fulfilled') {
        setPosts(postsData.value);
        // Cache posts to durable local database
        for (const p of postsData.value) {
          localDb.savePost({
            id: p.id,
            authorDid: p.creatorHandle,
            authorName: p.creatorName,
            authorHandle: p.creatorHandle,
            authorAvatar: p.avatarEmoji,
            caption: p.caption,
            timestamp: Date.now(),
            likesCount: p.likes,
            likedByDids: [],
            isLiked: !!p.isLiked,
            commentsCount: 0,
            syncStatus: 'SYNCED',
          });
        }
      } else if (postsData.status === 'rejected') {
        // Fallback to durable local database
        const cached = localDb.getPosts();
        if (cached.length > 0) {
          setPosts(
            cached.map(cp => ({
              id: cp.id,
              creatorHandle: cp.authorHandle,
              creatorName: cp.authorName,
              avatarEmoji: cp.authorAvatar || '⚡',
              imageEmoji: '🌌',
              caption: cp.caption,
              likes: cp.likesCount,
              timeAgo: 'Cached',
              isLiked: !!cp.isLiked,
              ...(cp.mediaDataUrl ? { mediaImage: cp.mediaDataUrl } : {}),
            })),
          );
        } else {
          throw postsData.reason;
        }
      }
    } catch (err: any) {
      console.warn('[FeedScreen] Load error:', err);
      setError(err?.message || 'Failed to load swarm feed. Using cached state.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [feedFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const handlePostImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        setPostMediaImage(res);
        setPostCarouselImages([res]);
      };
      reader.readAsDataURL(files[0]!);
    } else {
      const fileList = Array.from(files).slice(0, 5);
      const promises = fileList.map(f => new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.readAsDataURL(f);
      }));
      Promise.all(promises).then(images => {
        setPostCarouselImages(images);
        setPostMediaImage(images[0] || null);
      });
    }
  };

  const handlePostVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setPostMediaVideo(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleVotePoll = async (postId: string, optionIndex: number) => {
    if (userPollVotes[postId] !== undefined) return;
    setUserPollVotes(prev => ({ ...prev, [postId]: optionIndex }));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId || !p.poll) return p;
      const updatedOpts = p.poll.options.map((opt, idx) => ({
        ...opt,
        votes: idx === optionIndex ? opt.votes + 1 : opt.votes,
      }));
      return {
        ...p,
        poll: {
          ...p.poll,
          options: updatedOpts,
          totalVotes: p.poll.totalVotes + 1,
          userVotedIndex: optionIndex,
        },
      };
    }));
    try {
      await voteFeedPoll(postId, optionIndex);
      showToast('✓ Consensus vote registered on P2P mesh');
    } catch (_) {}
  };

  const handleReportPost = async (postId: string) => {
    const reason = window.prompt('Report Post (Spam, Harassment, Misinformation, Scam):', 'Spam');
    if (!reason) return;
    setActivePostMenuId(null);
    setHiddenPostIds(prev => new Set([...prev, postId]));
    showToast('✓ Post reported to community moderation and hidden');
    try {
      await reportFeedPost(postId, reason);
    } catch (_) {}
  };

  const handleMuteAuthor = (authorHandle: string) => {
    setActivePostMenuId(null);
    setMutedAuthors(prev => new Set([...prev, authorHandle]));
    showToast(`🔇 Muted @${authorHandle}. Content hidden from feed.`);
  };

  const handleBlockPeer = (authorHandle: string) => {
    setActivePostMenuId(null);
    setBlockedPeers(prev => new Set([...prev, authorHandle]));
    showToast(`🚫 Blocked peer @${authorHandle}`);
  };

  const handleHidePost = (postId: string) => {
    setActivePostMenuId(null);
    setHiddenPostIds(prev => new Set([...prev, postId]));
    showToast('Post hidden from your feed');
  };

  const handleNextCarousel = (postId: string, max: number) => {
    setActiveCarouselIndices(prev => ({
      ...prev,
      [postId]: ((prev[postId] || 0) + 1) % max,
    }));
  };

  const handlePrevCarousel = (postId: string, max: number) => {
    setActiveCarouselIndices(prev => ({
      ...prev,
      [postId]: ((prev[postId] || 0) - 1 + max) % max,
    }));
  };

  const handleScrollToTopAndLoadNew = () => {
    feedScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setNewIncomingPostsCount(0);
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

  const handlePostDoubleTap = (e: React.MouseEvent, postId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPostHeartAnim({ postId, x, y, id: Date.now() });
    setTimeout(() => setPostHeartAnim(null), 750);
    const post = posts.find(p => p.id === postId);
    if (post && !post.isLiked) {
      toggleLike(postId);
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([35, 25, 35]);
    } catch {}
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
    if (!caption && !postMediaImage && postCarouselImages.length === 0 && !postMediaVideo && !isPollEnabled) {
      setCreateError('Please enter a caption, attach media, or add a poll');
      return;
    }

    let pollPayload: FeedPoll | undefined = undefined;
    if (isPollEnabled) {
      const validOptions = pollOptions.map(o => o.trim()).filter(Boolean);
      if (!pollQuestion.trim()) {
        setCreateError('Please enter a question for your poll');
        return;
      }
      if (validOptions.length < 2) {
        setCreateError('Poll requires at least 2 options');
        return;
      }
      pollPayload = {
        id: `poll_${Date.now()}`,
        question: pollQuestion.trim(),
        options: validOptions.map(opt => ({ text: opt, votes: 0 })),
        totalVotes: 0,
        expiresAt: Date.now() + 86400000 * 3,
      };
    }

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const res = await createFeedPost(caption, postMediaImage || undefined, {
        carouselImages: postCarouselImages.length > 0 ? postCarouselImages : undefined,
        mediaVideo: postMediaVideo || undefined,
        pollData: pollPayload,
      });
      if (res.ok && res.post) {
        const newPost: FeedPost = {
          id: res.post.id,
          creatorHandle: res.post.authorName
            ? res.post.authorName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
            : 'you',
          creatorName: res.post.authorName || 'You',
          avatarEmoji: res.post.authorAvatar || '⚡',
          imageEmoji: res.post.mediaEmoji || '🌌',
          mediaImage: res.post.mediaImage || postMediaImage || undefined,
          carouselImages: postCarouselImages.length > 0 ? postCarouselImages : undefined,
          mediaVideo: postMediaVideo || undefined,
          poll: pollPayload,
          caption: res.post.caption,
          likes: 0,
          timeAgo: 'Just now',
          isLiked: false,
        };
        setPosts(prev => [newPost, ...prev]);
        setNewCaption('');
        setPostMediaImage(null);
        setPostCarouselImages([]);
        setPostMediaVideo(null);
        setIsPollEnabled(false);
        setPollQuestion('');
        setPollOptions(['', '']);
        setIsCreateOpen(false);
        showToast('✓ Post published to sovereign peer swarm!');
      } else {
        throw new Error(res.error || 'Failed to publish post');
      }
    } catch (err: any) {
      // Offline fallback: persist locally and enqueue in durable outbox
      const localId = `post_offline_${Date.now()}`;
      await localDb.savePost({
        id: localId,
        authorDid: 'you',
        authorName: 'You',
        authorHandle: '@you',
        authorAvatar: '⚡',
        caption,
        timestamp: Date.now(),
        likesCount: 0,
        likedByDids: [],
        isLiked: false,
        commentsCount: 0,
        syncStatus: 'LOCAL',
      });
      await localDb.enqueueOperation('CREATE_POST', 'you', { caption });
      syncEngine.triggerSync().catch(() => {});

      const newPost: FeedPost = {
        id: localId,
        creatorHandle: 'you',
        creatorName: 'You (Offline)',
        avatarEmoji: '⚡',
        imageEmoji: '📦',
        caption: `${caption} [Offline Outbox • Sync Pending]`,
        likes: 0,
        timeAgo: 'Just now',
        isLiked: false,
        carouselImages: postCarouselImages.length > 0 ? postCarouselImages : undefined,
        mediaVideo: postMediaVideo || undefined,
        poll: pollPayload,
      };
      setPosts(prev => [newPost, ...prev]);
      setNewCaption('');
      setPostMediaImage(null);
      setPostCarouselImages([]);
      setPostMediaVideo(null);
      setIsPollEnabled(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setIsCreateOpen(false);
      showToast('✓ Post saved offline. Queued for auto-sync!');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openComments = async (postId: string) => {
    setActivePostCommentsId(postId);
    setIsCommentsLoading(true);
    setCommentInputText('');
    try {
      const comments = await fetchFeedComments(postId);
      setCommentsList(comments);
    } catch {
      setCommentsList([]);
    } finally {
      setIsCommentsLoading(false);
    }
  };

  const handleSendComment = async () => {
    const text = commentInputText.trim();
    if (!text || !activePostCommentsId) return;

    setIsSubmittingComment(true);
    try {
      const res = await addFeedComment(activePostCommentsId, text);
      if (res.ok && res.comment) {
        setCommentsList(prev => [...prev, res.comment]);
      } else {
        setCommentsList(prev => [
          ...prev,
          {
            id: `c_${Date.now()}`,
            postId: activePostCommentsId,
            author: 'You',
            text,
            createdAt: new Date().toISOString(),
            likes: 0,
          },
        ]);
      }

      setPosts(prev =>
        prev.map(p =>
          p.id === activePostCommentsId
            ? { ...p, commentsCount: (p.commentsCount || 0) + 1 }
            : p,
        ),
      );
      setCommentInputText('');
      showToast('✓ Comment published!');
    } catch {
      await localDb.enqueueOperation('ADD_COMMENT', 'you', {
        postId: activePostCommentsId,
        text,
      });
      syncEngine.triggerSync().catch(() => {});
      setCommentsList(prev => [
        ...prev,
        {
          id: `c_off_${Date.now()}`,
          postId: activePostCommentsId,
          author: 'You (Offline)',
          text: `${text} [Sync Pending]`,
          createdAt: new Date().toISOString(),
          likes: 0,
        },
      ]);
      setPosts(prev =>
        prev.map(p =>
          p.id === activePostCommentsId
            ? { ...p, commentsCount: (p.commentsCount || 0) + 1 }
            : p,
        ),
      );
      setCommentInputText('');
      showToast('✓ Comment saved offline. Queued for auto-sync!');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    setCommentsList(prev =>
      prev.map(c =>
        c.id === commentId
          ? {
              ...c,
              isLiked: !c.isLiked,
              likes: (c.likes || 0) + (c.isLiked ? -1 : 1),
            }
          : c,
      ),
    );
    await likeFeedComment(commentId);
  };

  const handleRepost = async (postId: string) => {
    const isAlreadyReposted = repostedPosts.has(postId);
    setRepostedPosts(prev => {
      const next = new Set(prev);
      if (isAlreadyReposted) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });

    if (!isAlreadyReposted) {
      await repostFeedPost(postId);
      showToast('🚀 Reposted to your sovereign profile feed!');
    } else {
      showToast('Repost removed');
    }
  };

  const handleSavePost = async (postId: string) => {
    const isAlreadySaved = bookmarkedPosts.has(postId);
    setBookmarkedPosts(prev => {
      const next = new Set(prev);
      if (isAlreadySaved) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });

    await saveFeedPost(postId);
    if (!isAlreadySaved) {
      showToast('🔖 Saved post to sovereign bookmarks!');
    } else {
      showToast('Post removed from bookmarks');
    }
  };

  return (
    <div
      ref={feedScrollRef}
      style={{
        flex: 1,
        backgroundColor: '#090d16',
        color: '#fff',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Real-Time "New Posts ↑" Floating Pill (Phase 1.5) */}
      {newIncomingPostsCount > 0 && (
        <button
          onClick={handleScrollToTopAndLoadNew}
          style={{
            position: 'fixed',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99,
            backgroundColor: '#00a884',
            color: '#fff',
            border: 'none',
            borderRadius: 24,
            padding: '8px 18px',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(0, 168, 132, 0.5)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>⬆️</span>
          <span>{newIncomingPostsCount} New {newIncomingPostsCount === 1 ? 'Post' : 'Posts'}</span>
        </button>
      )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SovraBrandLogo size={32} showWordmark={true} showPill={true} />
          <HeaderIdentitySwitcherPill
            activePersona={activePersona}
            onOpen={() => setIsIdentitySwitcherOpen(true)}
          />
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button
            onClick={() => setIsSearchOpen(true)}
            aria-label="Search & Explore"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#38bdf8',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            🔍
          </button>
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

      {/* Top Sovereign Node & Wallet Hero Anchor Card */}
      <SovereignHeroAnchorCard
        balance="450.50 SOV"
        peerCount={7}
        rttMs={12}
        onSendSov={() => showToast('Opening P2P Transfer Drawer...')}
        onScanQr={() => showToast('Activating Peer DID Camera Scanner...')}
        onGoLive={() => showToast('Initializing Instant P2P Live Broadcast Swarm...')}
        onOpenStore={() => {
          setCheckoutItem({
            id: 'prod_tee_01',
            type: 'store',
            title: 'Sovereign Node Cotton Hoodie',
            priceSov: 45,
            creatorDid: 'did:key:z6MkhaXgBZDvotDkL5257faiz48Z8x28z44SS42E',
            creatorHandle: '@alice_p2p',
            creatorName: 'Alice',
          });
          setIsCheckoutOpen(true);
        }}
      />

      {/* For You vs Trending Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backgroundColor: '#090d16',
        }}
      >
        <button
          onClick={() => {
            setFeedFilter('for-you');
            loadData('for-you');
          }}
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            border: 'none',
            backgroundColor: feedFilter === 'for-you' ? '#38bdf8' : 'rgba(255,255,255,0.08)',
            color: feedFilter === 'for-you' ? '#000' : '#cbd5e1',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          For You
        </button>
        <button
          onClick={() => {
            setFeedFilter('trending');
            loadData('trending');
          }}
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            border: 'none',
            backgroundColor: feedFilter === 'trending' ? '#f59e0b' : 'rgba(255,255,255,0.08)',
            color: feedFilter === 'trending' ? '#000' : '#cbd5e1',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🔥 Trending
        </button>
      </div>

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
            onClick={() => { loadData(); }}
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
          onClick={() => setIsStoryComposerOpen(true)}
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
            onClick={() => openStoryViewer(story.id)}
            onKeyDown={e => e.key === 'Enter' && openStoryViewer(story.id)}
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

      {/* Full-Screen Instagram-Style Story Viewer Modal */}
      {activeStoryIndex !== null && stories[activeStoryIndex] && (
        <div
          role="dialog"
          aria-label="Story Viewer"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            backgroundColor: '#000',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Progress Bar Header */}
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px 8px 16px' }}>
            {stories.map((s, idx) => (
              <div
                key={s.id}
                style={{
                  flex: 1,
                  height: 3,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width:
                      idx < activeStoryIndex
                        ? '100%'
                        : idx === activeStoryIndex
                        ? `${storyProgress}%`
                        : '0%',
                    backgroundColor: '#fff',
                    transition: idx === activeStoryIndex ? 'width 0.1s linear' : 'none',
                  }}
                />
              </div>
            ))}
          </div>

          {/* User Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 16px 12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: stories[activeStoryIndex].avatarBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                {stories[activeStoryIndex].avatarEmoji}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                  {stories[activeStoryIndex].creatorName}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>
                  Sovereign Story &bull; E2EE Ephemeral
                </div>
              </div>
            </div>

            <button
              onClick={closeStoryViewer}
              aria-label="Close Story"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 22,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          {/* Story Content & Tap Zones */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'radial-gradient(circle at center, #1e293b 0%, #030712 100%)',
              userSelect: 'none',
            }}
          >
            {/* Left Tap Zone (Previous Story) */}
            <div
              onClick={prevStory}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: '35%',
                zIndex: 10,
                cursor: 'pointer',
              }}
            />

            {/* Center Pause/Resume Zone */}
            <div
              onClick={() => setIsStoryPaused(!isStoryPaused)}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '35%',
                width: '30%',
                zIndex: 10,
                cursor: 'pointer',
              }}
            />

            {/* Right Tap Zone (Next Story) */}
            <div
              onClick={nextStory}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: '35%',
                zIndex: 10,
                cursor: 'pointer',
              }}
            />

            {/* Big Visual Graphic */}
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 72, marginBottom: 16 }}>
                {stories[activeStoryIndex].avatarEmoji}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
                {stories[activeStoryIndex].creatorName}
              </div>
              <div style={{ fontSize: 12, color: '#38bdf8', maxWidth: 280, margin: '0 auto' }}>
                Broadcasting sovereign ephemeral moment directly across the local 2.4GHz mesh swarm.
              </div>
              {isStoryPaused && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                  ⏸ Paused (Tap to resume)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline Progressive Post Composer (Zero-Popup Industry Standard) */}
      {isCreateOpen ? (
        <div
          style={{
            margin: '12px 16px',
            backgroundColor: '#111827',
            borderRadius: 14,
            padding: 16,
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>⚡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>Broadcast Sovereign Post</span>
            </div>
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
                fontSize: 16,
                cursor: 'pointer',
                padding: 4,
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

          {/* Media Attachment Previews */}
          {postCarouselImages.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                {postCarouselImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }}>
                    <img src={img} alt={`Thumb ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      onClick={() => {
                        const updated = postCarouselImages.filter((_, i) => i !== idx);
                        setPostCarouselImages(updated);
                        setPostMediaImage(updated[0] || null);
                      }}
                      style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ✕
                    </button>
                    <span style={{ position: 'absolute', bottom: 2, left: 2, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 4 }}>
                      #{idx + 1}
                    </span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 10, color: '#38bdf8' }}>📷 {postCarouselImages.length} {postCarouselImages.length === 1 ? 'photo' : 'photos in carousel'} attached</span>
            </div>
          )}

          {postMediaVideo && (
            <div style={{ position: 'relative', marginBottom: 12, borderRadius: 8, overflow: 'hidden', maxHeight: 160, backgroundColor: '#000' }}>
              <video src={postMediaVideo} controls loop muted playsInline style={{ width: '100%', maxHeight: 160, objectFit: 'contain' }} />
              <button
                onClick={() => setPostMediaVideo(null)}
                style={{ position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', fontSize: 12 }}
              >
                ✕
              </button>
              <span style={{ position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', color: '#38bdf8', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
                🎬 Short MP4 Video
              </span>
            </div>
          )}

          {/* Interactive Community Poll Composer */}
          {isPollEnabled && (
            <div style={{ marginBottom: 12, padding: 12, backgroundColor: 'rgba(56, 189, 248, 0.06)', borderRadius: 10, border: '1px solid rgba(56, 189, 248, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>📊 Community Consensus Poll</span>
                <button
                  onClick={() => setIsPollEnabled(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}
                >
                  Remove Poll
                </button>
              </div>
              <input
                type="text"
                placeholder="Ask a community question..."
                value={pollQuestion}
                onChange={e => setPollQuestion(e.target.value)}
                style={{ width: '100%', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#fff', padding: '8px 10px', fontSize: 12, marginBottom: 8, outline: 'none' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pollOptions.map((opt, oIdx) => (
                  <div key={oIdx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder={`Option ${oIdx + 1}`}
                      value={opt}
                      onChange={e => {
                        const next = [...pollOptions];
                        next[oIdx] = e.target.value;
                        setPollOptions(next);
                      }}
                      style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#fff', padding: '6px 8px', fontSize: 12, outline: 'none' }}
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== oIdx))}
                        style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < 4 && (
                <button
                  onClick={() => setPollOptions([...pollOptions, ''])}
                  style={{ marginTop: 8, background: 'none', border: 'none', color: '#38bdf8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  + Add Option (Max 4)
                </button>
              )}
            </div>
          )}

          <textarea
            value={newCaption}
            onChange={e => setNewCaption(e.target.value)}
            placeholder="What's happening on the P2P mesh network? Broadcast to nearby peers..."
            disabled={isSubmitting}
            rows={3}
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
              marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: postCarouselImages.length > 0 ? '#0369a1' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <span>📷</span>
                <span>{postCarouselImages.length > 0 ? `Photos (${postCarouselImages.length})` : 'Add Photos'}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePostImageChange}
                  style={{ display: 'none' }}
                />
              </label>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: postMediaVideo ? '#0284c7' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <span>🎬</span>
                <span>{postMediaVideo ? 'Video Added' : 'Add Video'}</span>
                <input
                  type="file"
                  accept="video/mp4,video/*"
                  onChange={handlePostVideoChange}
                  style={{ display: 'none' }}
                />
              </label>

              <button
                onClick={() => setIsPollEnabled(!isPollEnabled)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: isPollEnabled ? '#0284c7' : 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 11,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span>📊</span>
                <span>{isPollEnabled ? 'Poll Active' : 'Add Poll'}</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setPostMediaImage(null);
                  setPostCarouselImages([]);
                  setPostMediaVideo(null);
                  setIsPollEnabled(false);
                  setCreateError(null);
                }}
                disabled={isSubmitting}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#374151',
                  color: '#cbd5e1',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={isSubmitting || (!newCaption.trim() && postCarouselImages.length === 0 && !postMediaVideo && !isPollEnabled)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isSubmitting || (!newCaption.trim() && postCarouselImages.length === 0 && !postMediaVideo && !isPollEnabled) ? '#475569' : '#00a884',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isSubmitting || (!newCaption.trim() && postCarouselImages.length === 0 && !postMediaVideo && !isPollEnabled) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isSubmitting ? 'Relaying...' : '🚀 Broadcast'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setIsCreateOpen(true)}
          style={{
            margin: '12px 16px',
            padding: '12px 16px',
            backgroundColor: '#111827',
            borderRadius: 12,
            border: '1px dashed rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              backgroundColor: '#00a884',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            ⚡
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>
            What's on your sovereign mind? Broadcast to mesh...
          </div>
          <span style={{ color: '#38bdf8', fontSize: 16 }}>✎</span>
        </div>
      )}

      {/* Feed Posts — Virtualized Windowed Renderer (Phase 1.1) */}
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

        {/* Populated Windowed Posts */}
        {!isLoading &&
          posts
            .filter(
              p =>
                !hiddenPostIds.has(p.id) &&
                !mutedAuthors.has(p.creatorHandle) &&
                !blockedPeers.has(p.creatorHandle)
            )
            .slice(0, visibleCount)
            .map(post => {
              const carouselIndex = activeCarouselIndices[post.id] || 0;
              const hasMultiCarousel = Array.isArray(post.carouselImages) && post.carouselImages.length > 1;

              return (
                <article
                  key={post.id}
                  style={{
                    marginBottom: 16,
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    paddingBottom: 12,
                  }}
                >
                  {/* Post Author & Trust Menu Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 16px',
                      position: 'relative',
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

                    {/* Phase 1.4: Client-Side Trust & Safety 3-Dot Dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setActivePostMenuId(activePostMenuId === post.id ? null : post.id)}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6, fontSize: 14 }}
                        aria-label="Post actions"
                      >
                        •••
                      </button>
                      {activePostMenuId === post.id && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 26,
                            backgroundColor: '#1e293b',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.14)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                            zIndex: 50,
                            width: 175,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <button
                            onClick={() => handleHidePost(post.id)}
                            style={{ padding: '9px 12px', background: 'none', border: 'none', color: '#cbd5e1', textAlign: 'left', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <span>👁️</span> Hide Post
                          </button>
                          <button
                            onClick={() => handleMuteAuthor(post.creatorHandle)}
                            style={{ padding: '9px 12px', background: 'none', border: 'none', color: '#cbd5e1', textAlign: 'left', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <span>🔇</span> Mute @{post.creatorHandle}
                          </button>
                          <button
                            onClick={() => handleBlockPeer(post.creatorHandle)}
                            style={{ padding: '9px 12px', background: 'none', border: 'none', color: '#f87171', textAlign: 'left', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <span>🚫</span> Block Peer
                          </button>
                          <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                          <button
                            onClick={() => handleReportPost(post.id)}
                            style={{ padding: '9px 12px', background: 'none', border: 'none', color: '#ef4444', textAlign: 'left', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
                          >
                            <span>🚩</span> Report Post
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Media Canvas: Multi-Image Carousel (Phase 1.2) or Short Video or Single Photo */}
                  {hasMultiCarousel ? (
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: 320,
                        backgroundColor: '#000',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={post.carouselImages![carouselIndex]}
                        alt={`Slide ${carouselIndex + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onDoubleClick={e => handlePostDoubleTap(e, post.id)}
                      />
                      {/* Floating Double-Tap Heart Burst */}
                      {postHeartAnim && postHeartAnim.postId === post.id && (
                        <div
                          style={{
                            position: 'absolute',
                            left: postHeartAnim.x - 35,
                            top: postHeartAnim.y - 35,
                            fontSize: 70,
                            pointerEvents: 'none',
                            animation: 'heartBurst 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                            zIndex: 40,
                            filter: 'drop-shadow(0 4px 16px rgba(239, 68, 68, 0.8))',
                          }}
                        >
                          ❤️
                        </div>
                      )}
                      {/* Counter Badge */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          backgroundColor: 'rgba(0,0,0,0.7)',
                          color: '#fff',
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {carouselIndex + 1} / {post.carouselImages!.length}
                      </div>
                      {/* Prev Button */}
                      {carouselIndex > 0 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handlePrevCarousel(post.id, post.carouselImages!.length);
                          }}
                          style={{
                            position: 'absolute',
                            left: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '50%',
                            width: 28,
                            height: 28,
                            cursor: 'pointer',
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ‹
                        </button>
                      )}
                      {/* Next Button */}
                      {carouselIndex < post.carouselImages!.length - 1 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleNextCarousel(post.id, post.carouselImages!.length);
                          }}
                          style={{
                            position: 'absolute',
                            right: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '50%',
                            width: 28,
                            height: 28,
                            cursor: 'pointer',
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ›
                        </button>
                      )}
                      {/* Dots Bar */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 10,
                          left: 0,
                          right: 0,
                          display: 'flex',
                          justifyContent: 'center',
                          gap: 5,
                        }}
                      >
                        {post.carouselImages!.map((_, dotIdx) => (
                          <div
                            key={dotIdx}
                            style={{
                              width: carouselIndex === dotIdx ? 8 : 5,
                              height: 5,
                              borderRadius: 3,
                              backgroundColor: carouselIndex === dotIdx ? '#38bdf8' : 'rgba(255,255,255,0.4)',
                              transition: 'all 0.2s ease',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : post.mediaVideo ? (
                    <div style={{ width: '100%', height: 320, backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <video
                        src={post.mediaVideo}
                        controls
                        loop
                        muted
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                  ) : (
                    <div
                      onDoubleClick={e => handlePostDoubleTap(e, post.id)}
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

                      {/* Floating Double-Tap Heart Burst */}
                      {postHeartAnim && postHeartAnim.postId === post.id && (
                        <div
                          style={{
                            position: 'absolute',
                            left: postHeartAnim.x - 35,
                            top: postHeartAnim.y - 35,
                            fontSize: 70,
                            pointerEvents: 'none',
                            animation: 'heartBurst 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                            zIndex: 40,
                            filter: 'drop-shadow(0 4px 16px rgba(239, 68, 68, 0.8))',
                          }}
                        >
                          ❤️
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions Bar */}
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
                        onClick={() => {
                          try {
                            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([20]);
                          } catch {}
                          toggleLike(post.id);
                        }}
                        aria-label={post.isLiked ? 'Unlike' : 'Like'}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '1.25rem',
                          padding: 0,
                          color: post.isLiked ? '#ef4444' : '#fff',
                          transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                          transform: post.isLiked ? 'scale(1.15)' : 'scale(1)',
                        }}
                        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.85)')}
                        onMouseUp={e => (e.currentTarget.style.transform = post.isLiked ? 'scale(1.15)' : 'scale(1)')}
                        onTouchStart={e => (e.currentTarget.style.transform = 'scale(0.85)')}
                        onTouchEnd={e => (e.currentTarget.style.transform = post.isLiked ? 'scale(1.15)' : 'scale(1)')}
                      >
                        {post.isLiked ? '❤️' : '🤍'}
                      </button>
                      <button
                        onClick={() => openComments(post.id)}
                        aria-label="Comments"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '1.2rem',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          color: '#fff',
                        }}
                      >
                        <span>💬</span>
                        {typeof post.commentsCount === 'number' && post.commentsCount > 0 && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{post.commentsCount}</span>
                        )}
                      </button>
                      <button
                        onClick={() => handleRepost(post.id)}
                        aria-label="Repost"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '1.2rem',
                          padding: 0,
                          color: repostedPosts.has(post.id) ? '#10b981' : '#fff',
                        }}
                      >
                        🚀
                      </button>
                    </div>
                    <button
                      onClick={() => handleSavePost(post.id)}
                      aria-label="Bookmark"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1.2rem',
                        padding: 0,
                        color: bookmarkedPosts.has(post.id) ? '#f59e0b' : '#fff',
                      }}
                    >
                      {bookmarkedPosts.has(post.id) ? '🔖' : '🏷️'}
                    </button>
                  </div>

                  {/* Interactive Community Polls (Phase 1.3) */}
                  {post.poll && (
                    <div style={{ margin: '4px 16px 10px', padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📊</span>
                        <span>{post.poll.question}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {post.poll.options.map((opt, optIdx) => {
                          const hasVoted = post.poll!.userVotedIndex !== undefined || userPollVotes[post.id] !== undefined;
                          const userSelected = post.poll!.userVotedIndex === optIdx || userPollVotes[post.id] === optIdx;
                          const totalVotes = Math.max(1, post.poll!.totalVotes);
                          const pct = hasVoted ? Math.round((opt.votes / totalVotes) * 100) : 0;

                          return (
                            <button
                              key={optIdx}
                              onClick={() => handleVotePoll(post.id, optIdx)}
                              disabled={hasVoted}
                              style={{
                                position: 'relative',
                                overflow: 'hidden',
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: userSelected ? '1px solid #00a884' : '1px solid rgba(255,255,255,0.1)',
                                backgroundColor: hasVoted ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                textAlign: 'left',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: hasVoted ? 'default' : 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              {hasVoted && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: 0,
                                    width: `${pct}%`,
                                    backgroundColor: userSelected ? 'rgba(0, 168, 132, 0.3)' : 'rgba(56, 189, 248, 0.15)',
                                    transition: 'width 0.4s ease',
                                    zIndex: 0,
                                  }}
                                />
                              )}
                              <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {opt.text} {userSelected && <span style={{ color: '#00a884' }}>✓</span>}
                              </span>
                              {hasVoted && (
                                <span style={{ position: 'relative', zIndex: 1, fontWeight: 700, fontSize: 11, color: userSelected ? '#00a884' : '#94a3b8' }}>
                                  {pct}%
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: '#64748b' }}>
                        <span>{post.poll.totalVotes} {post.poll.totalVotes === 1 ? 'vote' : 'votes'}</span>
                        <span>Consensus poll • P2P verified</span>
                      </div>
                    </div>
                  )}

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
              );
            })}

        {/* Phase 1.1: Virtualized Infinite Scroll Load Trigger */}
        {!isLoading &&
          posts.filter(
            p =>
              !hiddenPostIds.has(p.id) &&
              !mutedAuthors.has(p.creatorHandle) &&
              !blockedPeers.has(p.creatorHandle)
          ).length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
              <button
                onClick={() => setVisibleCount(prev => prev + 6)}
                style={{
                  padding: '9px 20px',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: 20,
                  color: '#38bdf8',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Load More Sovereign Posts ⚡
              </button>
            </div>
          )}
      </section>

      {/* Feed Comments Bottom-Sheet Modal */}
      {activePostCommentsId && (
        <div
          role="dialog"
          aria-label="Post Comments"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 110,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setActivePostCommentsId(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#111827',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderTop: '1px solid rgba(255,255,255,0.1)',
              maxHeight: '75vh',
              minHeight: '40vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 25px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 18px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Comments</span>
                <span style={{ fontSize: 11, color: '#94a3b8', backgroundColor: '#1f2937', padding: '2px 8px', borderRadius: 10 }}>
                  {commentsList.length}
                </span>
              </div>
              <button
                onClick={() => setActivePostCommentsId(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Comments List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
              {isCommentsLoading ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
                  Loading peer comments...
                </div>
              ) : commentsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: '#64748b', fontSize: 13 }}>
                  No comments yet. Start the sovereign discussion!
                </div>
              ) : (
                commentsList.map(comment => (
                  <div
                    key={comment.id || Math.random().toString()}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        backgroundColor: '#1e293b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                      }}
                    >
                      {comment.authorAvatar || '⚡'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>
                          {comment.author || comment.userDid?.slice(0, 12) || 'Peer'}
                        </span>
                        <span style={{ fontSize: 10, color: '#64748b' }}>
                          {comment.createdAt ? new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2, wordBreak: 'break-word' }}>
                        {comment.text}
                      </div>
                    </div>
                    <button
                      onClick={() => handleLikeComment(comment.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: comment.isLiked ? '#ef4444' : '#64748b',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                    >
                      <span>{comment.isLiked ? '❤️' : '🤍'}</span>
                      {comment.likes ? <span style={{ fontSize: 9 }}>{comment.likes}</span> : null}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '12px 16px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: '#0f172a',
              }}
            >
              <input
                type="text"
                value={commentInputText}
                onChange={e => setCommentInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendComment();
                  }
                }}
                placeholder="Add a sovereign comment..."
                disabled={isSubmittingComment}
                style={{
                  flex: 1,
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 20,
                  color: '#fff',
                  padding: '8px 14px',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSendComment}
                disabled={isSubmittingComment || !commentInputText.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: isSubmittingComment || !commentInputText.trim() ? '#334155' : '#00a884',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isSubmittingComment || !commentInputText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmittingComment ? '...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Story Composer Modal */}
      <StoryComposerModal
        isOpen={isStoryComposerOpen}
        onClose={() => setIsStoryComposerOpen(false)}
        onStoryPublished={newStory => {
          setStories(prev => [newStory, ...prev]);
          showToast('✓ 24h Story broadcasted to peer swarm!');
        }}
      />

      {/* Explore & Search Modal */}
      <ExploreSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectPost={(postId) => {
          setIsSearchOpen(false);
          openComments(postId);
        }}
      />

      {/* Horizon Identity Switcher Sheet */}
      <IdentitySwitcherModal
        isOpen={isIdentitySwitcherOpen}
        activePersonaId={activePersona.id}
        onClose={() => setIsIdentitySwitcherOpen(false)}
        onSelectPersona={(p) => {
          setActivePersona(p);
          showToast(`Switched active persona to ${p.name}`);
        }}
        onAddPersona={() => showToast('Opening Channel / DAO Page Creator...')}
      />

      {/* Sovereign Checkout Bottom Sheet */}
      <SovereignCheckoutModal
        isOpen={isCheckoutOpen}
        item={checkoutItem}
        userBalanceSov={450.5}
        onClose={() => {
          setIsCheckoutOpen(false);
          setCheckoutItem(null);
        }}
        onSuccess={(receipt) => {
          showToast(`✓ Payment settled: ${receipt.amount} SOV`);
        }}
      />
    </div>
  );
}
