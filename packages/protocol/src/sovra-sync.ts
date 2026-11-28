import { bytesToHex, canonicalCborEncode, hexToBytes, sha256, signEd25519, verifyEd25519 } from '@sovra/crypto';
import { InvalidEventError, SignatureVerificationFailedError } from './errors.js';
import { Result, err, ok } from '@sovra/shared';

const textEncoder = new TextEncoder();

export interface CausalDot {
  readonly actor: string;
  readonly counter: number;
}

function dotKey(d: CausalDot): string {
  return `${d.actor}:${d.counter}`;
}

/**
 * Add-Wins Observed-Remove Set (OR-Set) CRDT per Section 9.1 (tags, membership, reactions).
 */
export class ObservedRemoveSet<T extends string = string> {
  private readonly adds = new Map<T, Map<string, CausalDot>>();
  private readonly removedDots = new Set<string>();
  private readonly actorCounters = new Map<string, number>();

  public add(value: T, actor: string, explicitDot?: CausalDot): CausalDot {
    const next = (this.actorCounters.get(actor) ?? 0) + 1;
    const dot = explicitDot ?? { actor, counter: next };
    if (dot.counter > (this.actorCounters.get(dot.actor) ?? 0)) {
      this.actorCounters.set(dot.actor, dot.counter);
    }
    const dk = dotKey(dot);
    if (!this.removedDots.has(dk)) {
      let valDots = this.adds.get(value);
      if (!valDots) {
        valDots = new Map();
        this.adds.set(value, valDots);
      }
      valDots.set(dk, dot);
    }
    return dot;
  }

  public remove(value: T): readonly CausalDot[] {
    const valDots = this.adds.get(value);
    if (!valDots) return [];
    const removed = [...valDots.values()];
    for (const dk of valDots.keys()) {
      this.removedDots.add(dk);
    }
    this.adds.delete(value);
    return removed;
  }

  public has(value: T): boolean {
    const dots = this.adds.get(value);
    return !!dots && dots.size > 0;
  }

  public values(): T[] {
    return [...this.adds.keys()].sort();
  }

  public exportState(): { entries: Array<{ value: T; dots: CausalDot[] }>; removedDots: string[] } {
    const entries = [...this.adds.entries()].map(([value, dots]) => ({
      value,
      dots: [...dots.values()],
    }));
    return { entries, removedDots: [...this.removedDots].sort() };
  }

  public merge(remote: ObservedRemoveSet<T>): void {
    const remoteState = remote.exportState();
    for (const dk of remoteState.removedDots) {
      this.removedDots.add(dk);
    }
    for (const [value, dots] of this.adds.entries()) {
      for (const dk of dots.keys()) {
        if (this.removedDots.has(dk)) {
          dots.delete(dk);
        }
      }
      if (dots.size === 0) this.adds.delete(value);
    }
    for (const entry of remoteState.entries) {
      for (const dot of entry.dots) {
        const dk = dotKey(dot);
        if (this.removedDots.has(dk)) continue;
        let localDots = this.adds.get(entry.value);
        if (!localDots) {
          localDots = new Map();
          this.adds.set(entry.value, localDots);
        }
        localDots.set(dk, dot);
        if (dot.counter > (this.actorCounters.get(dot.actor) ?? 0)) {
          this.actorCounters.set(dot.actor, dot.counter);
        }
      }
    }
  }
}

/**
 * Shopping Cart & Tag Keyed OR-Map CRDT per Section 9.1.
 */
export class AuthorizedORMap {
  private readonly entries = new ObservedRemoveSet<string>();
  private readonly quantities = new Map<string, Map<string, number>>(); // itemKey -> actor -> quantity

  public setItemQuantity(itemKey: string, quantity: number, actor: string): void {
    if (quantity <= 0) {
      this.entries.remove(itemKey);
      return;
    }
    this.entries.add(itemKey, actor);
    let actorMap = this.quantities.get(itemKey);
    if (!actorMap) {
      actorMap = new Map();
      this.quantities.set(itemKey, actorMap);
    }
    actorMap.set(actor, quantity);
  }

  public removeItem(itemKey: string): void {
    this.entries.remove(itemKey);
  }

