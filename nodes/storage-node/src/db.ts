import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { PinRecord, PinStatus, DeniedHashRecord, ComplianceReason } from './types.js';

interface RawPinRow {
  cid: string;
  pinned_at: number;
  expires_at: number | null;
  creator_did: string | null;
  target_replication: number;
  byte_size: number;
  status: string;
  replica_count: number;
  last_verified_at: number;
  child_cids_json: string;
}

interface RawDeniedHashRow {
  content_hash: string;
  cid: string | null;
  reason: string;
  takedown_notice_id: string | null;
  added_at: number;
  added_by: string;
  notes: string | null;
}

export class SqlitePinStore {
  private db: DatabaseSync;
  private readonly dbPath: string;

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.dbPath = path.join(storageDir, 'sovra-pins.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    // Enable WAL (Write-Ahead Logging) for high-concurrency and crash resilience
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS pins (
        cid TEXT PRIMARY KEY,
        pinned_at INTEGER NOT NULL,
        expires_at INTEGER,
        creator_did TEXT,
        target_replication INTEGER NOT NULL,
        byte_size INTEGER NOT NULL,
        status TEXT NOT NULL,
        replica_count INTEGER NOT NULL,
        last_verified_at INTEGER NOT NULL,
        child_cids_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);
      CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at);
      CREATE INDEX IF NOT EXISTS idx_pins_creator_did ON pins(creator_did);

      CREATE TABLE IF NOT EXISTS denied_hashes (
        content_hash TEXT PRIMARY KEY,
        cid TEXT,
        reason TEXT NOT NULL,
        takedown_notice_id TEXT,
        added_at INTEGER NOT NULL,
        added_by TEXT NOT NULL,
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_denied_cid ON denied_hashes(cid);
    `);
  }

  public upsertPin(pin: PinRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO pins (
        cid, pinned_at, expires_at, creator_did, target_replication,
        byte_size, status, replica_count, last_verified_at, child_cids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cid) DO UPDATE SET
        expires_at = excluded.expires_at,
        creator_did = excluded.creator_did,
        target_replication = excluded.target_replication,
        byte_size = excluded.byte_size,
        status = excluded.status,
        replica_count = excluded.replica_count,
        last_verified_at = excluded.last_verified_at,
        child_cids_json = excluded.child_cids_json
    `);

