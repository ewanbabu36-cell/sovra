import { Result, ok, err } from '@sovra/shared';
import { SovraEvent, EventKind, verifySignedSovraEvent } from '@sovra/protocol';
import {
  SocialGraphEngine,
  SocialGraphState,
  FollowPayload,
  BlockPayload,
  MutePayload,
  ReactionPayload,
} from './types.js';

interface FollowOp {
  readonly createdAt: number;
  readonly eventId: string;
  readonly active: boolean;
}

interface BlockOp {
  readonly createdAt: number;
  readonly eventId: string;
  readonly active: boolean;
  readonly reason?: string | undefined;
}

interface MuteOp {
  readonly createdAt: number;
  readonly eventId: string;
  readonly active: boolean;
  readonly expiresAt?: number | undefined;
}

interface ReactionOp {
  readonly targetEventId: string;
  readonly authorPubkey: string;
  readonly emoji: string;
  readonly createdAt: number;
  readonly eventId: string;
  readonly active: boolean;
}

export interface SocialGraphEngineOptions {
  readonly dbPath?: string | undefined;
  readonly strictSignatureVerification?: boolean | undefined;
}

/**
 * High-performance, decentralized Social Graph Engine.
 * Implements standard CRDT Last-Write-Wins (LWW) conflict resolution with tombstones,
 * cryptographic signature validation, local edge blocking, and ACID SQLite persistence.
 */
export class DefaultSocialGraphEngine implements SocialGraphEngine {
  private readonly followOps = new Map<string, Map<string, FollowOp>>();
  private readonly blockOps = new Map<string, Map<string, BlockOp>>();
  private readonly muteOps = new Map<string, Map<string, MuteOp>>();
  private readonly reactionOps = new Map<string, Map<string, ReactionOp>>();
  private sqliteDb: any = null;
  private readonly strictSignatures: boolean;

  constructor(options: SocialGraphEngineOptions = {}) {
    this.strictSignatures = options.strictSignatureVerification ?? true;
    if (options.dbPath) {
      this.initSqlite(options.dbPath);
    }
  }

