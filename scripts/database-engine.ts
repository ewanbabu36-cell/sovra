/**
 * Sovra Protocol - Core Database Architecture (Disk-Backed Schema)
 * File: scripts/database-engine.ts
 *
 * Implements an Atomic Persistent Database Engine stored at:
 * ./.sovra-storage-dev/dynamic-social-state.json
 *
 * Manages the 5 Core Collections:
 * 1. users: Unique DID, handle, name, avatar, bio, device, timestamps
 * 2. contacts_and_peers: Real-time peer directory for chat & mesh discovery
 * 3. chat_threads & messages: Two-way threads, delivered/read receipts, waveforms, disappearing timers
 * 4. posts: Compressed media, author details, real CIDs, likes array, nested comments
 * 5. friend_relationships: Bilateral handshake requests (fromDid, toDid, status, timestamps)
 */

import fs from 'node:fs';
import path from 'node:path';

// ==========================================
// 1. DATA MODELS & SCHEMAS
// ==========================================

export interface UserRecord {
  did: string;
  handle: string; // e.g. '@rahul_phone'
  displayName: string;
  avatar: string; // Avatar initial or emoji
  avatarDataUrl?: string; // Real uploaded photo Data URL / base64
  avatarBg: string; // Color swatch (e.g. '#6366f1')
  bio: string;
  deviceType: 'Mobile' | 'Desktop';
  publicKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactPeerRecord {
  did: string;
  handle: string;
  name: string;
  avatar: string;
  avatarDataUrl?: string;
  avatarBg: string;
  role: string;
  device: string;
  isOnline: boolean;
  lastSeen: string;
  lastSeenTimestamp: number;
  disappearingDurationSec: number;
  safetyNumbers: string;
  isVerified: boolean;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string; // [didA, didB].sort().join(':')
  senderDid: string;
  recipientDid: string;
  senderName: string;
  text: string;
  isAudio: boolean;
  audioDurationSec: number;
  waveformBars?: number[];
  timestamp: number;
  sentAt: number;
  deliveredAt?: number;
  readAt?: number;
  status: 'sent' | 'delivered' | 'read';
  signatureHex: string;
  disappearingDurationSec?: number;
  expiresAt?: number;
  isDisappeared?: boolean;
  reactions?: { emoji: string; senderDid: string }[];
  isBitChat?: boolean;
  hopCount?: number;
  route?: string[];
}

export interface PostCommentRecord {
  id: string;
  author: string;
  authorDid: string;
  authorAvatar?: string;
  text: string;
  timestamp: number;
}

export interface FeedPostRecord {
  id: string;
  authorDid: string;
  authorName: string;
  authorAvatar: string;
  authorAvatarBg: string;
  authorAvatarDataUrl?: string;
  audioTrack: string;
  mediaGradient: string;
  mediaEmoji: string;
  mediaTitle: string;
  mediaCid: string;
  likesCount: number;
  isLiked?: boolean;
  isSaved?: boolean;
  caption: string;
  tags: string;
  timestamp: number;
  comments: PostCommentRecord[];
  mediaImage?: string; // Compressed image DataURL (JPEG/WebP < 250KB)
  likedByDids: string[];
}

export interface FriendRelationshipRecord {
  id: string;
  fromDid: string;
  toDid: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  createdAt: number;
  updatedAt: number;
}

export interface ChannelRecord {
  id: string;
  handle: string;
  name: string;
  category: string;
  desc: string;
  count: number;
  avatar: string;
  bg: string;
  isSubbed: boolean;
  ownerDid?: string;
  createdAt: number;
}

export interface PageRecord {
  id: string;
  handle: string;
  name: string;
  category: string;
  bio: string;
  count: number;
  cta: string;
  ctaType: string;
  avatar: string;
  bg: string;
  isFollowing: boolean;
  ownerDid?: string;
  createdAt: number;
}

export interface DatabaseSchema {
  users: UserRecord[];
  contacts_and_peers: ContactPeerRecord[];
  chatMessages: ChatMessageRecord[];
  posts: FeedPostRecord[];
  channels: ChannelRecord[];
  pages: PageRecord[];
  friend_relationships: FriendRelationshipRecord[];
}

// ==========================================
// 2. ATOMIC DISK PERSISTENCE ENGINE
// ==========================================

const STORAGE_DIR = './.sovra-storage-dev';
const DATABASE_FILE_PATH = path.join(STORAGE_DIR, 'dynamic-social-state.json');
const DATABASE_TEMP_PATH = path.join(STORAGE_DIR, 'dynamic-social-state.json.tmp');

class SovraDatabaseEngine {
  private db: DatabaseSchema;
  private isLoaded = false;

