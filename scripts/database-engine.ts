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
  sessionToken?: string;
  balanceSov?: number; // Sovereign wallet balance in SOV (default: 500.00)
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

export interface ReelRecord {
  id: string;
  creatorDid: string;
  creatorHandle: string;
  creatorName: string;
  creatorAvatar?: string;
  caption: string;
  tags: string[];
  audioTrack: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  bgGradient: string;
  cid: string;
  isLiked?: boolean;
  isSaved?: boolean;
  viewsDisplay?: string;
  videoUrl?: string;
  videoPath?: string;
  videoMimeType?: string;
  likedByDids: string[];
  createdAt: number;
}

export interface ReelCommentRecord {
  id: string;
  reelId: string;
  authorDid: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  timestamp: number;
  timeAgo: string;
  likes: number;
}

export interface YoutubeReplyRecord {
  id: string;
  commentId: string;
  authorDid?: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  text: string;
  timestamp: number;
  likes: number;
  isCreator?: boolean;
}

export interface YoutubeCommentRecord {
  id: string;
  videoId: string;
  authorDid?: string;
  authorName: string;
  authorAvatar: string;
  authorHandle: string;
  text: string;
  timestamp: number;
  likes: number;
  isPinned?: boolean;
  isCreator?: boolean;
  creatorHeart?: boolean;
  isSuperThanks?: boolean;
  superThanksAmount?: string;
  replies: YoutubeReplyRecord[];
}

export interface TipVoucherRecord {
  voucherId: string;
  videoId: string;
  senderDid?: string;
  senderName: string;
  senderComment?: string;
  creatorDid: string;
  seederDid: string;
  totalAmount: string;
  creatorAmount: string;
  seederAmount: string;
  platformAmount: string;
  timestamp: number;
  signatureHex?: string;
}

export interface AuditLogRecord {
  id: string;
  type: 'USER_REGISTERED' | 'PROFILE_UPDATED' | 'POST_CREATED' | 'CHAT_SENT' | 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' | 'TIP_VOUCHER' | 'REEL_UPLOADED' | 'COMMENT_POSTED';
  action?: string;
  actorDid: string;
  actorHandle: string;
  details: string;
  timestamp: number;
}

export interface DatabaseSchema {
  users: UserRecord[];
  contacts_and_peers: ContactPeerRecord[];
  chatMessages: ChatMessageRecord[];
  posts: FeedPostRecord[];
  channels: ChannelRecord[];
  pages: PageRecord[];
  friend_relationships: FriendRelationshipRecord[];
  reels: ReelRecord[];
  reel_comments: ReelCommentRecord[];
  video_comments: Record<string, YoutubeCommentRecord[]>;
  tip_vouchers: TipVoucherRecord[];
  audit_logs: AuditLogRecord[];
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
      reels: this.getSeedReels(),
      reel_comments: [],
      video_comments: this.getSeedVideoComments(),
      tip_vouchers: [],
      audit_logs: this.getSeedAuditLogs(),
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
          users: Array.isArray(parsed.users)
            ? parsed.users.map((u: any) => ({
                ...u,
                balanceSov: typeof u.balanceSov === 'number' ? u.balanceSov : 500.0,
              }))
            : [],
          contacts_and_peers: Array.isArray(parsed.contacts_and_peers) ? parsed.contacts_and_peers : [],
          chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
          posts: Array.isArray(parsed.posts) ? parsed.posts : [],
          channels: Array.isArray(parsed.channels) ? parsed.channels : this.db.channels,
          pages: Array.isArray(parsed.pages) ? parsed.pages : this.db.pages,
          friend_relationships: Array.isArray(parsed.friend_relationships) ? parsed.friend_relationships : [],
          reels: Array.isArray(parsed.reels) && parsed.reels.length > 0 ? parsed.reels : this.getSeedReels(),
          reel_comments: Array.isArray(parsed.reel_comments) ? parsed.reel_comments : [],
          video_comments: parsed.video_comments && typeof parsed.video_comments === 'object' ? parsed.video_comments : this.getSeedVideoComments(),
          tip_vouchers: Array.isArray(parsed.tip_vouchers) ? parsed.tip_vouchers : [],
          audit_logs: Array.isArray(parsed.audit_logs) && parsed.audit_logs.length > 0 ? parsed.audit_logs : this.getSeedAuditLogs(),
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