  private initSqlite(dbPath: string): void {
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.sqliteDb = new DatabaseSync(dbPath);
      this.sqliteDb.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS social_follows (
          follower_pubkey TEXT NOT NULL,
          target_pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          is_active INTEGER NOT NULL,
          event_id TEXT NOT NULL,
          PRIMARY KEY (follower_pubkey, target_pubkey)
        );

        CREATE TABLE IF NOT EXISTS social_blocks (
          user_pubkey TEXT NOT NULL,
          target_pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          is_active INTEGER NOT NULL,
          reason TEXT,
          event_id TEXT NOT NULL,
          PRIMARY KEY (user_pubkey, target_pubkey)
        );

        CREATE TABLE IF NOT EXISTS social_mutes (
          user_pubkey TEXT NOT NULL,
          target_pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          is_active INTEGER NOT NULL,
          expires_at INTEGER,
          event_id TEXT NOT NULL,
          PRIMARY KEY (user_pubkey, target_pubkey)
        );

        CREATE TABLE IF NOT EXISTS social_reactions (
          target_event_id TEXT NOT NULL,
          author_pubkey TEXT NOT NULL,
          emoji TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          is_active INTEGER NOT NULL,
          event_id TEXT NOT NULL,
          PRIMARY KEY (target_event_id, author_pubkey, emoji)
        );
      `);

      this.loadFromSqlite();
    } catch {
      this.sqliteDb = null;
    }
  }

  private loadFromSqlite(): void {
    if (!this.sqliteDb) return;

    const follows = this.sqliteDb.prepare('SELECT * FROM social_follows').all();
    for (const row of follows as any[]) {
      this.setFollowOpMemory(row.follower_pubkey, row.target_pubkey, {
        createdAt: row.created_at,
        eventId: row.event_id,
        active: Boolean(row.is_active),
      });
    }

    const blocks = this.sqliteDb.prepare('SELECT * FROM social_blocks').all();
    for (const row of blocks as any[]) {
      this.setBlockOpMemory(row.user_pubkey, row.target_pubkey, {
        createdAt: row.created_at,
        eventId: row.event_id,
        active: Boolean(row.is_active),
        reason: row.reason ?? undefined,
      });
    }

    const mutes = this.sqliteDb.prepare('SELECT * FROM social_mutes').all();
    for (const row of mutes as any[]) {
      this.setMuteOpMemory(row.user_pubkey, row.target_pubkey, {
        createdAt: row.created_at,
        eventId: row.event_id,
        active: Boolean(row.is_active),
        expiresAt: row.expires_at ?? undefined,
      });
    }

    const reactions = this.sqliteDb.prepare('SELECT * FROM social_reactions').all();
    for (const row of reactions as any[]) {
      this.setReactionOpMemory({
        targetEventId: row.target_event_id,
        authorPubkey: row.author_pubkey,
        emoji: row.emoji,
        createdAt: row.created_at,
        eventId: row.event_id,
        active: Boolean(row.is_active),
      });
    }
  }

  public async processEvent(event: SovraEvent): Promise<Result<void>> {
    if (this.strictSignatures) {
      const isValid = verifySignedSovraEvent(event);
      if (!isValid) {
        return err(new Error(`Invalid cryptographic signature for event ${event.id}`));
      }
    }

    switch (event.kind) {
      case EventKind.Follow:
        return this.processFollowEvent(event);
      case EventKind.Block:
        return this.processBlockEvent(event);
      case EventKind.Mute:
        return this.processMuteEvent(event);
      case EventKind.Reaction:
        return this.processReactionEvent(event);
      case EventKind.ModerationAssertion:
        return this.processModerationAssertion(event);
      default:
        return ok(undefined);
    }
  }

  private processFollowEvent(event: SovraEvent): Result<void> {
    const payload = this.extractFollowPayload(event);
    if (!payload) {
      return err(new Error(`Malformed Follow event content in ${event.id}`));
    }

    const author = event.pubkey;
    const target = payload.targetPubkey;

    // Cannot follow someone if blocked
    if (this.isBlocked(author, target)) {
      return ok(undefined);
    }

    const existing = this.getFollowOp(author, target);
    if (existing && this.isSuperseded(existing.createdAt, existing.eventId, event.createdAt, event.id)) {
      return ok(undefined); // Stale event ignored per LWW
    }

    const op: FollowOp = {
      createdAt: event.createdAt,
      eventId: event.id,
      active: !payload.isUnfollow,
    };

    this.setFollowOpMemory(author, target, op);

    if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO social_follows (follower_pubkey, target_pubkey, created_at, is_active, event_id)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(follower_pubkey, target_pubkey) DO UPDATE SET
             created_at = excluded.created_at,
             is_active = excluded.is_active,
             event_id = excluded.event_id`,
        )
        .run(author, target, event.createdAt, op.active ? 1 : 0, event.id);
    }

    return ok(undefined);
  }

  private processBlockEvent(event: SovraEvent): Result<void> {
    const payload = this.extractBlockPayload(event);
    if (!payload) {
      return err(new Error(`Malformed Block event content in ${event.id}`));
    }

    const author = event.pubkey;
    const target = payload.targetPubkey;

    const existing = this.getBlockOp(author, target);
    if (existing && this.isSuperseded(existing.createdAt, existing.eventId, event.createdAt, event.id)) {
      return ok(undefined);
    }

    const op: BlockOp = {
      createdAt: event.createdAt,
      eventId: event.id,
      active: !payload.isUnblock,
      reason: payload.reason,
    };

    this.setBlockOpMemory(author, target, op);

    if (op.active) {
      // Blocking immediately severs follow relationship
      const followTombstone: FollowOp = {
        createdAt: event.createdAt,
        eventId: event.id,
        active: false,
      };
      this.setFollowOpMemory(author, target, followTombstone);

      if (this.sqliteDb) {
        this.sqliteDb
          .prepare(
            `INSERT INTO social_follows (follower_pubkey, target_pubkey, created_at, is_active, event_id)
             VALUES (?, ?, ?, 0, ?)
             ON CONFLICT(follower_pubkey, target_pubkey) DO UPDATE SET
               created_at = excluded.created_at,
               is_active = 0,
               event_id = excluded.event_id`,
          )
          .run(author, target, event.createdAt, event.id);
      }
    }

    if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO social_blocks (user_pubkey, target_pubkey, created_at, is_active, reason, event_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_pubkey, target_pubkey) DO UPDATE SET
             created_at = excluded.created_at,
             is_active = excluded.is_active,
             reason = excluded.reason,
             event_id = excluded.event_id`,
        )
        .run(author, target, event.createdAt, op.active ? 1 : 0, payload.reason ?? null, event.id);
    }

    return ok(undefined);
  }

  private processMuteEvent(event: SovraEvent): Result<void> {
    const payload = this.extractMutePayload(event);
    if (!payload) {
      return err(new Error(`Malformed Mute event content in ${event.id}`));
    }

    const author = event.pubkey;
    const target = payload.targetPubkey;

    const existing = this.getMuteOp(author, target);
    if (existing && this.isSuperseded(existing.createdAt, existing.eventId, event.createdAt, event.id)) {
      return ok(undefined);
    }

    const expiresAt = payload.durationSeconds && payload.durationSeconds > 0
      ? event.createdAt + payload.durationSeconds
      : undefined;

    const op: MuteOp = {
      createdAt: event.createdAt,
      eventId: event.id,
      active: !payload.isUnmute,
      expiresAt,
    };

    this.setMuteOpMemory(author, target, op);

    if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO social_mutes (user_pubkey, target_pubkey, created_at, is_active, expires_at, event_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_pubkey, target_pubkey) DO UPDATE SET
             created_at = excluded.created_at,
             is_active = excluded.is_active,
             expires_at = excluded.expires_at,
             event_id = excluded.event_id`,
        )
        .run(author, target, event.createdAt, op.active ? 1 : 0, expiresAt ?? null, event.id);
    }

    return ok(undefined);
  }

  private processReactionEvent(event: SovraEvent): Result<void> {
    const payload = this.extractReactionPayload(event);
    if (!payload) {
      return err(new Error(`Malformed Reaction event in ${event.id}`));
    }

    const author = event.pubkey;
    const targetEventId = payload.targetEventId;
    const emoji = payload.emoji;

    const existing = this.getReactionOp(targetEventId, author, emoji);
    if (existing && this.isSuperseded(existing.createdAt, existing.eventId, event.createdAt, event.id)) {
      return ok(undefined);
    }

    const op: ReactionOp = {
      targetEventId,
      authorPubkey: author,
      emoji,
      createdAt: event.createdAt,
      eventId: event.id,
      active: !payload.isRetraction,
    };

    this.setReactionOpMemory(op);

    if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO social_reactions (target_event_id, author_pubkey, emoji, created_at, is_active, event_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(target_event_id, author_pubkey, emoji) DO UPDATE SET
             created_at = excluded.created_at,
             is_active = excluded.is_active,
             event_id = excluded.event_id`,
        )
        .run(targetEventId, author, emoji, event.createdAt, op.active ? 1 : 0, event.id);
    }

    return ok(undefined);
  }

  private processModerationAssertion(event: SovraEvent): Result<void> {
    const actionTag = event.tags.find(t => t[0] === 'action');
    const pTag = event.tags.find(t => t[0] === 'p');

    if (pTag && actionTag) {
      const action = actionTag[1];
      const target = pTag[1];
      if (!target) return ok(undefined);

      if (action === 'block') {
        return this.processBlockEvent({
          ...event,
          kind: EventKind.Block,
          content: JSON.stringify({ targetPubkey: target, isUnblock: false }),
        });
      } else if (action === 'unblock') {
        return this.processBlockEvent({
          ...event,
          kind: EventKind.Block,
          content: JSON.stringify({ targetPubkey: target, isUnblock: true }),
        });
      } else if (action === 'mute') {
        return this.processMuteEvent({
          ...event,
          kind: EventKind.Mute,
          content: JSON.stringify({ targetPubkey: target, isUnmute: false }),
        });
      } else if (action === 'unmute') {
        return this.processMuteEvent({
          ...event,
          kind: EventKind.Mute,
          content: JSON.stringify({ targetPubkey: target, isUnmute: true }),
        });
      }
    }

    return ok(undefined);
  }

  // --- Extractors ---
  private extractFollowPayload(event: SovraEvent): FollowPayload | null {
    if (typeof event.content === 'object' && event.content !== null) {
      return event.content as unknown as FollowPayload;
    }
    if (typeof event.content === 'string' && event.content.startsWith('{')) {
      try {
        return JSON.parse(event.content);
      } catch {}
    }
    const pTag = event.tags.find(t => t[0] === 'p');
    if (pTag && pTag[1]) {
      const actionTag = event.tags.find(t => t[0] === 'action');
      return {
        targetPubkey: pTag[1],
        isUnfollow: actionTag?.[1] === 'unfollow',
      };
    }
    return null;
  }

  private extractBlockPayload(event: SovraEvent): BlockPayload | null {
    if (typeof event.content === 'object' && event.content !== null) {
      return event.content as unknown as BlockPayload;
    }
    if (typeof event.content === 'string' && event.content.startsWith('{')) {
      try {
        return JSON.parse(event.content);
      } catch {}
    }
    const pTag = event.tags.find(t => t[0] === 'p');
    if (pTag && pTag[1]) {
      const actionTag = event.tags.find(t => t[0] === 'action');
      return {
        targetPubkey: pTag[1],
        isUnblock: actionTag?.[1] === 'unblock',
      };
    }
    return null;
  }

  private extractMutePayload(event: SovraEvent): MutePayload | null {
    if (typeof event.content === 'object' && event.content !== null) {
      return event.content as unknown as MutePayload;
    }
    if (typeof event.content === 'string' && event.content.startsWith('{')) {
      try {
        return JSON.parse(event.content);
      } catch {}
    }
    const pTag = event.tags.find(t => t[0] === 'p');
    if (pTag && pTag[1]) {
      const actionTag = event.tags.find(t => t[0] === 'action');
      return {
        targetPubkey: pTag[1],
        isUnmute: actionTag?.[1] === 'unmute',
      };
    }
    return null;
  }

  private extractReactionPayload(event: SovraEvent): ReactionPayload | null {
    if (typeof event.content === 'object' && event.content !== null) {
      return event.content as unknown as ReactionPayload;
    }
    if (typeof event.content === 'string' && event.content.startsWith('{')) {
      try {
        return JSON.parse(event.content);
      } catch {}
    }
    const eTag = event.tags.find(t => t[0] === 'e');
    if (eTag && eTag[1]) {
      const actionTag = event.tags.find(t => t[0] === 'action');
      const emojiTag = event.tags.find(t => t[0] === 'emoji');
      return {
        targetEventId: eTag[1],
        emoji: emojiTag?.[1] ?? (typeof event.content === 'string' ? event.content : '❤️'),
        isRetraction: actionTag?.[1] === 'retract',
      };
    }
    return null;
  }

  // --- LWW Conflict Resolution Helper ---
  private isSuperseded(
    existingCreatedAt: number,
    existingId: string,
    newCreatedAt: number,
    newId: string,
  ): boolean {
    if (existingCreatedAt > newCreatedAt) return true;
    if (existingCreatedAt === newCreatedAt && existingId.localeCompare(newId) >= 0) return true;
    return false;
  }

  // --- In-Memory Operations ---
  private setFollowOpMemory(follower: string, target: string, op: FollowOp): void {
    let map = this.followOps.get(follower);
    if (!map) {
      map = new Map();
      this.followOps.set(follower, map);
    }
    map.set(target, op);
  }

  private getFollowOp(follower: string, target: string): FollowOp | undefined {
    return this.followOps.get(follower)?.get(target);
  }

  private setBlockOpMemory(user: string, target: string, op: BlockOp): void {
    let map = this.blockOps.get(user);
    if (!map) {
      map = new Map();
      this.blockOps.set(user, map);
    }
    map.set(target, op);
  }

  private getBlockOp(user: string, target: string): BlockOp | undefined {
    return this.blockOps.get(user)?.get(target);
  }

  private setMuteOpMemory(user: string, target: string, op: MuteOp): void {
    let map = this.muteOps.get(user);
    if (!map) {
      map = new Map();
      this.muteOps.set(user, map);
    }
    map.set(target, op);
  }

  private getMuteOp(user: string, target: string): MuteOp | undefined {
    return this.muteOps.get(user)?.get(target);
  }

  private setReactionOpMemory(op: ReactionOp): void {
    let map = this.reactionOps.get(op.targetEventId);
    if (!map) {
      map = new Map();
      this.reactionOps.set(op.targetEventId, map);
    }
    const key = `${op.authorPubkey}:${op.emoji}`;
    map.set(key, op);
  }

  private getReactionOp(targetEventId: string, author: string, emoji: string): ReactionOp | undefined {
    return this.reactionOps.get(targetEventId)?.get(`${author}:${emoji}`);
  }

  // --- Public Query API ---
  public isFollowing(followerPubkey: string, targetPubkey: string): boolean {
    return this.getFollowOp(followerPubkey, targetPubkey)?.active ?? false;
  }

  public isBlocked(userPubkey: string, targetPubkey: string): boolean {
    return this.getBlockOp(userPubkey, targetPubkey)?.active ?? false;
  }

  public isMuted(userPubkey: string, targetPubkey: string): boolean {
    const op = this.getMuteOp(userPubkey, targetPubkey);
    if (!op || !op.active) return false;
    if (op.expiresAt && op.expiresAt < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  }

  public getFollowing(userPubkey: string): readonly string[] {
    const map = this.followOps.get(userPubkey);
    if (!map) return [];
    const active: string[] = [];
    for (const [target, op] of map.entries()) {
      if (op.active) active.push(target);
    }
    return active;
  }

  public getMutedUsers(userPubkey: string): readonly string[] {
    const map = this.muteOps.get(userPubkey);
    if (!map) return [];
    const now = Math.floor(Date.now() / 1000);
    const valid: string[] = [];
    for (const [target, op] of map.entries()) {
      if (op.active && (!op.expiresAt || op.expiresAt >= now)) {
        valid.push(target);
      }
    }
    return valid;
  }

  public getBlockedUsers(userPubkey: string): readonly string[] {
    const map = this.blockOps.get(userPubkey);
    if (!map) return [];
    const active: string[] = [];
    for (const [target, op] of map.entries()) {
      if (op.active) active.push(target);
    }
    return active;
  }

  public getReactions(targetEventId: string): readonly { targetEventId: string; authorPubkey: string; emoji: string; createdAt: number; eventId: string }[] {
    const map = this.reactionOps.get(targetEventId);
    if (!map) return [];
    const active: ReactionOp[] = [];
    for (const op of map.values()) {
      if (op.active) active.push(op);
    }
    return active;
  }

  public getState(userPubkey: string): SocialGraphState {
    const followingSet = new Set(this.getFollowing(userPubkey));
    const blockedSet = new Set(this.getBlockedUsers(userPubkey));
    const mutedSet = new Set(this.getMutedUsers(userPubkey));
    const joinedCommunities = new Set<string>();

    return {
      pubkey: userPubkey,
      followingSet,
      blockedSet,
      mutedSet,
      joinedCommunities,
    };
  }

  public close(): void {
    if (this.sqliteDb) {
      try {
        this.sqliteDb.close();
      } catch {}
      this.sqliteDb = null;
    }
  }
}
