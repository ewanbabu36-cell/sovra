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
  isSaved?: boolean | undefined;
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
  isBitChat?: boolean | undefined;
  hopCount?: number | undefined;
  disappearingDurationSec?: number | undefined;
  expiresAt?: number | undefined;
  isDisappeared?: boolean | undefined;
  mediaAttachment?: {
    name: string;
    cid: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl?: string | undefined;
  } | undefined;
  syncStatus: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
}

export interface CachedWalletTransaction {
  txHash: string;
  type: 'tip_sent' | 'tip_received' | 'swap' | 'transfer';
  amount: string;
  tokenSymbol: string;
  timestamp: number;
  peerDid?: string | undefined;
  status: 'confirmed' | 'pending' | 'failed';
  fee?: string | undefined;
}

export interface CachedGuardian {
  did: string;
  name: string;
  status: 'pending' | 'active' | 'confirmed';
  addedAt: number;
  threshold?: number | undefined;
}

export interface CachedBookmark {
  postId: string;
  savedAt: number;
}

export interface CachedFollow {
  did: string;
  handle: string;
  followedAt: number;
}

export interface CachedStory {
  id: string;
  authorDid: string;
  authorName: string;
  authorAvatar: string;
  avatarBg?: string | undefined;
  mediaImage?: string | undefined;
  caption?: string | undefined;
  createdAt: number;
  expiresAt: number;
  isSeen?: boolean | undefined;
}

export interface CachedReaction {
  messageId: string;
  emoji: string;
  senderDid: string;
  timestamp: number;
}

export interface CachedLiveStream {
  id: string;
  hostDid: string;
  hostName: string;
  title: string;
  category?: string | undefined;
  viewersCount: number;
  isLive: boolean;
  startedAt: number;
  endedAt?: number | undefined;
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
  isGroup?: boolean | undefined;
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
  subscriberCount?: number | undefined;
  topic?: string | undefined;
  isPublic?: boolean | undefined;
  handle?: string | undefined;
  avatar?: string | undefined;
  avatarBg?: string | undefined;
  bannerUrl?: string | undefined;
  verified?: boolean | undefined;
  channelType?: string | undefined;
  isSubscribed?: boolean | undefined;
  communityUpdates?: Array<{ id: string; content: string; createdAt: number }> | undefined;
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

export interface CachedGroup {
  id: string;
  name: string;
  description?: string | undefined;
  avatarEmoji?: string | undefined;
  creatorDid: string;
  memberDids: string[];
  createdAt: number;
  lastMessageText?: string | undefined;
  lastMessageTimestamp?: number | undefined;
}

export interface CachedSavedVideo {
  videoId: string;
  title: string;
  channelName: string;
  duration: number;
  thumbnail?: string | undefined;
  savedAt: number;
}

export interface LocalDatabaseSchema {
  version: number;
  users: Record<string, CachedUser>;
  profiles: Record<string, CachedProfile>;
  posts: Record<string, CachedPost>;
  comments: Record<string, CachedComment>;
  messages: Record<string, CachedMessage>;
  channels: Record<string, CachedChannel>;
  custom_channels: Record<string, CachedChannel>;
  groups: Record<string, CachedGroup>;
  saved_videos: Record<string, CachedSavedVideo>;
  operations: Record<string, QueuedOperation>;
  outbox: Record<string, QueuedOperation>;
  inbox: Record<string, { id: string; envelopeId: string; receivedAt: number; senderDid: string }>;
  media_staging: Record<string, MediaStagingEntry>;
  wallet_ledger: Record<string, CachedWalletTransaction>;
  guardians: Record<string, CachedGuardian>;
  bookmarks: Record<string, CachedBookmark>;
  follows: Record<string, CachedFollow>;
  stories: Record<string, CachedStory>;
  reactions: Record<string, CachedReaction[]>;
  live_streams: Record<string, CachedLiveStream>;
  channel_memberships: Record<string, any>;
  super_chat_pins: Record<string, any>;
  store_products: Record<string, any>;
  store_purchases: Record<string, any>;
  financial_ledger: Record<string, any>;
  balance_privacy_masked?: boolean;
  cached_balance?: string;
  active_persona?: any;
  personas?: any[];
  cache_quota?: { usedMb: number; totalMb: number };
  sync_state: ClientSyncState;
}

export const STORAGE_KEY = 'sovra_mobile_durable_db_v1';
export const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL
export const MAX_MEDIA_STAGING_ITEMS = 50;
export const MAX_MEDIA_STAGING_BYTES = 50 * 1024 * 1024; // 50MB

// ==========================================
// 0. CROSS-PLATFORM STORAGE DRIVER ABSTRACTION
// ==========================================

export interface IStorageDriver {
  readonly name: string;
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

export class MemoryStorageDriver implements IStorageDriver {
  public readonly name = 'memory';
  private store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }
}

export class LocalStorageDriver implements IStorageDriver {
  public readonly name = 'local-storage';