  public findUserBySessionToken(token: string): UserRecord | undefined {
    this.load();
    if (!token) return undefined;
    return this.db.users.find(u => u.sessionToken === token);
  }

  public isHandleTaken(handle: string, excludeDid?: string): boolean {
    this.load();
    let cleanHandle = handle.trim().toLowerCase();
    if (!cleanHandle.startsWith('@')) cleanHandle = '@' + cleanHandle;
    return this.db.users.some(u => u.handle.toLowerCase() === cleanHandle && u.did !== excludeDid);
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
      sessionToken: user.sessionToken || (existingIdx >= 0 ? this.db.users[existingIdx]!.sessionToken : 'stk_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36)),
      balanceSov: typeof user.balanceSov === 'number' ? user.balanceSov : (existingIdx >= 0 && typeof this.db.users[existingIdx]!.balanceSov === 'number' ? this.db.users[existingIdx]!.balanceSov : 500.0),
      createdAt: existingIdx >= 0 ? this.db.users[existingIdx]!.createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      this.db.users[existingIdx] = record;
      this.logActivity('PROFILE_UPDATED', record.did, record.handle, `Updated sovereign profile (${record.displayName}) on ${record.deviceType}`);
    } else {
      this.db.users.push(record);
      this.logActivity('USER_REGISTERED', record.did, record.handle, `New sovereign user registered (${record.displayName}) on ${record.deviceType}`);
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

  public updateUserAvatar(did: string, avatarDataUrl: string): UserRecord | undefined {
    this.load();
    const user = this.db.users.find(u => u.did === did);
    if (!user) return undefined;
    user.avatarDataUrl = avatarDataUrl;
    user.updatedAt = Date.now();

    // Mirror to contacts_and_peers directory
    const peer = this.db.contacts_and_peers.find(p => p.did === did);
    if (peer) {
      peer.avatarDataUrl = avatarDataUrl;
    }

    this.logActivity('PROFILE_UPDATED', user.did, user.handle, `Updated profile photo for ${user.displayName}`);
    this.save();
    return user;
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
    this.logActivity(
      'CHAT_SENT',
      record.senderDid,
      record.senderName,
      `Sent ${record.isAudio ? 'voice note' : 'message'} (${record.text.substring(0, 32)}...) in thread ${record.threadId}`,
    );
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

  public updateMessagesReceipt(messageIds: string[], status: 'delivered' | 'read', timestamp = Date.now()): number {
    this.load();
    let updatedCount = 0;
    for (const messageId of messageIds) {
      const msg = this.db.chatMessages.find(m => m.id === messageId);
      if (!msg) continue;

      if (status === 'delivered') {
        if (msg.status !== 'read') {
          msg.status = 'delivered';
          msg.deliveredAt = timestamp;
          updatedCount++;
        }
      } else if (status === 'read') {
        msg.status = 'read';
        msg.readAt = timestamp;
        if (!msg.deliveredAt) msg.deliveredAt = timestamp;
        if (msg.disappearingDurationSec && msg.disappearingDurationSec > 0 && !msg.expiresAt) {
          msg.expiresAt = timestamp + (msg.disappearingDurationSec * 1000);
        }
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.save();
    }
    return updatedCount;
  }

  public updateMessageReceipt(messageId: string, status: 'delivered' | 'read', timestamp = Date.now()): boolean {
    return this.updateMessagesReceipt([messageId], status, timestamp) > 0;
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
    this.logActivity(
      'POST_CREATED',
      record.authorDid,
      record.authorName,
      `Published post: "${(record.caption || '').substring(0, 36)}..." (CID: ${(record.mediaCid || '').substring(0, 16)}...)`,
    );
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
    this.logActivity('FRIEND_REQUEST', fromDid, fromDid.slice(-8), `Sent friend handshake request to ${toDid.slice(-8)}`);
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
    if (status === 'accepted') {
      this.logActivity('FRIEND_ACCEPTED', toDid, toDid.slice(-8), `Accepted friend handshake from ${fromDid.slice(-8)}`);
    }
    this.save();
    return rel;
  }

  public respondFriendRequestById(requestId: string, status: 'accepted' | 'rejected' | 'blocked'): FriendRelationshipRecord | null {
    this.load();
    const rel = this.db.friend_relationships.find(r => r.id === requestId);
    if (!rel) return null;
    rel.status = status;
    rel.updatedAt = Date.now();
    if (status === 'accepted') {
      this.logActivity('FRIEND_ACCEPTED', rel.toDid, rel.toDid.slice(-8), `Accepted friend handshake from ${rel.fromDid.slice(-8)}`);
    }
    this.save();
    return rel;
  }

  public removeFriendship(userDidA: string, userDidB: string): boolean {
    this.load();
    const idx = this.db.friend_relationships.findIndex(
      r => (r.fromDid === userDidA && r.toDid === userDidB) || (r.fromDid === userDidB && r.toDid === userDidA)
    );
    if (idx >= 0) {
      this.db.friend_relationships.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  public getFriendRelationships(userDid: string): FriendRelationshipRecord[] {
    this.load();
    return this.db.friend_relationships.filter(r => r.fromDid === userDid || r.toDid === userDid);
  }

  // ==========================================
  // COLLECTION 6: REELS & REEL COMMENTS
  // ==========================================

  public getAllReels(): ReelRecord[] {
    this.load();
    if (!Array.isArray(this.db.reels) || this.db.reels.length === 0) {
      this.db.reels = this.getSeedReels();
      this.save();
    }
    return [...this.db.reels];
  }

  public createReel(data: {
    creatorDid: string;
    creatorHandle: string;
    creatorName: string;
    creatorAvatar?: string;
    caption: string;
    tags?: string[];
    audioTrack?: string;
    bgGradient?: string;
    cid: string;
    videoUrl?: string;
    videoPath?: string;
    videoMimeType?: string;
  }): ReelRecord {
    this.load();
    if (!Array.isArray(this.db.reels)) this.db.reels = [];

    const id = 'reel-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const newReel: ReelRecord = {
      id,
      creatorDid: data.creatorDid,
      creatorHandle: data.creatorHandle.replace('@', ''),
      creatorName: data.creatorName,
      creatorAvatar: data.creatorAvatar,
      caption: data.caption.trim(),
      tags: Array.isArray(data.tags) ? data.tags : ['#sovra', '#p2p', '#reels'],
      audioTrack: data.audioTrack || 'Original Audio - ' + data.creatorHandle,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      bgGradient: data.bgGradient || 'linear-gradient(180deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)',
      cid: data.cid,
      viewsDisplay: '1',
      videoUrl: data.videoUrl,
      videoPath: data.videoPath,
      videoMimeType: data.videoMimeType || 'video/mp4',
      likedByDids: [],
      createdAt: Date.now(),
    };

    this.db.reels.unshift(newReel);
    this.logActivity('REEL_UPLOADED', newReel.creatorDid, newReel.creatorHandle, `Uploaded 9:16 vertical reel: "${(newReel.caption || '').substring(0, 36)}..." (CID: ${newReel.cid.substring(0, 16)}...)`);
    this.save();
    return newReel;
  }

  public toggleReelLike(reelId: string, userDid: string): { likesCount: number; isLiked: boolean } | null {
    this.load();
    const reel = this.db.reels.find(r => r.id === reelId);
    if (!reel) return null;

    if (!Array.isArray(reel.likedByDids)) reel.likedByDids = [];
    const idx = reel.likedByDids.indexOf(userDid);
    if (idx >= 0) {
      reel.likedByDids.splice(idx, 1);
    } else {
      reel.likedByDids.push(userDid);
    }
    reel.likesCount = reel.likedByDids.length;
    reel.isLiked = reel.likedByDids.includes(userDid);
    this.save();
    return { likesCount: reel.likesCount, isLiked: reel.isLiked };
  }

  public addReelComment(
    reelId: string,
    comment: {
      authorDid: string;
      authorHandle: string;
      authorName: string;
      authorAvatar?: string;
      text: string;
    },
  ): ReelCommentRecord | null {
    this.load();
    const reel = this.db.reels.find(r => r.id === reelId);
    if (!reel) return null;

    if (!Array.isArray(this.db.reel_comments)) this.db.reel_comments = [];

    const record: ReelCommentRecord = {
      id: 'rc-' + Date.now(),
      reelId,
      authorDid: comment.authorDid,
      authorHandle: comment.authorHandle.replace('@', ''),
      authorName: comment.authorName,
      authorAvatar: comment.authorAvatar || comment.authorName.charAt(0).toUpperCase(),
      text: comment.text.trim(),
      timestamp: Date.now(),
      timeAgo: 'Just now',
      likes: 0,
    };

    this.db.reel_comments.unshift(record);
    reel.commentsCount = (reel.commentsCount || 0) + 1;
    this.save();
    return record;
  }

  public getReelComments(reelId: string): ReelCommentRecord[] {
    this.load();
    if (!Array.isArray(this.db.reel_comments)) return [];
    return this.db.reel_comments.filter(c => c.reelId === reelId);
  }

  // ==========================================
  // COLLECTION 7: VIDEO COMMENTS & REPLIES (WATCH STUDIO)
  // ==========================================

  public getVideoComments(videoId: string): YoutubeCommentRecord[] {
    this.load();
    if (!this.db.video_comments) this.db.video_comments = {};
    if (!this.db.video_comments[videoId]) {
      if (videoId === 'yt-video-1') {
        this.db.video_comments[videoId] = this.getSeedVideoComments()['yt-video-1'] || [];
        this.save();
      } else {
        this.db.video_comments[videoId] = [];
      }
    }
    return this.db.video_comments[videoId] || [];
  }

  public addVideoComment(videoId: string, comment: Partial<YoutubeCommentRecord>): YoutubeCommentRecord {
    this.load();
    if (!this.db.video_comments) this.db.video_comments = {};
    if (!this.db.video_comments[videoId]) this.db.video_comments[videoId] = [];

    const record: YoutubeCommentRecord = {
      id: comment.id || 'yt-c-' + Date.now(),
      videoId,
      authorDid: comment.authorDid,
      authorName: comment.authorName || 'Verified Peer',
      authorAvatar: comment.authorAvatar || (comment.authorName ? comment.authorName[0].toUpperCase() : 'V'),
      authorHandle: comment.authorHandle || 'peer_' + Math.floor(Math.random() * 900 + 100),
      text: String(comment.text || '').trim(),
      timestamp: comment.timestamp || Date.now(),
      likes: comment.likes || 0,
      isPinned: Boolean(comment.isPinned),
      isCreator: Boolean(comment.isCreator),
      creatorHeart: Boolean(comment.creatorHeart),
      isSuperThanks: Boolean(comment.isSuperThanks),
      superThanksAmount: comment.superThanksAmount,
      replies: Array.isArray(comment.replies) ? comment.replies : [],
    };

    this.db.video_comments[videoId].unshift(record);
    this.save();
    return record;
  }

  public addVideoReply(videoId: string, parentCommentId: string, reply: Partial<YoutubeReplyRecord>): YoutubeReplyRecord | null {
    this.load();
    const comments = this.getVideoComments(videoId);
    const parent = comments.find(c => c.id === parentCommentId);
    if (!parent) return null;

    if (!Array.isArray(parent.replies)) parent.replies = [];

    const record: YoutubeReplyRecord = {
      id: reply.id || 'yt-r-' + Date.now(),
      commentId: parentCommentId,
      authorDid: reply.authorDid,
      authorName: reply.authorName || 'Verified Peer',
      authorAvatar: reply.authorAvatar || (reply.authorName ? reply.authorName[0].toUpperCase() : 'V'),
      authorHandle: reply.authorHandle || 'peer',
      text: String(reply.text || '').trim(),
      timestamp: reply.timestamp || Date.now(),
      likes: reply.likes || 0,
      isCreator: Boolean(reply.isCreator),
    };

    parent.replies.push(record);
    this.save();
    return record;
  }

  public likeVideoComment(videoId: string, commentId: string): number {
    this.load();
    const comments = this.getVideoComments(videoId);
    const comment = comments.find(c => c.id === commentId);
    if (comment) {
      comment.likes = (comment.likes || 0) + 1;
      this.save();
      return comment.likes;
    }
    for (const c of comments) {
      if (Array.isArray(c.replies)) {
        const reply = c.replies.find(r => r.id === commentId);
        if (reply) {
          reply.likes = (reply.likes || 0) + 1;
          this.save();
          return reply.likes;
        }
      }
    }
    return 0;
  }

  // ==========================================
  // COLLECTION 8: WALLET BALANCE LEDGER & TIPPING VOUCHERS
  // ==========================================

  public getUserBalance(userDid: string): number {
    this.load();
    const user = this.db.users.find(u => u.did === userDid);
    if (user) {
      if (typeof user.balanceSov !== 'number') {
        user.balanceSov = 500.0;
        this.save();
      }
      return user.balanceSov;
    }
    return 500.0;
  }

  public setUserBalance(userDid: string, balance: number): number {
    this.load();
    const user = this.db.users.find(u => u.did === userDid);
    if (user) {
      user.balanceSov = Math.max(0, Math.round(balance * 100) / 100);
      this.save();
      return user.balanceSov;
    }
    return balance;
  }

  public processTip(params: {
    fromDid?: string;
    toDid?: string;
    amount: number;
    videoId: string;
    senderName?: string;
    message?: string;
  }): {
    ok: boolean;
    senderBalance: number;
    voucher: TipVoucherRecord;
    split: { total: number; creator: number; seeder: number; platformTake: number };
    error?: string;
  } {
    this.load();
    const amount = Number(params.amount);
    if (isNaN(amount) || amount <= 0) {
      return {
        ok: false,
        senderBalance: 0,
        voucher: {} as any,
        split: { total: 0, creator: 0, seeder: 0, platformTake: 0 },
        error: 'Invalid tip amount',
      };
    }

    let sender = params.fromDid ? this.db.users.find(u => u.did === params.fromDid) : undefined;
    if (!sender && this.db.users.length > 0) {
      sender = this.db.users[0];
    }
    if (sender && typeof sender.balanceSov !== 'number') {
      sender.balanceSov = 500.0;
    }

    const currentBalance = sender ? sender.balanceSov! : 500.0;
    if (currentBalance < amount) {
      return {
        ok: false,
        senderBalance: currentBalance,
        voucher: {} as any,
        split: { total: amount, creator: 0, seeder: 0, platformTake: 0 },
        error: `Insufficient SOV balance (Balance: ${currentBalance.toFixed(2)} SOV, Required: ${amount.toFixed(2)} SOV)`,
      };
    }

    const newBalance = Math.round((currentBalance - amount) * 100) / 100;
    if (sender) {
      sender.balanceSov = newBalance;
    }

    const creatorSplit = Math.round(amount * 0.95 * 100) / 100;
    const seederSplit = Math.round(amount * 0.05 * 100) / 100;

    if (params.toDid) {
      const recipient = this.db.users.find(u => u.did === params.toDid);
      if (recipient) {
        const recBal = typeof recipient.balanceSov === 'number' ? recipient.balanceSov : 500.0;
        recipient.balanceSov = Math.round((recBal + creatorSplit) * 100) / 100;
      }
    }

    const voucher: TipVoucherRecord = {
      voucherId: 'vouch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      videoId: params.videoId || 'yt-video-1',
      senderDid: sender ? sender.did : params.fromDid,
      senderName: params.senderName || (sender ? sender.displayName : 'Verified Peer'),
      senderComment: params.message,
      creatorDid: params.toDid || 'did:sovra:creator_studio_broadcast',
      seederDid: 'did:sovra:edge_seeder_relay',
      totalAmount: amount.toString(),
      creatorAmount: creatorSplit.toString(),
      seederAmount: seederSplit.toString(),
      platformAmount: '0',
      timestamp: Date.now(),
      signatureHex: 'ed25519:sig:' + Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10),
    };

    if (!Array.isArray(this.db.tip_vouchers)) {
      this.db.tip_vouchers = [];
    }
    this.db.tip_vouchers.push(voucher);

    if (params.message) {
      this.addVideoComment(params.videoId || 'yt-video-1', {
        authorName: params.senderName || (sender ? sender.displayName : 'Super Supporter'),
        authorHandle: sender ? sender.handle.replace('@', '') : 'supporter',
        authorAvatar: sender ? sender.avatar : '⭐',
        text: params.message,
        isSuperThanks: true,
        superThanksAmount: '₹' + amount + ' (' + amount + ' SOV)',
        likes: 1,
      });
    }

    this.logActivity(
      'TIP_VOUCHER',
      voucher.senderDid || 'supporter',
      voucher.senderName,
      `Signed off-chain voucher: ₹${amount} (${amount} SOV) - ${creatorSplit} SOV to creator, ${seederSplit} SOV to seeders`,
    );
    this.save();

    return {
      ok: true,
      senderBalance: newBalance,
      voucher,
      split: {
        total: amount,
        creator: creatorSplit,
        seeder: seederSplit,
        platformTake: 0,
      },
    };
  }

  // ==========================================
  // SEED CONTENT HELPERS
  // ==========================================

  private getSeedReels(): ReelRecord[] {
    return [
      {
        id: 'reel-1',
        creatorDid: 'did:key:z6MksAliceCreatorP2P',
        creatorHandle: 'alice_creator',
        creatorName: 'Alice ⚡ P2P Architect',
        caption: 'Zero central servers! Streaming raw UnixFS blocks over pure UDP QUIC. ⚡ 60fps gesture physics & instant pre-warm.',
        tags: ['#sovra', '#p2p', '#reels', '#privacy', '#zeroalgorithms'],
        audioTrack: 'Original Audio - alice_creator',
        likesCount: 2489,
        commentsCount: 142,
        sharesCount: 68,
        bgGradient: 'linear-gradient(180deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)',
        cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        viewsDisplay: '2.4M',
        likedByDids: [],
        createdAt: Date.now() - 50000000,
      },
      {
        id: 'reel-2',
        creatorDid: 'did:key:z6MksBobBroadcaster',
        creatorHandle: 'bob_live',
        creatorName: 'Bob | 5G Telecom',
        caption: 'Testing ICE 4-tier hole punching on 5G carrier CGNAT. Sub-300ms video startup! 🔥 No relay bandwidth choked.',
        tags: ['#telecom', '#5g', '#cgnat', '#web3'],
        audioTrack: 'P2P Pulse Beats - Sound Collective',
        likesCount: 1845,
        commentsCount: 97,
        sharesCount: 43,
        bgGradient: 'linear-gradient(180deg, #3b0764 0%, #1e1b4b 50%, #030712 100%)',
        cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r6',
        viewsDisplay: '1.8M',
        likedByDids: [],
        createdAt: Date.now() - 40000000,
      },
      {
        id: 'reel-3',
        creatorDid: 'did:key:z6MksCarolMusician',
        creatorHandle: 'carol_sounds',
        creatorName: 'Carol 🎧 Sound Designer',
        caption: 'Spatial multi-track audio session mixed locally on-device. No lossy compression! 🎧 Stems synced over BitSwap.',
        tags: ['#spatialaudio', '#lossless', '#creator', '#hifi'],
        audioTrack: 'Midnight Echoes (Spatial Mix) - Carol',
        likesCount: 3912,
        commentsCount: 231,
        sharesCount: 154,
        bgGradient: 'linear-gradient(180deg, #064e3b 0%, #0f172a 60%, #022c22 100%)',
        cid: 'bafybeig7r6z5g3k7r4o6z5m4r6koviema7g3gxyt6la7vd5ho32wuq5z2m',
        viewsDisplay: '3.9M',
        likedByDids: [],
        createdAt: Date.now() - 30000000,
      },
      {
        id: 'reel-4',
        creatorDid: 'did:key:z6MksAliceCreatorP2P',
        creatorHandle: 'alice_creator',
        creatorName: 'Alice ⚡ P2P Architect',
        caption: 'Noise_XX mutual authentication handshake in 1-RTT. Ephemeral keys rotated after every session. 🔒',
        tags: ['#cryptography', '#noiseprotocol', '#security', '#ed25519'],
        audioTrack: 'Cybernetic Pulse - Alice & Core',
        likesCount: 5120,
        commentsCount: 308,
        sharesCount: 279,
        bgGradient: 'linear-gradient(180deg, #431407 0%, #1e1b4b 55%, #030712 100%)',
        cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r7',
        viewsDisplay: '840K',
        likedByDids: [],
        createdAt: Date.now() - 20000000,
      },
      {
        id: 'reel-5',
        creatorDid: 'did:key:z6MksDaveNode',
        creatorHandle: 'dave_edge',
        creatorName: 'Dave | Edge Relay',
        caption: '10 seeder peers streaming parallel BitSwap chunks simultaneously. 120MB/s swarm throughput on mobile! 🚀',
        tags: ['#bitswap', '#swarm', '#throughput', '#mesh'],
        audioTrack: 'Relay Velocity - Dave Edge',
        likesCount: 4210,
        commentsCount: 184,
        sharesCount: 195,
        bgGradient: 'linear-gradient(180deg, #172554 0%, #1e1b4b 60%, #020617 100%)',
        cid: 'bafybeihkoviema7g3gxyt6la7vd5ho32wuq5z2m4r6z5g3k7r4o6z5m4r8',
        viewsDisplay: '1.2M',
        likedByDids: [],
        createdAt: Date.now() - 10000000,
      },
    ];
  }

  private getSeedVideoComments(): Record<string, YoutubeCommentRecord[]> {
    return {
      'yt-video-1': [
        {
          id: 'yt-c1',
          videoId: 'yt-video-1',
          authorName: 'Sovra Protocol Lab',
          authorAvatar: 'S',
          authorHandle: 'sovralab',
          text: '📌 Welcome everyone! RFC 8216 HLS Master Playlist & Variant specifications are live. Timestamps are linked in the description. What P2P benchmark should we stress-test next?',
          timestamp: Date.now() - 7200000,
          likes: 842,
          isPinned: true,
          isCreator: true,
          creatorHeart: true,
          replies: [
            {
              id: 'yt-r1-1',
              commentId: 'yt-c1',
              authorName: 'Alex Cryptographer',
              authorAvatar: 'A',
              authorHandle: 'alex_crypto',
              text: 'Please test high-churn 5G cell tower handoffs with 50 concurrent seeders!',
              timestamp: Date.now() - 6500000,
              likes: 94,
            },
            {
              id: 'yt-r1-2',
              commentId: 'yt-c1',
              authorName: 'DevP2P Builder',
              authorAvatar: 'D',
              authorHandle: 'devp2p',
              text: 'Testing with 100K simulated peers on local DHT cluster right now. 0 packet drops!',
              timestamp: Date.now() - 5200000,
              likes: 62,
            },
          ],
        },
        {
          id: 'yt-c2',
          videoId: 'yt-video-1',
          authorName: 'Sarah Monetization Expert',
          authorAvatar: 'S',
          authorHandle: 'sarah_creator',
          text: 'The 95% creator split with 0% platform take is the holy grail. No more YouTube 45% middleman tax! Just sent a Super Thanks voucher.',
          timestamp: Date.now() - 3600000,
          likes: 342,
          isSuperThanks: true,
          superThanksAmount: '₹500 (500 SOV)',
          replies: [],
        },
      ],
    };
  }

  // ==========================================
  // COLLECTION 9: REAL-TIME AUDIT LOGS
  // ==========================================

  public logActivity(
    type: AuditLogRecord['type'],
    actorDid: string,
    actorHandle: string,
    details: string,
  ): AuditLogRecord {
    this.load();
    if (!Array.isArray(this.db.audit_logs)) this.db.audit_logs = [];

    const record: AuditLogRecord = {
      id: 'aud-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      type,
      action: type,
      actorDid,
      actorHandle: actorHandle.startsWith('@') ? actorHandle : '@' + actorHandle,
      details,
      timestamp: Date.now(),
    };

    this.db.audit_logs.unshift(record);
    if (this.db.audit_logs.length > 500) {
      this.db.audit_logs.length = 500;
    }
    this.save();
    return record;
  }

  public getAuditLogs(limit = 100): AuditLogRecord[] {
    this.load();
    if (!Array.isArray(this.db.audit_logs) || this.db.audit_logs.length === 0) {
      this.db.audit_logs = this.getSeedAuditLogs();
      this.save();
    }
    return this.db.audit_logs.slice(0, limit);
  }

  private getSeedAuditLogs(): AuditLogRecord[] {
    const now = Date.now();
    return [
      {
        id: 'aud-seed-1',
        type: 'USER_REGISTERED',
        actorDid: 'did:key:z6MksAliceCreatorP2P',
        actorHandle: '@alice_creator',
        details: 'Registered sovereign identity on desktop node with Ed25519 root key',
        timestamp: now - 3600000 * 5,
      },
      {
        id: 'aud-seed-2',
        type: 'POST_CREATED',
        actorDid: 'did:key:z6MksAliceCreatorP2P',
        actorHandle: '@alice_creator',
        details: 'Published 4K image post pinned to UnixFS blockstore with CID bafybeic...',
        timestamp: now - 3600000 * 4,
      },
      {
        id: 'aud-seed-3',
        type: 'REEL_UPLOADED',
        actorDid: 'did:key:z6MksBobBroadcaster',
        actorHandle: '@bob_live',
        details: 'Uploaded 9:16 vertical reel: 60fps BitSwap stream over UDP QUIC',
        timestamp: now - 3600000 * 3,
      },
      {
        id: 'aud-seed-4',
        type: 'CHAT_SENT',
        actorDid: 'did:key:z6MksCarolMusician',
        actorHandle: '@carol_sounds',
        details: 'Delivered Noise_XX encrypted direct message with 0-hop BitChat mesh delivery',
        timestamp: now - 3600000 * 2,
      },
      {
        id: 'aud-seed-5',
        type: 'TIP_VOUCHER',
        actorDid: 'did:sovra:supporter_node',
        actorHandle: '@supporter_node',
        details: 'Signed 50 SOV off-chain voucher: 47.5 SOV (95%) to creator, 2.5 SOV (5%) to seeders',
        timestamp: now - 3600000 * 1,
      },
    ];
  }
}

// Singleton database instance exported for application-wide use
export const sovraDb = new SovraDatabaseEngine();