  public getActiveItems(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key of this.entries.values()) {
      const actorMap = this.quantities.get(key);
      let sum = 0;
      if (actorMap) {
        for (const q of actorMap.values()) sum += q;
      }
      if (sum > 0) result[key] = sum;
    }
    return result;
  }

  public merge(remote: AuthorizedORMap): void {
    this.entries.merge(remote.entries);
    for (const [key, rActors] of remote.quantities.entries()) {
      let lActors = this.quantities.get(key);
      if (!lActors) {
        lActors = new Map();
        this.quantities.set(key, lActors);
      }
      for (const [actor, qty] of rActors.entries()) {
        const prev = lActors.get(actor) ?? 0;
        if (qty !== prev) lActors.set(actor, Math.max(prev, qty));
      }
    }
  }
}

export interface RgaNode {
  readonly id: string; // `${lamport}:${actor}`
  readonly lamport: number;
  readonly actor: string;
  readonly afterId: string | null; // null = head
  readonly value: string;
  deleted: boolean;
}

/**
 * Replicated Growable Array (RGA) Sequence CRDT for collaborative text (Section 9.1).
 * Commutative, associative, idempotent convergence across arbitrary concurrent inserts & deletes.
 */
export class RgaSequenceCrdt {
  private readonly nodes = new Map<string, RgaNode>();
  private maxLamport = 0;

  private compareNodeOrder(a: RgaNode, b: RgaNode): number {
    if (a.lamport !== b.lamport) return b.lamport - a.lamport; // higher lamport sorts first right after parent
    return b.actor.localeCompare(a.actor);
  }