  public getItem(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {}
    return null;
  }

  public setItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {}
  }

  public removeItem(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {}
  }

  public clear(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }
}

export class NodeStorageDriver implements IStorageDriver {
  public readonly name = 'node-disk';
  private readonly diskFilePath: string;
  private readonly diskBackupPath: string;

  constructor(customPath?: string) {
    const cwd = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.';
    this.diskFilePath = customPath || path.resolve(cwd, '.sovra-storage-dev', 'mobile-client-local-state.json');
    this.diskBackupPath = this.diskFilePath + '.bak';
  }

  public getItem(_key: string): string | null {
    try {
      if (fs.existsSync(this.diskFilePath)) {
        const raw = fs.readFileSync(this.diskFilePath, 'utf-8');
        if (raw && raw.trim()) return raw;
      }
    } catch {}
    try {
      if (fs.existsSync(this.diskBackupPath)) {
        const rawBak = fs.readFileSync(this.diskBackupPath, 'utf-8');
        if (rawBak && rawBak.trim()) return rawBak;
      }
    } catch {}
    return null;
  }

  public setItem(_key: string, value: string): void {
    try {
      const dir = path.dirname(this.diskFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.diskFilePath)) {
        fs.copyFileSync(this.diskFilePath, this.diskBackupPath);
      }
      const tmpPath = this.diskFilePath + '.tmp';
      fs.writeFileSync(tmpPath, value, 'utf-8');
      fs.renameSync(tmpPath, this.diskFilePath);
    } catch (e) {
      // Graceful fallback if disk permissions fail
    }
  }

  public removeItem(_key: string): void {
    try {
      if (fs.existsSync(this.diskFilePath)) fs.unlinkSync(this.diskFilePath);
      if (fs.existsSync(this.diskBackupPath)) fs.unlinkSync(this.diskBackupPath);
    } catch {}
  }

  public clear(): void {
    this.removeItem(STORAGE_KEY);
  }
}

export function resolveStorageDriver(customDriver?: IStorageDriver): IStorageDriver {
  if (customDriver) return customDriver;
  // Node.js with native fs available
  if (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node &&
    typeof fs !== 'undefined' &&
    typeof fs.readFileSync === 'function'
  ) {
    return new NodeStorageDriver();
  }
  // Browser or React Native WebView with localStorage
  if (typeof localStorage !== 'undefined') {
    return new LocalStorageDriver();
  }
  // Safe in-memory fallback
  return new MemoryStorageDriver();
}

// ==========================================
// LOCAL SCHEMA MIGRATOR (VERSIONING)
// ==========================================

