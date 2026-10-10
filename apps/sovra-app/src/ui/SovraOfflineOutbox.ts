/**
 * @file apps/sovra-app/src/ui/SovraOfflineOutbox.ts
 * Persistent Browser Offline Outbox Engine backed by IndexedDB.
 *
 * Guarantees zero data loss when creating posts, comments, reactions, or chat messages
 * during network partitions, offline flight mode, or intermittent connectivity.
 */

export interface OutboxAction {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload: Record<string, any>;
  headers?: Record<string, string>;
  createdAt: number;
  retryCount: number;
  status: 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';
  lastError?: string;
}

export class SovraOfflineOutbox {
  private static instance: SovraOfflineOutbox | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isDraining = false;
  private syncTimer: any = null;

  private constructor() {
    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      this.initDb();
      window.addEventListener('online', () => {
        this.drainOutbox().catch(() => {});
      });
    }
  }

  public static getInstance(): SovraOfflineOutbox {
    if (!SovraOfflineOutbox.instance) {
      SovraOfflineOutbox.instance = new SovraOfflineOutbox();
    }
    return SovraOfflineOutbox.instance;
  }

  private initDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open('sovra_offline_outbox_db', 1);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  /**
   * Enqueues an offline action into durable IndexedDB storage
   */
  public async enqueue(
    endpoint: string,
    payload: Record<string, any>,
    method: 'POST' | 'PUT' | 'DELETE' = 'POST',
    headers: Record<string, string> = {}
  ): Promise<OutboxAction> {
    const action: OutboxAction = {
      id: 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      endpoint,
      method,
      payload,
      headers,
      createdAt: Date.now(),
      retryCount: 0,
      status: 'PENDING',
    };

    const db = await this.initDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const req = store.add(action);
      req.onsuccess = () => {
        // Dispatch custom DOM event for optimistic UI updates
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sovra-outbox-enqueued', { detail: action }));
        }
        resolve(action);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Retrieves all pending actions ordered by creation timestamp
   */
  public async getPendingActions(): Promise<OutboxAction[]> {
    const db = await this.initDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const index = store.index('createdAt');
      const req = index.getAll();
      req.onsuccess = () => {
        const all: OutboxAction[] = req.result || [];
        resolve(all.filter(a => a.status === 'PENDING' || a.status === 'SYNCING'));
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Drains the outbox by replaying pending HTTP requests to the backend server
   */
  public async drainOutbox(): Promise<{ processed: number; failed: number }> {
    if (this.isDraining) return { processed: 0, failed: 0 };
    this.isDraining = true;

    let processed = 0;
    let failed = 0;

    try {
      const pending = await this.getPendingActions();
      const db = await this.initDb();

      for (const action of pending) {
        try {
          const res = await fetch(action.endpoint, {
            method: action.method,
            headers: {
              'Content-Type': 'application/json',
              ...action.headers,
            },
            body: JSON.stringify(action.payload),
          });

          if (res.ok) {
            // Remove completed item from IndexedDB
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction('outbox', 'readwrite');
              const store = tx.objectStore('outbox');
              const req = store.delete(action.id);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
            });

            processed++;
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('sovra-outbox-synced', { detail: { action, success: true } }));
            }
          } else if (res.status >= 400 && res.status < 500) {
            // Client error (e.g. 400 validation, 403 forbidden) — mark as failed, do not retry endlessly
            await this.updateStatus(db, action.id, 'FAILED', `HTTP ${res.status}: ${res.statusText}`);
            failed++;
          } else {
            // Server error (5xx) — retry later
            action.retryCount++;
            await this.updateStatus(db, action.id, 'PENDING', `HTTP ${res.status}: will retry`);
            failed++;
          }
        } catch (fetchErr: any) {
          // Network still unreachable
          action.retryCount++;
          await this.updateStatus(db, action.id, 'PENDING', fetchErr?.message || 'Network offline');
          failed++;
          break; // Stop draining if network is clearly down
        }
      }
    } finally {
      this.isDraining = false;
    }

    return { processed, failed };
  }

  private async updateStatus(db: IDBDatabase, id: string, status: OutboxAction['status'], error?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as OutboxAction;
        if (item) {
          item.status = status;
          if (error) item.lastError = error;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Starts periodic polling sync (default: every 30 seconds)
   */
  public startAutoSync(intervalMs = 30000): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        this.drainOutbox().catch(() => {});
      }
    }, intervalMs);
  }

  public stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

if (typeof window !== 'undefined') {
  (window as any).SovraOfflineOutbox = SovraOfflineOutbox;
}