  public insert(afterId: string | null, value: string, actor: string): RgaNode {
    const lamport = ++this.maxLamport;
    const node: RgaNode = {
      id: `${lamport}:${actor}`,
      lamport,
      actor,
      afterId,
      value,
      deleted: false,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  public applyRemoteNode(node: RgaNode): void {
    if (node.lamport > this.maxLamport) this.maxLamport = node.lamport;
    const existing = this.nodes.get(node.id);
    if (existing) {
      if (node.deleted) existing.deleted = true;
      return;
    }
    this.nodes.set(node.id, { ...node });
  }

  public deleteNode(nodeId: string): boolean {
    const n = this.nodes.get(nodeId);
    if (!n) return false;
    n.deleted = true;
    return true;
  }

  public merge(remote: RgaSequenceCrdt): void {
    for (const n of remote.nodes.values()) {
      this.applyRemoteNode(n);
    }
  }

  public renderText(): string {
    const children = new Map<string | null, RgaNode[]>();
    for (const n of this.nodes.values()) {
      const key = n.afterId;
      let list = children.get(key);
      if (!list) {
        list = [];
        children.set(key, list);
      }
      list.push(n);
    }
    for (const list of children.values()) {
      list.sort((a, b) => this.compareNodeOrder(a, b));
    }

    const out: string[] = [];
    const visit = (parentId: string | null) => {
      const list = children.get(parentId) ?? [];
      for (const child of list) {
        if (!child.deleted) out.push(child.value);
        visit(child.id);
      }
    };
    visit(null);
    return out.join('');
  }
}

export interface SignedCrdtChange {
  readonly change_id: string;
  readonly document_id: string;
  readonly document_type: 'or-set' | 'rga-sequence' | 'or-map' | 'pn-counter';
  readonly actor_id: string;
  readonly lamport: number;
  readonly dependencies: readonly string[];
  readonly payload: Record<string, unknown>;
  readonly signature: string;
}

/**
 * Implements Section 17.6 Synchronization APIs (openDocument, applyChange, exchangeState, resolveConflict, getVersion)
 * with Ed25519 authorship verification per change.
 */
export class SovraDocumentSyncEngine {
  private readonly documents = new Map<
    string,
    {
      document_type: SignedCrdtChange['document_type'];
      changes: Map<string, SignedCrdtChange>;
      orSet?: ObservedRemoveSet<string>;
      rga?: RgaSequenceCrdt;
    }
  >();
  private readonly actorKeys = new Map<string, Uint8Array>();

  public registerActorPublicKey(actorId: string, publicKey: Uint8Array): void {
    this.actorKeys.set(actorId, publicKey);
  }

  public openDocument(documentId: string, documentType: SignedCrdtChange['document_type']): void {
    if (this.documents.has(documentId)) return;
    this.documents.set(documentId, {
      document_type: documentType,
      changes: new Map(),
      ...(documentType === 'or-set' ? { orSet: new ObservedRemoveSet<string>() } : {}),
      ...(documentType === 'rga-sequence' ? { rga: new RgaSequenceCrdt() } : {}),
    });
  }

  public static signChange(
    unsigned: Omit<SignedCrdtChange, 'change_id' | 'signature'>,
    signingPrivateKey: Uint8Array,
  ): SignedCrdtChange {
    const digest = sha256(
      new Uint8Array([
        ...textEncoder.encode('SOVRA-SYNC-CHG-v1'),
        ...canonicalCborEncode(unsigned),
      ]),
    );
    const change_id = bytesToHex(digest);
    const signature = bytesToHex(signEd25519(signingPrivateKey, digest));
    return { ...unsigned, change_id, signature };
  }

  public applyChange(
    documentId: string,
    change: SignedCrdtChange,
    actorPublicKey?: Uint8Array,
  ): Result<boolean, InvalidEventError | SignatureVerificationFailedError> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.document_type !== change.document_type) {
      return err(new InvalidEventError(`Unknown or mismatched CRDT document '${documentId}'`));
    }
    if (change.document_id !== documentId) {
      return err(new InvalidEventError('Change document_id mismatch'));
    }
    const pub = actorPublicKey ?? this.actorKeys.get(change.actor_id);
    if (!pub) {
      return err(new SignatureVerificationFailedError(`Missing public key for CRDT actor '${change.actor_id}'`));
    }
    const { change_id: _cid, signature: _sig, ...unsigned } = change;
    const expectedId = bytesToHex(
      sha256(
        new Uint8Array([
          ...textEncoder.encode('SOVRA-SYNC-CHG-v1'),
          ...canonicalCborEncode(unsigned),
        ]),
      ),
    );
    if (expectedId !== change.change_id) {
      return err(new InvalidEventError('CRDT change_id digest mismatch'));
    }
    if (!verifyEd25519(pub, hexToBytes(change.change_id), hexToBytes(change.signature))) {
      return err(new SignatureVerificationFailedError('Invalid CRDT change Ed25519 signature'));
    }
    if (doc.changes.has(change.change_id)) {
      return ok(false);
    }
    doc.changes.set(change.change_id, change);

    if (doc.orSet && change.document_type === 'or-set') {
      const op = String(change.payload['op'] || '');
      const val = String(change.payload['value'] || '');
      if (op === 'add') {
        doc.orSet.add(val, change.actor_id, { actor: change.actor_id, counter: change.lamport });
      } else if (op === 'remove') {
        doc.orSet.remove(val);
      }
    }
    if (doc.rga && change.document_type === 'rga-sequence') {
      const op = String(change.payload['op'] || '');
      if (op === 'insert') {
        doc.rga.applyRemoteNode({
          id: `${change.lamport}:${change.actor_id}`,
          lamport: change.lamport,
          actor: change.actor_id,
          afterId: (change.payload['afterId'] as string | null) ?? null,
          value: String(change.payload['value'] ?? ''),
          deleted: false,
        });
      } else if (op === 'delete') {
        doc.rga.deleteNode(String(change.payload['nodeId'] || ''));
      }
    }
    return ok(true);
  }

  public getVersion(documentId: string): { changeIds: string[]; stateHash: string } {
    const doc = this.documents.get(documentId);
    if (!doc) return { changeIds: [], stateHash: bytesToHex(sha256(new Uint8Array(0))) };
    const changeIds = [...doc.changes.keys()].sort();
    return {
      changeIds,
      stateHash: bytesToHex(sha256(canonicalCborEncode(this.resolveConflict(documentId)))),
    };
  }

  public exchangeState(
    documentId: string,
    remoteChangeIds: readonly string[],
  ): { missingOnRemote: SignedCrdtChange[] } {
    const doc = this.documents.get(documentId);
    if (!doc) return { missingOnRemote: [] };
    const remoteSet = new Set(remoteChangeIds);
    const missingOnRemote = [...doc.changes.values()].filter((c) => !remoteSet.has(c.change_id));
    return { missingOnRemote };
  }

  public resolveConflict(documentId: string): unknown {
    const doc = this.documents.get(documentId);
    if (!doc) return null;
    if (doc.orSet) return doc.orSet.values();
    if (doc.rga) return doc.rga.renderText();
    return [...doc.changes.keys()].sort();
  }
}