  constructor() {
    this.db = this.initEmptySchema();
  }

  private initEmptySchema(): DatabaseSchema {
    return {
      users: [],
      contacts_and_peers: [],
      chatMessages: [],
      posts: [],
      channels: [
        { id: 'ch-alpha', handle: '@sovra_alpha', name: 'Sovra Alpha Radar', category: 'tech', desc: 'Cutting-edge P2P social dispatches', count: 14200, avatar: '📢', bg: '#0284c7', isSubbed: true, createdAt: Date.now() - 10000000 },
        { id: 'ch-gaming', handle: '@web3_gaming', name: 'Web3 Arcade Live', category: 'gaming', desc: 'Multiplayer P2P tournaments & game clips', count: 8900, avatar: '🎮', bg: '#8b5cf6', isSubbed: false, createdAt: Date.now() - 8000000 },
        { id: 'ch-news', handle: '@decentral_news', name: 'Global Mesh Dispatches', category: 'news', desc: 'Uncensored citizen dispatches over GossipSub', count: 24500, avatar: '📰', bg: '#10b981', isSubbed: false, createdAt: Date.now() - 6000000 },
        { id: 'ch-music', handle: '@ambient_radio', name: '24/7 Lo-Fi Mesh Waves', category: 'music', desc: 'Continuous stream seeded across 40 nodes', count: 6200, avatar: '🎵', bg: '#f43f5e', isSubbed: true, createdAt: Date.now() - 4000000 },
      ],
      pages: [
        { id: 'pg-metropolis', handle: '@metropolis_coffee', name: 'Metropolis Roastery', category: 'business', bio: 'Artisan cold brew with gigabit sovereign Wi-Fi', count: 3400, cta: 'Book Table', ctaType: 'book', avatar: '☕', bg: '#78350f', isFollowing: false, createdAt: Date.now() - 12000000 },
        { id: 'pg-meshlabs', handle: '@mesh_labs', name: 'Mesh Labs AI', category: 'brand', bio: 'Local edge LLMs and private search models', count: 12400, cta: 'Visit Website', ctaType: 'website', avatar: '⚡', bg: '#4f46e5', isFollowing: true, createdAt: Date.now() - 9000000 },
        { id: 'pg-bakery', handle: '@artisan_bakery', name: 'Sovereign Sourdough', category: 'business', bio: 'Fresh organic loaves delivered directly via P2P orders', count: 1850, cta: 'Send Message', ctaType: 'message', avatar: '🥖', bg: '#d97706', isFollowing: false, createdAt: Date.now() - 7000000 },
      ],
      friend_relationships: [],
    };
  }

  public load(): DatabaseSchema {
    if (this.isLoaded) return this.db;

    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
      }

