/**
 * @file packages/protocol/src/replay.ts
 * Durable Replay Protection Store (Survives Process Restart).
 *
 * Enforces:
 * 1. Duplicate Event ID rejection.
 * 2. Reused Nonce rejection.
 * 3. Monotonic Sequence progression per (issuerDid, deviceId).
 * 4. Maximum clock skew / stale timestamp rejection.
 * 5. Atomic disk-backed persistence across restarts.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ReplayRecord {
  readonly eventId?: string | undefined;
  readonly issuerDid: string;
  readonly deviceId?: string | undefined;
  readonly nonce?: string | undefined;
  readonly sequence?: number | undefined;
  readonly timestamp: number;
  readonly nowSeconds?: number | undefined;
}

export interface ReplayCheckResult {
  readonly accepted: boolean;
  readonly error?: string | undefined;
}

export class DurableReplayStore {
  private readonly seenEvents = new Map<string, number>(); // eventId -> expiryTimestamp
  private readonly seenNonces = new Map<string, number>(); // `${issuerDid}:${nonce}` -> expiryTimestamp
  private readonly seenSequences = new Map<string, number>(); // `${issuerDid}:${deviceId}:${sequence}` -> expiryTimestamp
  private readonly sequenceMap = new Map<string, number>(); // `${issuerDid}:${deviceId}` -> lastSequence
  private readonly filePath: string | null;
  private readonly maxClockDriftSeconds: number;
  private readonly recordTtlSeconds: number;
  private readonly maxEntries: number;
  private readonly allowOutOfOrderSequences: boolean;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(options?: {
    filePath?: string | undefined;
    maxClockDriftSeconds?: number | undefined;
    recordTtlSeconds?: number | undefined;
    maxEntries?: number | undefined;
    autoPruneIntervalMs?: number | undefined;
    allowOutOfOrderSequences?: boolean | undefined;
  }) {
    this.filePath = options?.filePath ?? null;
    this.maxClockDriftSeconds = options?.maxClockDriftSeconds ?? 300; // 5 minutes
    this.recordTtlSeconds = options?.recordTtlSeconds ?? 3600; // 1 hour TTL
    this.maxEntries = options?.maxEntries ?? 50000;
    this.allowOutOfOrderSequences = options?.allowOutOfOrderSequences ?? false;

    const autoPruneMs = options?.autoPruneIntervalMs ?? 60000;
    if (autoPruneMs > 0) {
      this.pruneTimer = setInterval(() => {
        this.pruneExpired();
      }, autoPruneMs);
      this.pruneTimer.unref();
    }

    this.load();
  }

  /**
   * Loads persisted replay state from disk.
   */
  public load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const now = Math.floor(Date.now() / 1000);

      if (Array.isArray(data.seenEvents)) {
        for (const item of data.seenEvents) {
          if (item.expiresAt > now) {
            this.seenEvents.set(item.id, item.expiresAt);
          }
        }
      }

      if (Array.isArray(data.seenNonces)) {
        for (const item of data.seenNonces) {
          if (item.expiresAt > now) {
            this.seenNonces.set(item.key, item.expiresAt);
          }
        }
      }

      if (Array.isArray(data.seenSequences)) {
        for (const item of data.seenSequences) {
          if (item.expiresAt > now) {
            this.seenSequences.set(item.key, item.expiresAt);
          }
        }
      }

      if (data.sequences && typeof data.sequences === 'object') {
        for (const [k, v] of Object.entries(data.sequences)) {
          if (typeof v === 'number') {
            this.sequenceMap.set(k, v);
          }
        }
      }
    } catch {
      // Gracefully continue on corrupted file
    }
  }

  /**
   * Persists current active replay state to disk.
   */
  public save(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const payload = {
        seenEvents: Array.from(this.seenEvents.entries()).map(([id, expiresAt]) => ({ id, expiresAt })),
        seenNonces: Array.from(this.seenNonces.entries()).map(([key, expiresAt]) => ({ key, expiresAt })),
        seenSequences: Array.from(this.seenSequences.entries()).map(([key, expiresAt]) => ({ key, expiresAt })),
        sequences: Object.fromEntries(this.sequenceMap.entries()),
      };

      const tmp = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Disk persistence failure should not crash execution
    }
  }

  /**
   * Validates and idempotently records an incoming operation or event.
   * Rejects duplicates, reused nonces, stale timestamps, and invalid sequences.
   */
  public validateAndRecord(record: ReplayRecord): ReplayCheckResult {
    const now = record.nowSeconds ?? Math.floor(Date.now() / 1000);
    const eventTime = Math.floor(record.timestamp > 1e11 ? record.timestamp / 1000 : record.timestamp);

    // 1. Clock skew check
    if (Math.abs(now - eventTime) > this.maxClockDriftSeconds) {
      return {
        accepted: false,
        error: `Timestamp skew exceeded (${Math.abs(now - eventTime)}s drift > ${this.maxClockDriftSeconds}s allowed)`,
      };
    }

    // 2. Event ID check
    if (record.eventId) {
      if (this.seenEvents.has(record.eventId)) {
        return {
          accepted: false,
          error: `Duplicate event rejected: eventId '${record.eventId}' was already processed`,
        };
      }
    }

    // 3. Reused Nonce check
    if (record.nonce) {
      const nonceKey = `${record.issuerDid}:${record.nonce}`;
      if (this.seenNonces.has(nonceKey)) {
        return {
          accepted: false,
          error: `Reused nonce rejected: nonce '${record.nonce}' already consumed for issuer '${record.issuerDid}'`,
        };
      }
    }

    // 4. Sequence validation
    if (typeof record.sequence === 'number') {
      const devKey = `${record.issuerDid}:${record.deviceId || 'default'}`;
      const lastSeq = this.sequenceMap.get(devKey) ?? 0;
      if (this.allowOutOfOrderSequences) {
        const seqKey = `${devKey}:${record.sequence}`;
        if (this.seenSequences.has(seqKey)) {
          return {
            accepted: false,
            error: `Reused sequence rejected: sequence ${record.sequence} already consumed for '${devKey}'`,
          };
        }
      } else {
        if (record.sequence <= lastSeq) {
          return {
            accepted: false,
            error: `Stale sequence rejected: sequence ${record.sequence} <= latest processed sequence ${lastSeq}`,
          };
        }
      }
    }

    // Accept and record
    const expiresAt = now + this.recordTtlSeconds;
    if (record.eventId) {
      this.seenEvents.set(record.eventId, expiresAt);
    }
    if (record.nonce) {
      this.seenNonces.set(`${record.issuerDid}:${record.nonce}`, expiresAt);
    }
    if (typeof record.sequence === 'number') {
      const devKey = `${record.issuerDid}:${record.deviceId || 'default'}`;
      if (this.allowOutOfOrderSequences) {
        this.seenSequences.set(`${devKey}:${record.sequence}`, expiresAt);
        const lastSeq = this.sequenceMap.get(devKey) ?? 0;
        this.sequenceMap.set(devKey, Math.max(lastSeq, record.sequence));
      } else {
        this.sequenceMap.set(devKey, record.sequence);
      }
    }

    this.pruneExpired(now);
    this.enforceCapacityBounds();
    this.save();

    return { accepted: true };
  }

  /**
   * Enforces max memory bounds by evicting oldest recorded entries if limit is exceeded.
   */
  public enforceCapacityBounds(): void {
    while (this.seenEvents.size > this.maxEntries) {
      const first = this.seenEvents.keys().next().value;
      if (first) this.seenEvents.delete(first);
      else break;
    }
    while (this.seenNonces.size > this.maxEntries) {
      const first = this.seenNonces.keys().next().value;
      if (first) this.seenNonces.delete(first);
      else break;
    }
    while (this.seenSequences.size > this.maxEntries) {
      const first = this.seenSequences.keys().next().value;
      if (first) this.seenSequences.delete(first);
      else break;
    }
  }

  /**
   * Prunes records that have surpassed their TTL window.
   */
  public pruneExpired(now = Math.floor(Date.now() / 1000)): void {
    for (const [id, exp] of this.seenEvents.entries()) {
      if (exp <= now) this.seenEvents.delete(id);
    }
    for (const [key, exp] of this.seenNonces.entries()) {
      if (exp <= now) this.seenNonces.delete(key);
    }
    for (const [key, exp] of this.seenSequences.entries()) {
      if (exp <= now) this.seenSequences.delete(key);
    }
  }

  public hasEvent(eventId: string): boolean {
    return this.seenEvents.has(eventId);
  }

  public hasNonce(issuerDid: string, nonce: string): boolean {
    return this.seenNonces.has(`${issuerDid}:${nonce}`);
  }

  public stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  public close(): void {
    this.stop();
  }

  public clear(): void {
    this.seenEvents.clear();
    this.seenNonces.clear();
    this.sequenceMap.clear();
    this.stop();
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {}
    }
  }
}
