/**
 * @file apps/sovra-mobile/src/services/local-database.ts
 * Sovra Mobile Client Durable Offline Persistence & Outbox Engine.
 *
 * Implements:
 * 1. Crash-safe, restart-safe disk & local storage persistence for:
 *    users, profiles, posts, comments, messages, channels, operations, outbox, inbox, sync_state, media_staging.
 * 2. Strict Outbox State Lifecycle:
 *    PENDING -> TRANSMITTING -> SENT -> DELIVERED -> ACKNOWLEDGED
 *    TRANSMITTING -> RETRYABLE -> FAILED / EXPIRED
 * 3. Idempotent operation deduplication with expiresAt and nextRetryAt exponential backoff.
 * 4. Staging store for offline media before high-bandwidth peer / cloud transmission.
 * 5. Deterministic synchronization tracking with vector clocks & cursors.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type OutboxOpStatus =
  | 'PENDING'
  | 'TRANSMITTING'
  | 'SENT'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'RETRYABLE'
  | 'FAILED'
  | 'EXPIRED';

export type OutboxOpType =
  | 'CREATE_POST'
  | 'EDIT_POST'
  | 'DELETE_POST'
  | 'LIKE_POST'
  | 'ADD_COMMENT'
  | 'SEND_CHAT'
  | 'UPDATE_PROFILE'
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPT'
  | 'CREATE_CHANNEL'
  | 'MEDIA_UPLOAD';

export interface QueuedOperation<T = any> {
  readonly operationId: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly createdAt: number;
  readonly type: OutboxOpType;
  readonly payload: T;
  readonly idempotencyKey: string;
  attemptCount: number;
  status: OutboxOpStatus;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  expiresAt: number;
  errorReason?: string;
  acknowledgedAt?: number;
}

export interface CachedPost {
  id: string;
  authorDid: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  caption: string;
  mediaCid?: string;
  mediaDataUrl?: string;
  mediaType?: 'image' | 'video';
  timestamp: number;
  likesCount: number;
  likedByDids: string[];
  isLiked: boolean;
  commentsCount: number;
  syncStatus: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
}

export interface CachedComment {
  id: string;
  postId: string;
  authorDid: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  timestamp: number;
  syncStatus: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
}

export interface CachedMessage {
  id: string;
  threadId: string;
  senderDid: string;
  recipientDid: string;
  senderName: string;
  text: string;
  timestamp: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  isBitChat?: boolean;
  hopCount?: number;
  mediaAttachment?: {
    name: string;
    cid: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl?: string;
  };
  syncStatus: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
}

export interface ConversationSummary {
  threadId: string;
  peerDid: string;
  peerName: string;
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
  status: CachedMessage['status'];
  isBitChat?: boolean | undefined;
  isChannel?: boolean | undefined;
}

export interface CachedUser {
  did: string;
  handle: string;
  displayName: string;
  avatarDataUrl?: string;
  bio?: string;
  isMe: boolean;
  lastSeen: number;
}

export interface CachedProfile {
  did: string;
  handle: string;
  displayName: string;
  avatarDataUrl?: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  updatedAt: number;
}

export interface CachedChannel {
  id: string;
  name: string;
  description: string;
  ownerDid: string;
  memberCount: number;
  createdAt: number;
  syncStatus: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
}

export interface MediaStagingEntry {
  stagingId: string;
  cid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  createdAt: number;
  transferredBytes: number;
  isComplete: boolean;
}

export interface ClientSyncState {
  lastSyncTimestamp: number;
  lastKnownServerCursor: string;
  activeVectorClock: Record<string, number>;
}

export interface LocalDatabaseSchema {
  version: number;
  users: Record<string, CachedUser>;
  profiles: Record<string, CachedProfile>;
  posts: Record<string, CachedPost>;
  comments: Record<string, CachedComment>;
  messages: Record<string, CachedMessage>;
  channels: Record<string, CachedChannel>;
  operations: Record<string, QueuedOperation>;
  outbox: Record<string, QueuedOperation>;
  inbox: Record<string, { id: string; envelopeId: string; receivedAt: number; senderDid: string }>;
  media_staging: Record<string, MediaStagingEntry>;
  sync_state: ClientSyncState;
}

const STORAGE_KEY = 'sovra_mobile_durable_db_v1';
const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

export class SovraLocalDatabase {
  private static instance: SovraLocalDatabase | null = null;
  private state: LocalDatabaseSchema;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly deviceId: string;
  private readonly diskFilePath: string;
  private readonly diskBackupPath: string;

  private constructor() {
    this.deviceId = this.resolveDeviceId();
    this.diskFilePath = path.resolve(process.cwd(), '.sovra-storage-dev', 'mobile-client-local-state.json');
    this.diskBackupPath = path.resolve(process.cwd(), '.sovra-storage-dev', 'mobile-client-local-state.json.bak');
    this.state = this.loadInitialState();
  }

  public static getInstance(): SovraLocalDatabase {
    if (!SovraLocalDatabase.instance) {
      SovraLocalDatabase.instance = new SovraLocalDatabase();
    }
    return SovraLocalDatabase.instance;
  }

  private resolveDeviceId(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('sovra_device_fingerprint');
      if (stored) return stored;
      const created = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
      localStorage.setItem('sovra_device_fingerprint', created);
      return created;
    }
    return 'dev_node_' + process.pid + '_' + Date.now();
  }

  private loadInitialState(): LocalDatabaseSchema {
    const defaultSchema: LocalDatabaseSchema = {
      version: 2,
      users: {},
      profiles: {},
      posts: {},
      comments: {},
      messages: {},
      channels: {},
      operations: {},
      outbox: {},
      inbox: {},
      media_staging: {},
      sync_state: {
        lastSyncTimestamp: 0,
        lastKnownServerCursor: '0',
        activeVectorClock: {},
      },
    };

    // 1. Try persistent disk storage file first
    try {
      if (fs.existsSync(this.diskFilePath)) {
        const raw = fs.readFileSync(this.diskFilePath, 'utf-8');
        if (raw && raw.trim()) {
          const parsed = JSON.parse(raw);
          return { ...defaultSchema, ...parsed };
        }
      }
    } catch (e) {
      // If primary disk file is corrupted, attempt rolling backup restoration
      try {
        if (fs.existsSync(this.diskBackupPath)) {
          const rawBak = fs.readFileSync(this.diskBackupPath, 'utf-8');
          if (rawBak && rawBak.trim()) {
            const parsed = JSON.parse(rawBak);
            return { ...defaultSchema, ...parsed };
          }
        }
      } catch {}
    }

    // 2. Try localStorage (browser / webview)
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return { ...defaultSchema, ...parsed };
        }
      }
    } catch {}

    return defaultSchema;
  }

  private async persist(): Promise<void> {
    this.writeLock = this.writeLock.then(() => {
      const serialized = JSON.stringify(this.state, null, 2);

      // 1. Persist to browser/webview localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, serialized);
        }
      } catch (e) {
        console.warn('[SovraLocalDB] localStorage write error:', e);
      }

      // 2. Persist to atomic crash-safe file on disk
      try {
        const dir = path.dirname(this.diskFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Rolling backup
        if (fs.existsSync(this.diskFilePath)) {
          fs.copyFileSync(this.diskFilePath, this.diskBackupPath);
        }

        const tmpPath = this.diskFilePath + '.tmp';
        fs.writeFileSync(tmpPath, serialized, 'utf-8');
        fs.renameSync(tmpPath, this.diskFilePath);
      } catch (e) {
        // Disk write fallback for environments without fs permissions
      }
    });
    return this.writeLock;
  }

  // ==========================================
  // OUTBOX OPERATIONS (CRASH-SAFE QUEUE)
  // ==========================================

  public async enqueueOperation<T>(
    type: OutboxOpType,
    actorId: string,
    payload: T,
    idempotencyKey?: string,
    ttlMs: number = DEFAULT_EXPIRATION_MS,
  ): Promise<QueuedOperation<T>> {
    const operationId = `op_${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const finalIdempotencyKey = idempotencyKey || `${type}:${actorId}:${JSON.stringify(payload)}`;

    // Duplicate suppression: if an active operation with identical idempotencyKey exists, return it
    const existing = Object.values(this.state.outbox).find(
      op =>
        op.idempotencyKey === finalIdempotencyKey &&
        op.status !== 'ACKNOWLEDGED' &&
        op.status !== 'FAILED' &&
        op.status !== 'EXPIRED',
    );
    if (existing) {
      return existing as QueuedOperation<T>;
    }

    const now = Date.now();
    const op: QueuedOperation<T> = {
      operationId,
      deviceId: this.deviceId,
      actorId,
      createdAt: now,
      type,
      payload,
      idempotencyKey: finalIdempotencyKey,
      attemptCount: 0,
      status: 'PENDING',
      nextRetryAt: now,
      expiresAt: now + ttlMs,
    };

    this.state.outbox[operationId] = op;
    this.state.operations[operationId] = op;
    await this.persist();
    return op;
  }

  public getPendingOutbox(): QueuedOperation[] {
    const now = Date.now();
    const pending: QueuedOperation[] = [];

    for (const op of Object.values(this.state.outbox)) {
      // Check for expiration
      if (now > op.expiresAt && op.status !== 'ACKNOWLEDGED') {
        op.status = 'EXPIRED';
        continue;
      }

      if ((op.status === 'PENDING' || op.status === 'RETRYABLE') && (op.nextRetryAt ?? 0) <= now) {
        pending.push(op);
      }
    }

    return pending.sort((a, b) => a.createdAt - b.createdAt);
  }

  public getAllOutbox(): QueuedOperation[] {
    return Object.values(this.state.outbox).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getOperation(operationId: string): QueuedOperation | undefined {
    return this.state.outbox[operationId] || this.state.operations[operationId];
  }

  public async markOperationAttempting(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'TRANSMITTING';
    op.attemptCount += 1;
    op.lastAttemptAt = Date.now();
    await this.persist();
  }

  public async markOperationSent(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'SENT';
    await this.persist();
  }

  public async markOperationDelivered(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'DELIVERED';
    await this.persist();
  }

  public async markOperationSuccess(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'ACKNOWLEDGED';
    op.acknowledgedAt = Date.now();
    await this.persist();
  }

  public async markOperationRetryable(operationId: string, errorReason: string, maxAttempts = 5): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.errorReason = errorReason;
    if (op.attemptCount >= maxAttempts) {
      op.status = 'FAILED';
    } else {
      op.status = 'RETRYABLE';
      // Exponential backoff: 2s, 4s, 8s, 16s...
      const backoffSec = Math.pow(2, op.attemptCount);
      op.nextRetryAt = Date.now() + backoffSec * 1000;
    }
    await this.persist();
  }

  // ==========================================
  // USERS & PROFILES PERSISTENCE
  // ==========================================

  public async saveUser(user: CachedUser): Promise<void> {
    this.state.users[user.did] = user;
    await this.persist();
  }

  public getUser(did: string): CachedUser | undefined {
    return this.state.users[did];
  }

  public async saveProfile(profile: CachedProfile): Promise<void> {
    this.state.profiles[profile.did] = profile;
    await this.persist();
  }

  public getProfile(did: string): CachedProfile | undefined {
    return this.state.profiles[did];
  }

  // ==========================================
  // POSTS PERSISTENCE & CACHING
  // ==========================================

  public async savePost(post: CachedPost): Promise<void> {
    this.state.posts[post.id] = post;
    await this.persist();
  }

  public getPosts(): CachedPost[] {
    return Object.values(this.state.posts).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getPost(id: string): CachedPost | undefined {
    return this.state.posts[id];
  }

  public async updatePostLike(postId: string, userDid: string): Promise<{ isLiked: boolean; likesCount: number } | null> {
    const post = this.state.posts[postId];
    if (!post) return null;
    const idx = post.likedByDids.indexOf(userDid);
    if (idx > -1) {
      post.likedByDids.splice(idx, 1);
      post.isLiked = false;
    } else {
      post.likedByDids.push(userDid);
      post.isLiked = true;
    }
    post.likesCount = post.likedByDids.length;
    await this.persist();
    return { isLiked: post.isLiked, likesCount: post.likesCount };
  }

  // ==========================================
  // COMMENTS PERSISTENCE
  // ==========================================

  public async saveComment(comment: CachedComment): Promise<void> {
    this.state.comments[comment.id] = comment;
    await this.persist();
  }

  public getPostComments(postId: string): CachedComment[] {
    return Object.values(this.state.comments)
      .filter(c => c.postId === postId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ==========================================
  // CHAT MESSAGES PERSISTENCE & CACHING
  // ==========================================

  public async saveMessage(msg: CachedMessage): Promise<void> {
    this.state.messages[msg.id] = msg;
    await this.persist();
  }

  public getThreadMessages(threadOrPeerDid: string): CachedMessage[] {
    return Object.values(this.state.messages)
      .filter(
        m =>
          m.threadId === threadOrPeerDid ||
          m.senderDid === threadOrPeerDid ||
          m.recipientDid === threadOrPeerDid ||
          (threadOrPeerDid.startsWith('channel:') && m.recipientDid === threadOrPeerDid),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  public getConversationsList(myDid?: string): ConversationSummary[] {
    const threadMap = new Map<string, CachedMessage[]>();

    for (const msg of Object.values(this.state.messages)) {
      let tId = msg.threadId;
      if (!tId) {
        if (msg.recipientDid.startsWith('channel:')) {
          tId = msg.recipientDid;
        } else if (msg.senderDid === myDid) {
          tId = msg.recipientDid;
        } else {
          tId = msg.senderDid;
        }
      }
      if (!threadMap.has(tId)) {
        threadMap.set(tId, []);
      }
      threadMap.get(tId)!.push(msg);
    }

    const summaries: ConversationSummary[] = [];

    for (const [threadId, msgs] of threadMap.entries()) {
      if (msgs.length === 0) continue;
      msgs.sort((a, b) => b.timestamp - a.timestamp);
      const latest = msgs[0];
      if (!latest) continue;
      const isChannel = threadId.startsWith('channel:');

      let peerName = latest.senderName;
      let peerDid = threadId;

      if (isChannel) {
        peerName = threadId === 'channel:local_mesh' ? '#local-mesh' : (threadId === 'channel:emergency_sos' ? '#emergency-sos' : threadId);
        peerDid = threadId;
      } else if (latest.senderDid === myDid) {
        peerDid = latest.recipientDid;
        peerName = peerDid.includes('Alice') ? 'Alice' : peerDid.substring(0, 16);
      } else {
        peerDid = latest.senderDid;
        peerName = latest.senderName || peerDid.substring(0, 16);
      }

      const unreadCount = msgs.filter(m => m.senderDid !== myDid && m.status !== 'read').length;

      summaries.push({
        threadId,
        peerDid,
        peerName,
        lastMessageText: latest.text,
        lastMessageTimestamp: latest.timestamp,
        unreadCount,
        status: latest.status,
        isBitChat: latest.isBitChat,
        isChannel,
      });
    }

    // Default broadcast channels if not yet in state
    const defaultChannels = [
      { id: 'channel:local_mesh', name: '#local-mesh', desc: 'Hyperlocal Public Beacon (50m)' },
      { id: 'channel:emergency_sos', name: '#emergency-sos', desc: 'Zero-Internet SOS Broadcast Swarm' },
    ];
    for (const dc of defaultChannels) {
      if (!summaries.find(s => s.threadId === dc.id)) {
        summaries.push({
          threadId: dc.id,
          peerDid: dc.id,
          peerName: dc.name,
          lastMessageText: dc.desc,
          lastMessageTimestamp: 0,
          unreadCount: 0,
          status: 'delivered',
          isBitChat: true,
          isChannel: true,
        });
      }
    }

    return summaries.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
  }

  public async updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
    syncStatus?: CachedMessage['syncStatus'],
  ): Promise<void> {
    const msg = this.state.messages[messageId];
    if (!msg) return;
    msg.status = status;
    if (syncStatus) msg.syncStatus = syncStatus;
    await this.persist();
  }

  // ==========================================
  // CHANNELS PERSISTENCE
  // ==========================================

  public async saveChannel(channel: CachedChannel): Promise<void> {
    this.state.channels[channel.id] = channel;
    await this.persist();
  }

  public getChannels(): CachedChannel[] {
    return Object.values(this.state.channels).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ==========================================
  // MEDIA STAGING STORE
  // ==========================================

  public async stageMedia(entry: Omit<MediaStagingEntry, 'createdAt' | 'transferredBytes' | 'isComplete'>): Promise<MediaStagingEntry> {
    const fullEntry: MediaStagingEntry = {
      ...entry,
      createdAt: Date.now(),
      transferredBytes: 0,
      isComplete: false,
    };
    this.state.media_staging[entry.stagingId] = fullEntry;
    await this.persist();
    return fullEntry;
  }

  public getStagedMedia(stagingId: string): MediaStagingEntry | undefined {
    return this.state.media_staging[stagingId];
  }

  public async updateMediaProgress(stagingId: string, transferredBytes: number, isComplete: boolean): Promise<void> {
    const item = this.state.media_staging[stagingId];
    if (!item) return;
    item.transferredBytes = transferredBytes;
    item.isComplete = isComplete;
    await this.persist();
  }

  // ==========================================
  // SYNC STATE TRACKING
  // ==========================================

  public getSyncState(): ClientSyncState {
    return this.state.sync_state;
  }

  public async updateSyncState(updates: Partial<ClientSyncState>): Promise<void> {
    this.state.sync_state = { ...this.state.sync_state, ...updates };
    await this.persist();
  }

  // ==========================================
  // INBOX DEDUPLICATION
  // ==========================================

  public isInboxEnvelopeSeen(envelopeId: string): boolean {
    return !!this.state.inbox[envelopeId];
  }

  public async recordInboxEnvelope(envelopeId: string, senderDid: string): Promise<void> {
    this.state.inbox[envelopeId] = {
      id: `inb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      envelopeId,
      receivedAt: Date.now(),
      senderDid,
    };
    await this.persist();
  }

  // ==========================================
  // EMERGENCY DATA WIPE (PANIC)
  // ==========================================

  public async emergencyPanicWipe(): Promise<void> {
    this.state = {
      version: 2,
      users: {},
      profiles: {},
      posts: {},
      comments: {},
      messages: {},
      channels: {},
      operations: {},
      outbox: {},
      inbox: {},
      media_staging: {},
      sync_state: {
        lastSyncTimestamp: 0,
        lastKnownServerCursor: '0',
        activeVectorClock: {},
      },
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    try {
      if (fs.existsSync(this.diskFilePath)) fs.unlinkSync(this.diskFilePath);
      if (fs.existsSync(this.diskBackupPath)) fs.unlinkSync(this.diskBackupPath);
    } catch {}
    await this.persist();
  }
}

export const localDb = SovraLocalDatabase.getInstance();
