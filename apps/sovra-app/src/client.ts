/**
 * @file apps/sovra-app/src/client.ts
 * Sovra Modular Light Client & Local-First IndexedDB CRDT Engine.
 */

import { Result, ok } from '@sovra/shared';
import { PublicIdentity, SovraDeviceKey } from '@sovra/identity';
import { SovraLightClient } from '@sovra/p2p';

export interface DeviceScreenTimeLimits {
  readonly dailyAppLimitMinutes: number;
  readonly feedLimitMinutes: number;
  readonly shortVideoLimitMinutes: number;
  readonly exploreLimitMinutes: number;
  readonly quietHoursEnabled: boolean;
  readonly quietHoursStart: string; // "22:00"
  readonly quietHoursEnd: string; // "07:00"
}

export interface SovraClientState {
  readonly currentIdentity: PublicIdentity | null;
  readonly isCreatorModeActive: boolean;
  readonly screenTimeLimits: DeviceScreenTimeLimits;
}

export interface FeedPostRecord {
  id: string;
  authorDid: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  content: string;
  image?: string;
  timestamp: number;
  likesCount: number;
  commentsCount: number;
  signatureHex?: string;
}

/**
 * High-performance local-first browser IndexedDB store for zero-latency CRDT state.
 */
export class SovraIndexedDbStore {
  private dbName = 'sovra_local_crdt_db';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  private async openDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB not supported in current environment');
    }

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (ev: any) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('feed_posts')) {
          const feedStore = db.createObjectStore('feed_posts', { keyPath: 'id' });
          feedStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('chat_messages')) {
          const chatStore = db.createObjectStore('chat_messages', { keyPath: 'id' });
          chatStore.createIndex('threadId', 'threadId', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async getFeedPosts(): Promise<FeedPostRecord[]> {
    try {
      const db = await this.openDb();
      return new Promise((resolve) => {
        const tx = db.transaction('feed_posts', 'readonly');
        const store = tx.objectStore('feed_posts');
        const req = store.getAll();
        req.onsuccess = () => {
          const posts = (req.result || []) as FeedPostRecord[];
          posts.sort((a, b) => b.timestamp - a.timestamp);
          resolve(posts);
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  public async saveFeedPost(post: FeedPostRecord): Promise<void> {
    try {
      const db = await this.openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('feed_posts', 'readwrite');
        const store = tx.objectStore('feed_posts');
        const req = store.put(post);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (_) {}
  }
}

export class SovraClient {
  private state: SovraClientState;
  public readonly lightClient: SovraLightClient;
  public readonly localStore: SovraIndexedDbStore;

  constructor() {
    this.state = {
      currentIdentity: null,
      isCreatorModeActive: false,
      screenTimeLimits: {
        dailyAppLimitMinutes: 60,
        feedLimitMinutes: 30,
        shortVideoLimitMinutes: 20,
        exploreLimitMinutes: 15,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    };

    // Instantiate Mobile-First Transient Light Client from @sovra/p2p
    const key = SovraDeviceKey.generate(
      'dev-browser-client',
      'Local Web Browser',
      'did:sovra:user:local',
      Math.floor(Date.now() / 1000) + 86400 * 365,
    );
    this.lightClient = new SovraLightClient({
      deviceKey: key,
      preferredRelayMultiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p-circuit'],
    });

    this.localStore = new SovraIndexedDbStore();
  }

  public getState(): SovraClientState {
    return this.state;
  }

  public toggleCreatorMode(active: boolean): Result<boolean> {
    this.state = {
      ...this.state,
      isCreatorModeActive: active,
    };
    return ok(this.state.isCreatorModeActive);
  }
}