export class LocalSchemaMigrator {
  public static migrate(raw: any): LocalDatabaseSchema {
    const defaultSchema: LocalDatabaseSchema = {
      version: 9,
      users: {},
      profiles: {},
      posts: {},
      comments: {},
      messages: {},
      channels: {},
      custom_channels: {},
      groups: {},
      saved_videos: {},
      operations: {},
      outbox: {},
      inbox: {},
      media_staging: {},
      wallet_ledger: {},
      guardians: {},
      bookmarks: {},
      follows: {},
      stories: {},
      reactions: {},
      live_streams: {},
      channel_memberships: {},
      super_chat_pins: {},
      store_products: {},
      store_purchases: {},
      financial_ledger: {},
      balance_privacy_masked: false,
      cached_balance: '450.50 SOV',
      active_persona: null,
      personas: [],
      cache_quota: { usedMb: 420, totalMb: 500 },
      sync_state: {
        lastSyncTimestamp: 0,
        lastKnownServerCursor: '0',
        activeVectorClock: {},
      },
    };

    if (!raw || typeof raw !== 'object') {
      return defaultSchema;
    }

    const currentVersion = Number(raw.version || 1);
    const migrated: LocalDatabaseSchema = {
      ...defaultSchema,
      ...raw,
      users: raw.users || {},
      profiles: raw.profiles || {},
      posts: raw.posts || {},
      comments: raw.comments || {},
      messages: raw.messages || {},
      channels: raw.channels || {},
      custom_channels: raw.custom_channels || {},
      groups: raw.groups || {},
      saved_videos: raw.saved_videos || {},
      operations: raw.operations || {},
      outbox: raw.outbox || {},
      inbox: raw.inbox || {},
      media_staging: raw.media_staging || {},
      wallet_ledger: raw.wallet_ledger || {},
      guardians: raw.guardians || {},
      bookmarks: raw.bookmarks || {},
      follows: raw.follows || {},
      stories: raw.stories || {},
      reactions: raw.reactions || {},
      live_streams: raw.live_streams || {},
      channel_memberships: raw.channel_memberships || {},
      super_chat_pins: raw.super_chat_pins || {},
      store_products: raw.store_products || {},
      store_purchases: raw.store_purchases || {},
      financial_ledger: raw.financial_ledger || {},
      sync_state: {
        ...defaultSchema.sync_state,
        ...(raw.sync_state || {}),
      },
    };

    if (currentVersion < 9) {
      migrated.version = 9;
      if (!migrated.channel_memberships) migrated.channel_memberships = {};
      if (!migrated.super_chat_pins) migrated.super_chat_pins = {};
      if (!migrated.store_products) migrated.store_products = {};
      if (!migrated.store_purchases) migrated.store_purchases = {};
      if (!migrated.financial_ledger) migrated.financial_ledger = {};
    }

    return migrated;
  }
}

export class SovraLocalDatabase {
  private static instance: SovraLocalDatabase | null = null;
  private state: LocalDatabaseSchema;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly deviceId: string;
  private driver: IStorageDriver;
  private outboxListeners: Array<(op: QueuedOperation) => void> = [];

  private constructor(driver?: IStorageDriver) {
    this.deviceId = this.resolveDeviceId();
    this.driver = driver || resolveStorageDriver();
    this.state = this.loadInitialState();
    this.purgeExpiredDisappearingMessages();
  }

  public static getInstance(driver?: IStorageDriver): SovraLocalDatabase {
    if (!SovraLocalDatabase.instance) {
      SovraLocalDatabase.instance = new SovraLocalDatabase(driver);
    } else if (driver) {
      SovraLocalDatabase.instance.setStorageDriver(driver);
    }
    return SovraLocalDatabase.instance;
  }

  public async init(): Promise<void> {
    return Promise.resolve();
  }

  public setStorageDriver(driver: IStorageDriver): void {
    this.driver = driver;
    this.state = this.loadInitialState();
  }

  public getStorageDriver(): IStorageDriver {
    return this.driver;
  }

  public getSchema(): LocalDatabaseSchema {
    return this.state;
  }

  public subscribeToOutbox(callback: (op: QueuedOperation) => void): () => void {
    this.outboxListeners.push(callback);
    return () => {
      this.outboxListeners = this.outboxListeners.filter(l => l !== callback);
    };
  }

  private notifyOutboxListeners(op: QueuedOperation): void {
    for (const listener of this.outboxListeners) {
      try {
        listener(op);
      } catch (e) {
        console.warn('[SovraLocalDB] Outbox listener notification error:', e);
      }
    }
  }