    stmt.run(
      pin.cid,
      pin.pinnedAt,
      pin.expiresAt ?? null,
      pin.creatorDid ?? null,
      pin.targetReplicationFactor,
      pin.byteSize,
      pin.status,
      pin.replicaCount,
      pin.lastVerifiedAt,
      JSON.stringify(pin.childCids),
    );
  }

  public getPin(cid: string): PinRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM pins WHERE cid = ?');
    const row = stmt.get(cid) as RawPinRow | undefined;
    if (!row) return undefined;
    return this.mapRowToPin(row);
  }

  public deletePin(cid: string): boolean {
    const stmt = this.db.prepare('DELETE FROM pins WHERE cid = ?');
    const res = stmt.run(cid);
    return res.changes > 0;
  }

  public listPins(filter?: { status?: PinStatus; creatorDid?: string }): PinRecord[] {
    let sql = 'SELECT * FROM pins';
    const params: (string | number | bigint | null)[] = [];
    const clauses: string[] = [];

    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.creatorDid) {
      clauses.push('creator_did = ?');
      params.push(filter.creatorDid);
    }

    if (clauses.length > 0) {
      sql += ' WHERE ' + clauses.join(' AND ');
    }
    sql += ' ORDER BY pinned_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as unknown as RawPinRow[];
    return rows.map(r => this.mapRowToPin(r));
  }

  public sweepExpiredPins(now: number): PinRecord[] {
    const findStmt = this.db.prepare(
      'SELECT * FROM pins WHERE expires_at IS NOT NULL AND expires_at <= ? AND status != ?',
    );
    const rows = findStmt.all(now, 'expired') as unknown as RawPinRow[];
    if (rows.length === 0) return [];

    const updateStmt = this.db.prepare('UPDATE pins SET status = ? WHERE cid = ?');
    for (const r of rows) {
      updateStmt.run('expired', r.cid);
    }

    return rows.map(r => ({ ...this.mapRowToPin(r), status: 'expired' as PinStatus }));
  }

  public getAllProtectedCids(): Set<string> {
    const stmt = this.db.prepare("SELECT cid, child_cids_json FROM pins WHERE status != 'expired'");
    const rows = stmt.all() as unknown as Array<{ cid: string; child_cids_json: string }>;
    const set = new Set<string>();

    for (const r of rows) {
      set.add(r.cid);
      try {
        const children: string[] = JSON.parse(r.child_cids_json);
        for (const ch of children) set.add(ch);
      } catch {}
    }
    return set;
  }

  public getAuthorAllocations(): Record<string, bigint> {
    const stmt = this.db.prepare(
      "SELECT creator_did, SUM(byte_size) as total_bytes FROM pins WHERE status != 'expired' AND creator_did IS NOT NULL GROUP BY creator_did",
    );
    const rows = stmt.all() as unknown as Array<{ creator_did: string; total_bytes: number }>;
    const result: Record<string, bigint> = {};
    for (const r of rows) {
      result[r.creator_did] = BigInt(r.total_bytes);
    }
    return result;
  }

  public getTotalPinnedBytes(): bigint {
    const stmt = this.db.prepare(
      "SELECT SUM(byte_size) as total_bytes FROM pins WHERE status != 'expired'",
    );
    const row = stmt.get() as { total_bytes: number | null } | undefined;
    return BigInt(row?.total_bytes ?? 0);
  }

  public updateVerification(cid: string, replicaCount: number, status: PinStatus, now: number): void {
    const stmt = this.db.prepare(
      'UPDATE pins SET replica_count = ?, status = ?, last_verified_at = ? WHERE cid = ?',
    );
    stmt.run(replicaCount, status, now, cid);
  }

  public upsertDeniedHash(record: DeniedHashRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO denied_hashes (
        content_hash, cid, reason, takedown_notice_id, added_at, added_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(content_hash) DO UPDATE SET
        cid = excluded.cid,
        reason = excluded.reason,
        takedown_notice_id = excluded.takedown_notice_id,
        added_at = excluded.added_at,
        added_by = excluded.added_by,
        notes = excluded.notes
    `);

    stmt.run(
      record.contentHash,
      record.cid ?? null,
      record.reason,
      record.takedownNoticeId ?? null,
      record.addedAt,
      record.addedBy,
      record.notes ?? null,
    );
  }

  public isHashDenied(contentHash: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM denied_hashes WHERE content_hash = ?');
    const row = stmt.get(contentHash);
    return row !== undefined;
  }

  public isCidDenied(cid: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM denied_hashes WHERE cid = ?');
    const row = stmt.get(cid);
    return row !== undefined;
  }

  public deleteDeniedHash(contentHash: string): boolean {
    const stmt = this.db.prepare('DELETE FROM denied_hashes WHERE content_hash = ?');
    const res = stmt.run(contentHash);
    return res.changes > 0;
  }

  public listDeniedHashes(): DeniedHashRecord[] {
    const stmt = this.db.prepare('SELECT * FROM denied_hashes ORDER BY added_at DESC');
    const rows = stmt.all() as unknown as RawDeniedHashRow[];
    return rows.map(r => ({
      contentHash: r.content_hash,
      cid: r.cid ?? undefined,
      reason: r.reason as ComplianceReason,
      takedownNoticeId: r.takedown_notice_id ?? undefined,
      addedAt: r.added_at,
      addedBy: r.added_by,
      notes: r.notes ?? undefined,
    }));
  }

  public close(): void {
    this.db.close();
  }

  private mapRowToPin(row: RawPinRow): PinRecord {
    let childCids: string[] = [];
    try {
      childCids = JSON.parse(row.child_cids_json);
    } catch {}

    return {
      cid: row.cid,
      pinnedAt: row.pinned_at,
      expiresAt: row.expires_at ?? undefined,
      creatorDid: row.creator_did ?? undefined,
      targetReplicationFactor: row.target_replication,
      byteSize: row.byte_size,
      status: row.status as PinStatus,
      replicaCount: row.replica_count,
      lastVerifiedAt: row.last_verified_at,
      childCids,
    };
  }
}
