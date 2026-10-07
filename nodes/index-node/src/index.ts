/**
 * @file nodes/index-node/src/index.ts
 * Standalone Read-Optimized Query Indexer Daemon.
 */

import { Result, ok, err } from '@sovra/shared';

export interface IndexedEvent {
  readonly id: string;
  readonly issuerDid: string;
  readonly type: string;
  readonly tags?: readonly string[] | undefined;
  readonly timestamp: number;
  readonly payload: unknown;
}

export interface IndexQueryFilter {
  readonly issuerDid?: string | undefined;
  readonly type?: string | undefined;
  readonly tag?: string | undefined;
  readonly sinceTimestamp?: number | undefined;
  readonly limit?: number | undefined;
}

export interface IndexNodeConfig {
  readonly queryListenPort: number;
  readonly maxIndexedEvents: number;
}

export class IndexNodeDaemon {
  private readonly events = new Map<string, IndexedEvent>();
  private readonly issuerIndex = new Map<string, Set<string>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly typeIndex = new Map<string, Set<string>>();
  private _isRunning = false;

  constructor(private readonly config: IndexNodeConfig) {}

  public getConfig(): IndexNodeConfig {
    return this.config;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);
    this._isRunning = true;
    return ok(undefined);
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;
    return ok(undefined);
  }

  public indexEvent(event: IndexedEvent): Result<void> {
    if (!this._isRunning) {
      return err(new Error('Index node daemon is not running'));
    }

    // Prune oldest if capacity exceeded
    if (this.events.size >= this.config.maxIndexedEvents && !this.events.has(event.id)) {
      const oldestKey = this.events.keys().next().value;
      if (oldestKey) {
        this.removeEvent(oldestKey);
      }
    }

    this.events.set(event.id, event);

    // Update issuer index
    let issuerSet = this.issuerIndex.get(event.issuerDid);
    if (!issuerSet) {
      issuerSet = new Set();
      this.issuerIndex.set(event.issuerDid, issuerSet);
    }
    issuerSet.add(event.id);

    // Update type index
    let typeSet = this.typeIndex.get(event.type);
    if (!typeSet) {
      typeSet = new Set();
      this.typeIndex.set(event.type, typeSet);
    }
    typeSet.add(event.id);

    // Update tag index
    if (event.tags) {
      for (const tag of event.tags) {
        const cleanTag = tag.startsWith('#') ? tag.slice(1).toLowerCase() : tag.toLowerCase();
        let tagSet = this.tagIndex.get(cleanTag);
        if (!tagSet) {
          tagSet = new Set();
          this.tagIndex.set(cleanTag, tagSet);
        }
        tagSet.add(event.id);
      }
    }

    return ok(undefined);
  }

  public getEvent(id: string): IndexedEvent | undefined {
    return this.events.get(id);
  }

  public queryEvents(filter: IndexQueryFilter): readonly IndexedEvent[] {
    let candidateIds: Set<string> | null = null;

    if (filter.issuerDid) {
      const issuerSet = this.issuerIndex.get(filter.issuerDid) ?? new Set();
      candidateIds = new Set(issuerSet);
    }

    if (filter.type) {
      const typeSet = this.typeIndex.get(filter.type) ?? new Set();
      if (candidateIds === null) {
        candidateIds = new Set(typeSet);
      } else {
        candidateIds = new Set([...candidateIds].filter(id => typeSet.has(id)));
      }
    }

    if (filter.tag) {
      const cleanTag = filter.tag.startsWith('#') ? filter.tag.slice(1).toLowerCase() : filter.tag.toLowerCase();
      const tagSet = this.tagIndex.get(cleanTag) ?? new Set();
      if (candidateIds === null) {
        candidateIds = new Set(tagSet);
      } else {
        candidateIds = new Set([...candidateIds].filter(id => tagSet.has(id)));
      }
    }

    const matchedEvents: IndexedEvent[] = [];
    const sourceIds = candidateIds !== null ? candidateIds : this.events.keys();

    for (const id of sourceIds) {
      const evt = this.events.get(id);
      if (!evt) continue;

      if (filter.sinceTimestamp !== undefined && evt.timestamp < filter.sinceTimestamp) {
        continue;
      }

      matchedEvents.push(evt);
    }

    // Sort descending by timestamp
    matchedEvents.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.limit !== undefined && filter.limit > 0) {
      return matchedEvents.slice(0, filter.limit);
    }

    return matchedEvents;
  }

  public getIndexedCount(): number {
    return this.events.size;
  }

  private removeEvent(id: string): void {
    const evt = this.events.get(id);
    if (!evt) return;

    this.events.delete(id);
    this.issuerIndex.get(evt.issuerDid)?.delete(id);
    this.typeIndex.get(evt.type)?.delete(id);
    if (evt.tags) {
      for (const tag of evt.tags) {
        const cleanTag = tag.startsWith('#') ? tag.slice(1).toLowerCase() : tag.toLowerCase();
        this.tagIndex.get(cleanTag)?.delete(id);
      }
    }
  }
}
