import { bytesToHex, canonicalCborEncode, hexToBytes } from '@sovra/crypto';
import { StorageFailureError } from './errors.js';
import type { SovraSpecEvent } from './sovra-evt.js';

export const NODE_DB_SCHEMA_VERSION = 1;

export interface SqliteLikeStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteLikeDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteLikeStatement;
  close(): void;
}

const PART_K_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  identity_id TEXT PRIMARY KEY,
  public_key BLOB NOT NULL,
  key_epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  profile_event_id TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  device_public_key BLOB NOT NULL,
  authorization_event_id TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_identity ON devices (identity_id);

CREATE TABLE IF NOT EXISTS nodes (
  peer_id TEXT PRIMARY KEY,
  public_key BLOB NOT NULL,
  capabilities TEXT NOT NULL,
  protocol_versions TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  reachability TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  payload BLOB NOT NULL,
  signature BLOB NOT NULL,
  validation_status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_author_seq ON events (identity_id, device_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS event_references (
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  referenced_event_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  PRIMARY KEY (event_id, referenced_event_id, reference_type)
);
CREATE INDEX IF NOT EXISTS idx_event_refs_target ON event_references (referenced_event_id);

CREATE TABLE IF NOT EXISTS content_objects (
  cid TEXT PRIMARY KEY,
  codec TEXT NOT NULL,
  content_size INTEGER NOT NULL,
  encryption_status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  verified INTEGER NOT NULL CHECK (verified IN (0, 1))
);

CREATE TABLE IF NOT EXISTS content_providers (
  cid TEXT NOT NULL REFERENCES content_objects(cid) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES nodes(peer_id) ON DELETE CASCADE,
  advertised_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (cid, peer_id)
);

CREATE TABLE IF NOT EXISTS replication_jobs (
  job_id TEXT PRIMARY KEY,
  cid TEXT NOT NULL REFERENCES content_objects(cid) ON DELETE CASCADE,
  target_peer TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crdt_documents (
  document_id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL,
  current_snapshot_cid TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crdt_changes (
  change_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES crdt_documents(document_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  dependencies BLOB NOT NULL,
  change_payload BLOB NOT NULL,
  signature BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  encrypted_payload BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  delivery_status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS governance_proposals (
  proposal_id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  specification_cid TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_votes (
  vote_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES governance_proposals(proposal_id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  signature BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  event_signature BLOB NOT NULL
);

-- Rebuildable search/discovery index derived strictly from events
CREATE TABLE IF NOT EXISTS rebuildable_event_index (
  event_id TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export const PART_K_REQUIRED_TABLES = [
  'identities',
  'devices',
  'nodes',
  'events',
  'event_references',
  'content_objects',
  'content_providers',
  'replication_jobs',
  'crdt_documents',
  'crdt_changes',
  'messages',
  'governance_proposals',
  'governance_votes',
  'audit_events',
] as const;

/**
 * Local Node SQLite Store implementing exact Part K (Section 16.1-16.2) 14-table schema,
 * WAL mode, foreign keys, duplicate/conflict rejection, atomic rollbacks, and rebuildable indexes.
 */
export class SovraNodeSqliteDatabase {
  private db: SqliteLikeDatabase | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string, preOpenedDb?: SqliteLikeDatabase) {
    this.dbPath = dbPath;
    if (preOpenedDb) {
      this.db = preOpenedDb;
      this.applySchema();
    }
  }

  public async open(): Promise<void> {
    if (this.db) return;
    const sqliteSpec = ['node', 'sqlite'].join(':');
    const sqliteMod = (await import(sqliteSpec)) as { DatabaseSync: new (p: string) => SqliteLikeDatabase };
    this.db = new sqliteMod.DatabaseSync(this.dbPath);
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    }
    this.applySchema();
  }

  private getDb(): SqliteLikeDatabase {
    if (!this.db) {
      throw new StorageFailureError('SovraNodeSqliteDatabase not opened yet; call open() first');
    }
    return this.db;
  }

  private applySchema(): void {
    const db = this.getDb();
    db.exec(PART_K_DDL);
    const existing = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(NODE_DB_SCHEMA_VERSION);
    if (!existing) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        NODE_DB_SCHEMA_VERSION,
        Math.floor(Date.now() / 1000),
      );
    }
  }

  public runInTransaction<T>(fn: () => T): T {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }

  public listTables(): string[] {
    const rows = this.getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
      .all();
    return rows.map((r) => String(r['name']));
  }

  public getSchemaVersion(): number {
    const row = this.getDb().prepare('SELECT MAX(version) as v FROM schema_migrations').get();
    return Number(row?.['v'] ?? 0);
  }

  public upsertIdentity(row: {
    identity_id: string;
    public_key: Uint8Array;
    key_epoch: number;
    created_at: number;
    status: string;
    profile_event_id?: string | null | undefined;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO identities (identity_id, public_key, key_epoch, created_at, status, profile_event_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(identity_id) DO UPDATE SET
           public_key = excluded.public_key,
           key_epoch = excluded.key_epoch,
           status = excluded.status,
           profile_event_id = COALESCE(excluded.profile_event_id, identities.profile_event_id)`,
      )
      .run(
        row.identity_id,
        row.public_key,
        row.key_epoch,
        row.created_at,
        row.status,
        row.profile_event_id ?? null,
      );
  }

  public upsertDevice(row: {
    device_id: string;
    identity_id: string;
    device_public_key: Uint8Array;
    authorization_event_id?: string | null | undefined;
    created_at: number;
    revoked_at?: number | null | undefined;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO devices (device_id, identity_id, device_public_key, authorization_event_id, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           revoked_at = COALESCE(excluded.revoked_at, devices.revoked_at)`,
      )
      .run(
        row.device_id,
        row.identity_id,
        row.device_public_key,
        row.authorization_event_id ?? null,
        row.created_at,
        row.revoked_at ?? null,
      );
  }

  public upsertNode(row: {
    peer_id: string;
    public_key: Uint8Array;
    capabilities: readonly string[];
    protocol_versions: Record<string, string>;
    last_seen: number;
    reachability: string;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO nodes (peer_id, public_key, capabilities, protocol_versions, last_seen, reachability)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           capabilities = excluded.capabilities,
           protocol_versions = excluded.protocol_versions,
           last_seen = excluded.last_seen,
           reachability = excluded.reachability`,
      )
      .run(
        row.peer_id,
        row.public_key,
        JSON.stringify(row.capabilities),
        JSON.stringify(row.protocol_versions),
        row.last_seen,
        row.reachability,
      );
  }

  /**
   * Stores a validated SovraSpecEvent atomically with references.
   * Rejects duplicate event_ids when signature or payload conflicts; idempotent when identical.
   */
  public insertEvent<T>(
    event: SovraSpecEvent<T>,
    validationStatus = 'ACCEPTED',
  ): { inserted: boolean; duplicate: boolean } {
    const db = this.getDb();
    const existing = db
      .prepare('SELECT signature, payload FROM events WHERE event_id = ?')
      .get(event.event_id);
    const encodedPayload = canonicalCborEncode(event.payload);
    const sigBytes = hexToBytes(event.signature);

    if (existing) {
      const existingSig = bytesToHex(existing['signature'] as Uint8Array);
      const existingPayloadHex = bytesToHex(existing['payload'] as Uint8Array);
      if (existingSig !== event.signature || existingPayloadHex !== bytesToHex(encodedPayload)) {
        throw new StorageFailureError(`Duplicate event_id '${event.event_id}' with conflicting signature or payload`);
      }
      return { inserted: false, duplicate: true };
    }

    return this.runInTransaction(() => {
      db.prepare(
        `INSERT INTO events (event_id, identity_id, device_id, event_type, sequence, created_at, payload, signature, validation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.event_id,
        event.identity_id,
        event.device_id,
        event.event_type,
        event.sequence,
        event.created_at,
        encodedPayload,
        sigBytes,
        validationStatus,
      );

      for (const refId of event.references) {
        db.prepare(
          `INSERT OR IGNORE INTO event_references (event_id, referenced_event_id, reference_type)
           VALUES (?, ?, ?)`,
        ).run(event.event_id, refId, event.event_type === 'social.delete' ? 'tombstone' : 'parent');
      }

      db.prepare(
        `INSERT INTO rebuildable_event_index (event_id, identity_id, event_type, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(event.event_id, event.identity_id, event.event_type, event.created_at);

      return { inserted: true, duplicate: false };
    });
  }

  public getEvent(eventId: string): Record<string, unknown> | undefined {
    return this.getDb().prepare('SELECT * FROM events WHERE event_id = ?').get(eventId);
  }

  public upsertContentObject(row: {
    cid: string;
    codec: string;
    content_size: number;
    encryption_status: string;
    created_at: number;
    verified: boolean;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO content_objects (cid, codec, content_size, encryption_status, created_at, verified)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cid) DO UPDATE SET verified = excluded.verified`,
      )
      .run(
        row.cid,
        row.codec,
        row.content_size,
        row.encryption_status,
        row.created_at,
        row.verified ? 1 : 0,
      );
  }

  public insertContentProvider(row: {
    cid: string;
    peer_id: string;
    advertised_at: number;
    expires_at: number;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO content_providers (cid, peer_id, advertised_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cid, peer_id) DO UPDATE SET advertised_at = excluded.advertised_at, expires_at = excluded.expires_at`,
      )
      .run(row.cid, row.peer_id, row.advertised_at, row.expires_at);
  }

  public insertReplicationJob(row: {
    job_id: string;
    cid: string;
    target_peer: string;
    status: string;
    attempts: number;
    created_at: number;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO replication_jobs (job_id, cid, target_peer, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, attempts = excluded.attempts`,
      )
      .run(row.job_id, row.cid, row.target_peer, row.status, row.attempts, row.created_at);
  }

  public upsertCrdtDocument(row: {
    document_id: string;
    document_type: string;
    document_version: string;
    current_snapshot_cid?: string | null | undefined;
    updated_at: number;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO crdt_documents (document_id, document_type, document_version, current_snapshot_cid, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET
           document_version = excluded.document_version,
           current_snapshot_cid = COALESCE(excluded.current_snapshot_cid, crdt_documents.current_snapshot_cid),
           updated_at = excluded.updated_at`,
      )
      .run(
        row.document_id,
        row.document_type,
        row.document_version,
        row.current_snapshot_cid ?? null,
        row.updated_at,
      );
  }

  public insertCrdtChange(row: {
    change_id: string;
    document_id: string;
    actor_id: string;
    dependencies: Uint8Array;
    change_payload: Uint8Array;
    signature: Uint8Array;
  }): void {
    this.getDb()
      .prepare(
        `INSERT OR IGNORE INTO crdt_changes (change_id, document_id, actor_id, dependencies, change_payload, signature)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.change_id, row.document_id, row.actor_id, row.dependencies, row.change_payload, row.signature);
  }

  public upsertMessage(row: {
    message_id: string;
    sender_id: string;
    recipient_id: string;
    encrypted_payload: Uint8Array;
    created_at: number;
    delivery_status: string;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO messages (message_id, sender_id, recipient_id, encrypted_payload, created_at, delivery_status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET delivery_status = excluded.delivery_status`,
      )
      .run(row.message_id, row.sender_id, row.recipient_id, row.encrypted_payload, row.created_at, row.delivery_status);
  }

  public upsertGovernanceProposal(row: {
    proposal_id: string;
    author_id: string;
    proposal_type: string;
    specification_cid: string;
    status: string;
    created_at: number;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO governance_proposals (proposal_id, author_id, proposal_type, specification_cid, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id) DO UPDATE SET status = excluded.status`,
      )
      .run(row.proposal_id, row.author_id, row.proposal_type, row.specification_cid, row.status, row.created_at);
  }

  public insertGovernanceVote(row: {
    vote_id: string;
    proposal_id: string;
    voter_id: string;
    decision: string;
    signature: Uint8Array;
    created_at: number;
  }): void {
    this.getDb()
      .prepare(
        `INSERT OR REPLACE INTO governance_votes (vote_id, proposal_id, voter_id, decision, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.vote_id, row.proposal_id, row.voter_id, row.decision, row.signature, row.created_at);
  }

  public insertAuditEvent(row: {
    audit_id: string;
    actor_id: string;
    action: string;
    object_id: string;
    timestamp: number;
    event_signature: Uint8Array;
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO audit_events (audit_id, actor_id, action, object_id, timestamp, event_signature)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.audit_id, row.actor_id, row.action, row.object_id, row.timestamp, row.event_signature);
  }

  /**
   * Rebuilds derived local search indexes solely from canonical persisted events.
   */
  public rebuildDerivedIndexes(): number {
    return this.runInTransaction(() => {
      const db = this.getDb();
      db.exec('DELETE FROM rebuildable_event_index');
      const res = db
        .prepare(
          `INSERT INTO rebuildable_event_index (event_id, identity_id, event_type, created_at)
           SELECT event_id, identity_id, event_type, created_at FROM events`,
        )
        .run();
      return Number(res.changes);
    });
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