      if (fs.existsSync(DATABASE_FILE_PATH)) {
        const raw = fs.readFileSync(DATABASE_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);

        this.db = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          contacts_and_peers: Array.isArray(parsed.contacts_and_peers) ? parsed.contacts_and_peers : [],
          chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
          posts: Array.isArray(parsed.posts) ? parsed.posts : [],
          channels: Array.isArray(parsed.channels) ? parsed.channels : this.db.channels,
          pages: Array.isArray(parsed.pages) ? parsed.pages : this.db.pages,
          friend_relationships: Array.isArray(parsed.friend_relationships) ? parsed.friend_relationships : [],
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[SovraDB] Failed to load database, recovering defaults:', err);
      this.db = this.initEmptySchema();
      this.save();
    }

    this.isLoaded = true;
    return this.db;
  }

  public save(): void {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
      }
      const data = JSON.stringify(this.db, null, 2);
      // Atomic write using temp file and rename
      fs.writeFileSync(DATABASE_TEMP_PATH, data, 'utf-8');
      fs.renameSync(DATABASE_TEMP_PATH, DATABASE_FILE_PATH);
    } catch (err) {
      console.error('[SovraDB] Atomic write failed:', err);
    }
  }

  public getState(): DatabaseSchema {
    if (!this.isLoaded) this.load();
    return this.db;
  }

  // ==========================================
  // COLLECTION 1: USERS
  // ==========================================

  public findUserByDid(did: string): UserRecord | undefined {
    this.load();
    return this.db.users.find(u => u.did === did);
  }

  public findUserByHandle(handle: string): UserRecord | undefined {
    this.load();
    const cleanHandle = handle.startsWith('@') ? handle.toLowerCase() : '@' + handle.toLowerCase();
    return this.db.users.find(u => u.handle.toLowerCase() === cleanHandle);
  }

  public upsertUser(user: Partial<UserRecord> & { did: string; handle: string; displayName: string }): UserRecord {
    this.load();
    let cleanHandle = user.handle.trim();
    if (!cleanHandle.startsWith('@')) cleanHandle = '@' + cleanHandle;

    const existingIdx = this.db.users.findIndex(u => u.did === user.did);
    const now = Date.now();

    const record: UserRecord = {
      did: user.did,
      handle: cleanHandle,
      displayName: user.displayName.trim() || 'Sovereign Peer',
      avatar: user.avatar || user.displayName.trim().charAt(0).toUpperCase() || 'S',
      avatarDataUrl: user.avatarDataUrl,
      avatarBg: user.avatarBg || '#6366f1',
      bio: user.bio || '',
      deviceType: user.deviceType || 'Desktop',
      publicKey: user.publicKey,
      createdAt: existingIdx >= 0 ? this.db.users[existingIdx]!.createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      this.db.users[existingIdx] = record;
    } else {
      this.db.users.push(record);
    }

    // Also mirror to contacts_and_peers directory automatically
    this.upsertPeer({
      did: record.did,
      handle: record.handle,
      name: record.displayName,
      avatar: record.avatar,
      avatarDataUrl: record.avatarDataUrl,
      avatarBg: record.avatarBg,
      role: `${record.deviceType} Peer (Mesh Direct)`,
      device: record.deviceType,
      isOnline: true,
      lastSeen: 'Online',
      lastSeenTimestamp: now,
      disappearingDurationSec: 0,
      safetyNumbers: '28471 90432 18942 ' + record.did.slice(-12),
      isVerified: true,
    });

    this.save();
    return record;
  }

  public getAllUsers(): UserRecord[] {
    this.load();
    return [...this.db.users];
  }

  // ==========================================
  // COLLECTION 2: CONTACTS & PEERS DIRECTORY
  // ==========================================

  public upsertPeer(peer: ContactPeerRecord): void {
    this.load();
    const idx = this.db.contacts_and_peers.findIndex(p => p.did === peer.did);
    if (idx >= 0) {
      this.db.contacts_and_peers[idx] = { ...this.db.contacts_and_peers[idx], ...peer };
    } else {
      this.db.contacts_and_peers.push(peer);
    }
    this.save();
  }

  public getAllPeers(excludeDid?: string): ContactPeerRecord[] {
    this.load();
    if (!excludeDid) return [...this.db.contacts_and_peers];
    return this.db.contacts_and_peers.filter(p => p.did !== excludeDid);
  }

  public setPeerOnlineStatus(did: string, isOnline: boolean): void {
    this.load();
    const peer = this.db.contacts_and_peers.find(p => p.did === did);
    if (peer) {
      peer.isOnline = isOnline;
      peer.lastSeen = isOnline ? 'Online' : 'Just now';
      peer.lastSeenTimestamp = Date.now();
      this.save();
    }
  }

  // ==========================================
  // COLLECTION 3: CHAT THREADS & MESSAGES
  // ==========================================

  public getThreadId(didA: string, didB: string): string {
    return [didA, didB].sort().join(':');
  }

  public appendMessage(msg: Partial<ChatMessageRecord> & { senderDid: string; recipientDid: string; text: string }): ChatMessageRecord {
    this.load();
    const now = Date.now();
    const threadId = msg.recipientDid.startsWith('channel:')
      ? msg.recipientDid
      : this.getThreadId(msg.senderDid, msg.recipientDid);

    const record: ChatMessageRecord = {
      id: msg.id || 'msg-' + now + '-' + Math.random().toString(36).substring(2, 6),
      threadId,
      senderDid: msg.senderDid,
      recipientDid: msg.recipientDid,
      senderName: msg.senderName || 'Peer',
      text: msg.text,
      isAudio: Boolean(msg.isAudio),
      audioDurationSec: msg.audioDurationSec || 0,
      waveformBars: msg.waveformBars,
      timestamp: msg.timestamp || now,
      sentAt: msg.sentAt || now,
      status: msg.status || 'sent',
      signatureHex: msg.signatureHex || 'ed25519_sig_' + Math.random().toString(36).substring(2, 8),
      disappearingDurationSec: msg.disappearingDurationSec || 0,
      expiresAt: msg.expiresAt,
      isDisappeared: false,
      reactions: msg.reactions || [],
      isBitChat: Boolean(msg.isBitChat),
      hopCount: msg.hopCount || 1,
      route: msg.route || [msg.senderDid, msg.recipientDid],
    };

    if (record.disappearingDurationSec && record.disappearingDurationSec > 0 && !record.expiresAt) {
      record.expiresAt = now + (record.disappearingDurationSec * 1000);
    }

    this.db.chatMessages.push(record);
    this.save();
    return record;
  }

  public getMessagesForUser(userDid: string, since = 0): ChatMessageRecord[] {
    this.load();
    const now = Date.now();
    return this.db.chatMessages.filter(m => {
      if (since > 0 && m.timestamp <= since) return false;
      // Expire disappearing messages
      if (m.expiresAt && m.expiresAt < now) {
        m.isDisappeared = true;
      }
      return m.recipientDid.startsWith('channel:') || m.senderDid === userDid || m.recipientDid === userDid;
    });
  }

  public getThreadMessages(didA: string, didB: string, since = 0): ChatMessageRecord[] {
    this.load();
    const targetThreadId = didB.startsWith('channel:') ? didB : this.getThreadId(didA, didB);
    const now = Date.now();

    return this.db.chatMessages.filter(m => {
      if (m.threadId !== targetThreadId) return false;
      if (since > 0 && m.timestamp <= since) return false;
      if (m.expiresAt && m.expiresAt < now) {
        m.isDisappeared = true;
      }
      return true;
    });
  }

  public updateMessageReceipt(messageId: string, status: 'delivered' | 'read', timestamp = Date.now()): boolean {
    this.load();
    const msg = this.db.chatMessages.find(m => m.id === messageId);
    if (!msg) return false;

    if (status === 'delivered') {
      msg.status = 'delivered';
      msg.deliveredAt = timestamp;
    } else if (status === 'read') {
      msg.status = 'read';
      msg.readAt = timestamp;
      if (msg.disappearingDurationSec && msg.disappearingDurationSec > 0 && !msg.expiresAt) {
        msg.expiresAt = timestamp + (msg.disappearingDurationSec * 1000);
      }
    }

    this.save();
    return true;
  }

  // ==========================================
  // COLLECTION 4: POSTS & COMMENTS
  // ==========================================

  public createPost(post: Omit<FeedPostRecord, 'id' | 'timestamp' | 'likesCount' | 'likedByDids' | 'comments'>): FeedPostRecord {
    this.load();
    const now = Date.now();
    const record: FeedPostRecord = {
      ...post,
      id: 'feed-' + now,
      timestamp: now,
      likesCount: 0,
      likedByDids: [],
      comments: [],
      isLiked: false,
      isSaved: false,
    };

    this.db.posts.unshift(record);
    this.save();
    return record;
  }

  public getAllPosts(): FeedPostRecord[] {
    this.load();
    return [...this.db.posts];
  }

  public toggleLike(postId: string, userDid: string): { likesCount: number; isLiked: boolean } | null {
    this.load();
    const post = this.db.posts.find(p => p.id === postId);
    if (!post) return null;

    if (!Array.isArray(post.likedByDids)) post.likedByDids = [];

    const idx = post.likedByDids.indexOf(userDid);
    if (idx >= 0) {
      post.likedByDids.splice(idx, 1);
    } else {
      post.likedByDids.push(userDid);
    }

    post.likesCount = post.likedByDids.length;
    post.isLiked = post.likedByDids.includes(userDid);
    this.save();

    return { likesCount: post.likesCount, isLiked: post.isLiked };
  }

  public addComment(postId: string, comment: { author: string; authorDid: string; text: string; authorAvatar?: string }): PostCommentRecord | null {
    this.load();
    const post = this.db.posts.find(p => p.id === postId);
    if (!post) return null;

    if (!Array.isArray(post.comments)) post.comments = [];

    const record: PostCommentRecord = {
      id: 'cmt-' + Date.now(),
      author: comment.author,
      authorDid: comment.authorDid,
      authorAvatar: comment.authorAvatar || comment.author.charAt(0).toUpperCase(),
      text: comment.text.trim(),
      timestamp: Date.now(),
    };

    post.comments.push(record);
    this.save();
    return record;
  }

  // ==========================================
  // COLLECTION 5: FRIEND RELATIONSHIPS
  // ==========================================

  public sendFriendRequest(fromDid: string, toDid: string): FriendRelationshipRecord {
    this.load();
    const existing = this.db.friend_relationships.find(
      r => (r.fromDid === fromDid && r.toDid === toDid) || (r.fromDid === toDid && r.toDid === fromDid)
    );

    const now = Date.now();
    if (existing) {
      existing.status = 'pending';
      existing.fromDid = fromDid;
      existing.toDid = toDid;
      existing.updatedAt = now;
      this.save();
      return existing;
    }

    const newReq: FriendRelationshipRecord = {
      id: 'freq-' + now,
      fromDid,
      toDid,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.db.friend_relationships.push(newReq);
    this.save();
    return newReq;
  }

  public respondFriendRequest(fromDid: string, toDid: string, status: 'accepted' | 'rejected' | 'blocked'): FriendRelationshipRecord | null {
    this.load();
    const rel = this.db.friend_relationships.find(
      r => (r.fromDid === fromDid && r.toDid === toDid) || (r.fromDid === toDid && r.toDid === fromDid)
    );

    if (!rel) return null;
    rel.status = status;
    rel.updatedAt = Date.now();
    this.save();
    return rel;
  }

  public getFriendRelationships(userDid: string): FriendRelationshipRecord[] {
    this.load();
    return this.db.friend_relationships.filter(r => r.fromDid === userDid || r.toDid === userDid);
  }
}

// Singleton database instance exported for application-wide use
export const sovraDb = new SovraDatabaseEngine();