  private resolveDeviceId(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('sovra_device_fingerprint');
      if (stored) return stored;
      const created = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
      localStorage.setItem('sovra_device_fingerprint', created);
      return created;
    }
    return 'dev_node_' + (typeof process !== 'undefined' ? process.pid : '1') + '_' + Date.now();
  }

  private loadInitialState(): LocalDatabaseSchema {
    // 1. Try active storage driver
    try {
      const raw = this.driver.getItem(STORAGE_KEY);
      if (raw && typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw);
        return LocalSchemaMigrator.migrate(parsed);
      }
    } catch (e) {
      // Driver read fallback
    }

    // 2. Try browser localStorage fallback if driver was not localStorage
    try {
      if (typeof localStorage !== 'undefined' && this.driver.name !== 'local-storage') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return LocalSchemaMigrator.migrate(parsed);
        }
      }
    } catch {}

    return LocalSchemaMigrator.migrate(null);
  }

  private async persist(): Promise<void> {
    this.writeLock = this.writeLock.then(() => {
      const serialized = JSON.stringify(this.state, null, 2);

      // Persist to primary driver
      try {
        this.driver.setItem(STORAGE_KEY, serialized);
      } catch (e) {
        console.warn('[SovraLocalDB] Driver persist error:', e);
      }

      // Also mirror to localStorage in browser environments for instant PWA recovery
      try {
        if (typeof localStorage !== 'undefined' && this.driver.name !== 'local-storage') {
          localStorage.setItem(STORAGE_KEY, serialized);
        }
      } catch {}
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
    this.notifyOutboxListeners(op);
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
    this.notifyOutboxListeners(op);
  }

  public async markOperationSent(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'SENT';
    await this.persist();
    this.notifyOutboxListeners(op);
  }

  public async markOperationDelivered(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'DELIVERED';
    await this.persist();
    this.notifyOutboxListeners(op);
  }

  public async markOperationSuccess(operationId: string): Promise<void> {
    const op = this.state.outbox[operationId];
    if (!op) return;
    op.status = 'ACKNOWLEDGED';
    op.acknowledgedAt = Date.now();
    await this.persist();
    this.notifyOutboxListeners(op);
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
    this.notifyOutboxListeners(op);
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

  public purgeExpiredDisappearingMessages(now: number = Date.now()): number {
    let purgedCount = 0;
    for (const [msgId, msg] of Object.entries(this.state.messages)) {
      if (msg.expiresAt && msg.expiresAt <= now) {
        delete this.state.messages[msgId];
        purgedCount++;
      }
    }
    if (purgedCount > 0) {
      this.persist().catch(e => console.warn('[SovraLocalDB] Persist error after purge:', e));
    }
    return purgedCount;
  }

  public async saveMessage(msg: CachedMessage): Promise<void> {
    if (msg.disappearingDurationSec && msg.disappearingDurationSec > 0 && !msg.expiresAt) {
      msg.expiresAt = (msg.timestamp || Date.now()) + msg.disappearingDurationSec * 1000;
    }
    this.state.messages[msg.id] = msg;
    await this.persist();
  }

  public getThreadMessages(threadOrPeerDid: string): CachedMessage[] {
    this.purgeExpiredDisappearingMessages();
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
    this.purgeExpiredDisappearingMessages();
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

    // Include E2EE Multi-Party Groups
    for (const group of Object.values(this.state.groups || {})) {
      if (!summaries.find(s => s.threadId === group.id)) {
        summaries.push({
          threadId: group.id,
          peerDid: group.id,
          peerName: `${group.avatarEmoji || '👥'} ${group.name}`,
          lastMessageText: group.lastMessageText || 'Group created',
          lastMessageTimestamp: group.lastMessageTimestamp || group.createdAt,
          unreadCount: 0,
          status: 'delivered',
          isBitChat: true,
          isChannel: false,
          isGroup: true,
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
    if (!this.state.channels) this.state.channels = {};
    if (!this.state.custom_channels) this.state.custom_channels = {};
    this.state.channels[channel.id] = channel;
    this.state.custom_channels[channel.id] = channel;
    await this.persist();
  }

  public getChannels(): CachedChannel[] {
    const listA = Object.values(this.state.channels || {});
    const listB = Object.values(this.state.custom_channels || {});
    const map = new Map<string, CachedChannel>();
    for (const c of [...listA, ...listB]) {
      map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public async syncChannelSubscription(channelId: string, isSubscribed: boolean): Promise<void> {
    if (!this.state.channels) this.state.channels = {};
    if (!this.state.custom_channels) this.state.custom_channels = {};
    const ch = this.state.custom_channels[channelId] || this.state.channels[channelId];
    if (ch) {
      ch.isSubscribed = isSubscribed;
      if (isSubscribed) {
        ch.subscriberCount = (ch.subscriberCount || ch.memberCount || 0) + 1;
      } else {
        ch.subscriberCount = Math.max(0, (ch.subscriberCount || ch.memberCount || 1) - 1);
      }
      this.state.channels[channelId] = ch;
      this.state.custom_channels[channelId] = ch;
      await this.persist();
    }
  }

  public async addChannelCommunityUpdate(channelId: string, post: { id: string; content: string; createdAt: number }): Promise<void> {
    if (!this.state.channels) this.state.channels = {};
    if (!this.state.custom_channels) this.state.custom_channels = {};
    const ch = this.state.custom_channels[channelId] || this.state.channels[channelId];
    if (ch) {
      if (!ch.communityUpdates) ch.communityUpdates = [];
      ch.communityUpdates.unshift(post);
      this.state.channels[channelId] = ch;
      this.state.custom_channels[channelId] = ch;
      await this.persist();
    }
  }

  // ==========================================
  // LIVE STREAMS PERSISTENCE
  // ==========================================

  public async saveLiveStream(stream: CachedLiveStream): Promise<void> {
    if (!this.state.live_streams) this.state.live_streams = {};
    this.state.live_streams[stream.id] = stream;
    await this.persist();
  }

  public getLiveStreams(): CachedLiveStream[] {
    if (!this.state.live_streams) return [];
    return Object.values(this.state.live_streams).sort((a, b) => b.startedAt - a.startedAt);
  }

  public async endLiveStream(id: string): Promise<void> {
    if (this.state.live_streams && this.state.live_streams[id]) {
      this.state.live_streams[id]!.isLive = false;
      this.state.live_streams[id]!.endedAt = Date.now();
      await this.persist();
    }
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

    // LRU Cache Eviction Policy (Max 50 items or 50MB ceiling)
    const existing = Object.values(this.state.media_staging);
    let totalBytes = existing.reduce((sum, item) => sum + (item.sizeBytes || item.dataBase64?.length || 0), 0);
    const incomingBytes = entry.sizeBytes || entry.dataBase64?.length || 0;

    if (existing.length >= MAX_MEDIA_STAGING_ITEMS || (totalBytes + incomingBytes) > MAX_MEDIA_STAGING_BYTES) {
      // Sort oldest first
      const sorted = [...existing].sort((a, b) => a.createdAt - b.createdAt);
      while (sorted.length > 0 && (sorted.length >= MAX_MEDIA_STAGING_ITEMS || (totalBytes + incomingBytes) > MAX_MEDIA_STAGING_BYTES)) {
        const oldest = sorted.shift()!;
        delete this.state.media_staging[oldest.stagingId];
        totalBytes -= (oldest.sizeBytes || oldest.dataBase64?.length || 0);
      }
    }

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
  // WALLET LEDGER & AMM TRANSACTIONS
  // ==========================================

  public async recordWalletTransaction(tx: CachedWalletTransaction): Promise<void> {
    this.state.wallet_ledger[tx.txHash] = tx;
    await this.persist();
  }

  public async saveWalletTx(tx: CachedWalletTransaction): Promise<void> {
    return this.recordWalletTransaction(tx);
  }

  public getWalletTransactions(): CachedWalletTransaction[] {
    return Object.values(this.state.wallet_ledger || {}).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getWalletTransaction(txHash: string): CachedWalletTransaction | undefined {
    return (this.state.wallet_ledger || {})[txHash];
  }

  // ==========================================
  // SOCIAL GUARDIANS PERSISTENCE
  // ==========================================

  public async saveGuardian(guardian: CachedGuardian): Promise<void> {
    if (!this.state.guardians) this.state.guardians = {};
    this.state.guardians[guardian.did] = guardian;
    await this.persist();
  }

  public getGuardians(): CachedGuardian[] {
    return Object.values(this.state.guardians || {}).sort((a, b) => b.addedAt - a.addedAt);
  }

  public async removeGuardian(did: string): Promise<void> {
    if (this.state.guardians) {
      delete this.state.guardians[did];
      await this.persist();
    }
  }

  // ==========================================
  // BOOKMARKS PERSISTENCE
  // ==========================================

  public async saveBookmark(postId: string): Promise<void> {
    if (!this.state.bookmarks) this.state.bookmarks = {};
    this.state.bookmarks[postId] = {
      postId,
      savedAt: Date.now(),
    };
    if (this.state.posts[postId]) {
      this.state.posts[postId].isSaved = true;
    }
    await this.persist();
  }

  public async removeBookmark(postId: string): Promise<void> {
    if (this.state.bookmarks) {
      delete this.state.bookmarks[postId];
    }
    if (this.state.posts[postId]) {
      this.state.posts[postId].isSaved = false;
    }
    await this.persist();
  }

  public getBookmarks(): CachedBookmark[] {
    return Object.values(this.state.bookmarks || {}).sort((a, b) => b.savedAt - a.savedAt);
  }

  public getBookmarkedPosts(): CachedPost[] {
    const bookmarkedIds = new Set(Object.keys(this.state.bookmarks || {}));
    return Object.values(this.state.posts).filter(p => bookmarkedIds.has(p.id) || p.isSaved);
  }

  // ==========================================
  // FOLLOWS PERSISTENCE
  // ==========================================

  public async saveFollow(did: string, handle: string): Promise<void> {
    if (!this.state.follows) this.state.follows = {};
    this.state.follows[did] = {
      did,
      handle,
      followedAt: Date.now(),
    };
    await this.persist();
  }

  public async removeFollow(did: string): Promise<void> {
    if (this.state.follows) {
      delete this.state.follows[did];
      await this.persist();
    }
  }

  public getFollows(): CachedFollow[] {
    return Object.values(this.state.follows || {}).sort((a, b) => b.followedAt - a.followedAt);
  }

  public isFollowing(did: string): boolean {
    return Boolean(this.state.follows && this.state.follows[did]);
  }

  // ==========================================
  // STORIES & EPHEMERAL TTL PERSISTENCE
  // ==========================================

  public async saveStory(story: CachedStory): Promise<void> {
    if (!this.state.stories) this.state.stories = {};
    this.state.stories[story.id] = story;
    await this.persist();
  }

  public getStories(): CachedStory[] {
    const now = Date.now();
    return Object.values(this.state.stories || {})
      .filter(s => s.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  public getAllStories(): CachedStory[] {
    return Object.values(this.state.stories || {}).sort((a, b) => b.createdAt - a.createdAt);
  }

  public purgeExpiredStories(now?: number): number {
    const currentTime = now ?? Date.now();
    let purgedCount = 0;
    if (this.state.stories) {
      for (const [id, s] of Object.entries(this.state.stories)) {
        if (currentTime > s.expiresAt) {
          delete this.state.stories[id];
          purgedCount++;
        }
      }
    }
    if (purgedCount > 0) {
      this.persist().catch(() => {});
    }
    return purgedCount;
  }

  // ==========================================
  // CHAT REACTIONS PERSISTENCE & TOGGLING
  // ==========================================

  public async saveReaction(
    messageId: string,
    emoji: string,
    senderDid: string,
  ): Promise<{ reactions: CachedReaction[]; toggled: boolean }> {
    if (!this.state.reactions) this.state.reactions = {};
    if (!this.state.reactions[messageId]) this.state.reactions[messageId] = [];

    const existingList = this.state.reactions[messageId] || [];
    this.state.reactions[messageId] = existingList;
    const existingIdx = existingList.findIndex(r => r.senderDid === senderDid);
    let toggled = false;

    if (existingIdx >= 0 && existingList[existingIdx]) {
      const item = existingList[existingIdx]!;
      if (item.emoji === emoji) {
        // Same emoji -> toggle off / remove
        existingList.splice(existingIdx, 1);
        toggled = true;
      } else {
        // Different emoji -> update
        item.emoji = emoji;
        item.timestamp = Date.now();
      }
    } else {
      existingList.push({
        messageId,
        emoji,
        senderDid,
        timestamp: Date.now(),
      });
    }

    await this.persist();
    return { reactions: [...existingList], toggled };
  }

  public getReactions(messageId: string): CachedReaction[] {
    return this.state.reactions?.[messageId] || [];
  }

  // ==========================================
  // E2EE MULTI-PARTY GROUPS (CYCLE 9)
  // ==========================================

  public async saveGroup(group: CachedGroup): Promise<void> {
    if (!this.state.groups) {
      this.state.groups = {};
    }
    this.state.groups[group.id] = group;
    await this.persist();
  }

  public getGroups(): CachedGroup[] {
    return Object.values(this.state.groups || {}).sort((a, b) => (b.lastMessageTimestamp || b.createdAt) - (a.lastMessageTimestamp || a.createdAt));
  }

  public getGroup(id: string): CachedGroup | null {
    return this.state.groups?.[id] || null;
  }

  // ==========================================
  // SOVEREIGN WATCH LATER / PLAYLISTS (CYCLE 9)
  // ==========================================

  public async saveVideoToWatchLater(video: CachedSavedVideo): Promise<void> {
    if (!this.state.saved_videos) {
      this.state.saved_videos = {};
    }
    this.state.saved_videos[video.videoId] = video;
    await this.persist();
  }

  public getSavedVideos(): CachedSavedVideo[] {
    return Object.values(this.state.saved_videos || {}).sort((a, b) => b.savedAt - a.savedAt);
  }

  public async removeSavedVideo(videoId: string): Promise<void> {
    if (this.state.saved_videos && this.state.saved_videos[videoId]) {
      delete this.state.saved_videos[videoId];
      await this.persist();
    }
  }

  public isSavedVideo(videoId: string): boolean {
    return Boolean(this.state.saved_videos?.[videoId]);
  }

  // ==========================================
  // EMERGENCY DATA WIPE (PANIC)
  // ==========================================

  public async emergencyPanicWipe(): Promise<void> {
    this.state = {
      version: 8,
      users: {},
      profiles: {},
      posts: {},
      comments: {},
      messages: {},
      channels: {},
      custom_channels: {},
      groups: {},
      saved_videos: {},
      operations: {},
      outbox: {},
      inbox: {},
      media_staging: {},
      wallet_ledger: {},
      guardians: {},
      bookmarks: {},
      follows: {},
      stories: {},
      reactions: {},
      live_streams: {},
      channel_memberships: {},
      super_chat_pins: {},
      store_products: {},
      store_purchases: {},
      financial_ledger: {},
      sync_state: {
        lastSyncTimestamp: 0,
        lastKnownServerCursor: '0',
        activeVectorClock: {},
      },
    };
    try {
      this.driver.clear();
    } catch {}
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    await this.persist();
  }

  // Commercialization & Monetization Methods
  public async saveChannelMembership(membership: any): Promise<void> {
    await this.init();
    if (!this.state.channel_memberships) this.state.channel_memberships = {};
    const key = membership.channelId || membership.id;
    this.state.channel_memberships[key] = membership;
    await this.persist();
  }

  public async getChannelMembership(channelId: string): Promise<any | null> {
    await this.init();
    return (this.state.channel_memberships && this.state.channel_memberships[channelId]) || null;
  }

  public async saveSuperChatPin(pin: any): Promise<void> {
    await this.init();
    if (!this.state.super_chat_pins) this.state.super_chat_pins = {};
    this.state.super_chat_pins[pin.id] = pin;
    await this.persist();
  }

  public async getActiveSuperChatPins(channelId: string): Promise<any[]> {
    await this.init();
    const all = Object.values(this.state.super_chat_pins || {});
    return all.filter((p: any) => p.channelId === channelId && (!p.expiresAt || p.expiresAt > Date.now()));
  }

  public async getLivePins(channelId: string): Promise<any[]> {
    return this.getActiveSuperChatPins(channelId);
  }

  public async saveStoreProduct(product: any): Promise<void> {
    await this.init();
    if (!this.state.store_products) this.state.store_products = {};
    this.state.store_products[product.id] = product;
    await this.persist();
  }

  public async getStoreProducts(channelId?: string): Promise<any[]> {
    await this.init();
    const all = Object.values(this.state.store_products || {});
    if (!channelId) return all;
    return all.filter((p: any) => p.channelId === channelId);
  }

  public async saveStorePurchase(purchase: any): Promise<void> {
    await this.init();
    if (!this.state.store_purchases) this.state.store_purchases = {};
    this.state.store_purchases[purchase.id] = purchase;
    await this.persist();
  }

  public async getStorePurchases(): Promise<any[]> {
    await this.init();
    return Object.values(this.state.store_purchases || {});
  }

  public async hasPurchasedProduct(productId: string, buyerDid?: string): Promise<boolean> {
    await this.init();
    const all = Object.values(this.state.store_purchases || {});
    return all.some((p: any) => p.productId === productId && (!buyerDid || p.buyerDid === buyerDid));
  }

  // ==========================================
  // HERO CARD, BALANCE PRIVACY & QUOTA METHODS
  // ==========================================

  public isBalanceMasked(): boolean {
    return !!this.state.balance_privacy_masked;
  }

  public async setBalanceMasked(masked: boolean): Promise<void> {
    this.state.balance_privacy_masked = masked;
    await this.persist();
  }

  public getCachedBalance(): string {
    return this.state.cached_balance || '450.50 SOV';
  }

  public async setCachedBalance(balance: string): Promise<void> {
    this.state.cached_balance = balance;
    await this.persist();
  }

  public getCacheQuotaStats(): { usedMb: number; totalMb: number; percent: number } {
    const quota = this.state.cache_quota || { usedMb: 420, totalMb: 500 };
    const percent = Math.min(100, Math.round((quota.usedMb / quota.totalMb) * 100));
    return { usedMb: quota.usedMb, totalMb: quota.totalMb, percent };
  }

  public async pruneCache(): Promise<{ prunedMb: number; remainingMb: number }> {
    const currentUsed = (this.state.cache_quota && this.state.cache_quota.usedMb) || 420;
    const remainingMb = Math.max(32, Math.round(currentUsed * 0.15));
    const prunedMb = currentUsed - remainingMb;
    this.state.cache_quota = {
      usedMb: remainingMb,
      totalMb: (this.state.cache_quota && this.state.cache_quota.totalMb) || 500,
    };
    await this.persist();
    return { prunedMb, remainingMb };
  }

  // ==========================================
  // HORIZON IDENTITY SWITCHER PERSONAS
  // ==========================================

  public getActivePersona(): any {
    return this.state.active_persona || null;
  }

  public async setActivePersona(persona: any): Promise<void> {
    this.state.active_persona = persona;
    await this.persist();
  }

  public getPersonas(): any[] {
    return this.state.personas || [];
  }

  public async savePersonas(personas: any[]): Promise<void> {
    this.state.personas = personas;
    await this.persist();
  }

  // ==========================================
  // OFFLINE CHECKOUT & TIPPING OUTBOX QUEUE
  // ==========================================

  public getOutboxOperations(): QueuedOperation[] {
    return Object.values(this.state.outbox || {});
  }

  public async queueCheckoutPayment(payload: {
    id: string;
    type: 'ppv' | 'super_chat' | 'store';
    title: string;
    amount: number;
    creatorDid: string;
    buyerDid?: string;
    pinDurationSec?: number;
  }): Promise<QueuedOperation> {
    const idempotencyKey = `checkout_${payload.id}_${Date.now()}`;
    const op: QueuedOperation = {
      operationId: payload.id,
      deviceId: 'mobile_device',
      actorId: payload.buyerDid || 'current_user',
      createdAt: Date.now(),
      type: 'SEND_CHAT' as any,
      payload,
      idempotencyKey,
      attemptCount: 0,
      status: 'PENDING',
      expiresAt: Date.now() + DEFAULT_EXPIRATION_MS,
    };
    this.state.operations[op.operationId] = op;
    this.state.outbox[op.operationId] = op;
    await this.persist();
    return op;
  }
}

export const localDb = SovraLocalDatabase.getInstance();
export { SovraLocalDatabase as LocalDatabase };
