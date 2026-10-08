/**
 * @file apps/sovra-mobile/src/services/sync-engine.ts
 * Sovra Mobile Client Offline-to-Online Synchronization Engine.
 *
 * Implements:
 * 1. Outbox flusher: processes queued offline operations (posts, messages, likes, profile updates).
 * 2. Multi-transport failover: tries Internet HTTP first; if offline, routes via BLE mesh.
 * 3. Idempotent retries with exponential backoff.
 * 4. Merkle / cursor delta reconciliation with cloud dev-server.
 */

import { localDb, type QueuedOperation } from './local-database.js';
import { mobileMesh } from './mobile-mesh-coordinator.js';
import { API_BASE_URL, getActiveSessionToken } from './api.js';

export interface SyncEngineStatus {
  isSyncing: boolean;
  pendingOutboxCount: number;
  lastSyncTimestamp: number;
  lastSyncResult: 'SUCCESS' | 'PARTIAL' | 'OFFLINE' | 'FAILED' | 'IDLE';
}

export class MobileSyncEngine {
  private static instance: MobileSyncEngine | null = null;
  private isRunning = false;
  private timer: any = null;
  private statusListeners: Array<(status: SyncEngineStatus) => void> = [];
  private lastSyncTimestamp = 0;
  private lastSyncResult: SyncEngineStatus['lastSyncResult'] = 'IDLE';

  private constructor() {
    // Start background sync loop
    this.startPeriodicSync();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.triggerSync();
      });
    }
  }

  public static getInstance(): MobileSyncEngine {
    if (!MobileSyncEngine.instance) {
      MobileSyncEngine.instance = new MobileSyncEngine();
    }
    return MobileSyncEngine.instance;
  }

  public startPeriodicSync(intervalMs = 5000): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.triggerSync().catch(() => {});
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async triggerSync(): Promise<SyncEngineStatus> {
    if (this.isRunning) return this.getStatus();
    this.isRunning = true;
    this.notifyStatus();

    try {
      const pendingOps = localDb.getPendingOutbox();
      if (pendingOps.length === 0) {
        this.lastSyncResult = 'IDLE';
        this.isRunning = false;
        this.notifyStatus();
        return this.getStatus();
      }

      const isOnline =
        typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? navigator.onLine
          : true;
      const meshState = mobileMesh.getRuntimeState();
      const hasBlePeers = meshState.diagnostics.authenticatedPeersCount > 0;

      let remainingOps = [...pendingOps];

      // Step 1: Attempt bulk offline-to-online CRDT reconciliation if online
      if (isOnline) {
        try {
          const { reconciledIds, serverTimestamp } = await this.reconcileBatchOverHttp(remainingOps);
          this.lastSyncTimestamp = serverTimestamp;
          remainingOps = remainingOps.filter(op => !reconciledIds.has(op.operationId));
        } catch (batchErr) {
          console.warn('[MobileSyncEngine] Batch reconcile fallback to individual:', batchErr);
        }
      }

      // Step 2: For any remaining un-reconciled operations, process individually
      for (const op of remainingOps) {
        await localDb.markOperationAttempting(op.operationId);

        let success = false;
        let errorMsg = '';

        // Priority 1: Try Internet HTTP API if online
        if (isOnline) {
          try {
            success = await this.executeOpOverHttp(op);
          } catch (httpErr: any) {
            errorMsg = httpErr?.message || 'HTTP sync error';
          }
        }

        // Priority 2: If Internet failed or offline, try BLE Mesh
        if (!success && hasBlePeers) {
          try {
            success = await this.executeOpOverMesh(op);
          } catch (meshErr: any) {
            errorMsg = meshErr?.message || 'Mesh routing error';
          }
        }

        if (success) {
          await localDb.markOperationSuccess(op.operationId);
        } else {
          await localDb.markOperationRetryable(
            op.operationId,
            errorMsg || 'No available transport (Internet or Mesh peers)',
          );
        }
      }

      this.lastSyncTimestamp = Date.now();
      this.lastSyncResult = 'SUCCESS';
    } catch (e) {
      this.lastSyncResult = 'FAILED';
    } finally {
      this.isRunning = false;
      this.notifyStatus();
    }

    return this.getStatus();
  }

  private async reconcileBatchOverHttp(
    ops: QueuedOperation[],
  ): Promise<{ reconciledIds: Set<string>; serverTimestamp: number }> {
    const token =
      getActiveSessionToken() ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}/api/sync/reconcile`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: ops,
        lastServerTimestamp: this.lastSyncTimestamp,
      }),
    });

    if (!res.ok) {
      throw new Error(`Reconciliation server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Reconciliation failed');
    }

    const reconciledIds = new Set<string>();
    if (Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r.status === 'APPLIED' || r.status === 'DUPLICATE') {
          reconciledIds.add(r.operationId);
          await localDb.markOperationSuccess(r.operationId);
        }
      }
    }

    // Ingest deltas from server into localDb
    if (data.deltas?.posts && Array.isArray(data.deltas.posts)) {
      for (const p of data.deltas.posts) {
        await localDb.savePost({
          id: p.id,
          authorDid: p.authorDid,
          authorName: p.authorName,
          authorHandle: p.authorHandle || p.authorEntityHandle || '@peer',
          caption: p.caption,
          timestamp: p.timestamp,
          likesCount: p.likesCount || 0,
          likedByDids: p.likedByDids || [],
          isLiked: !!p.isLiked,
          commentsCount: p.commentsCount || 0,
          syncStatus: 'SYNCED',
          ...(p.authorAvatar ? { authorAvatar: p.authorAvatar } : {}),
          ...(p.mediaCid ? { mediaCid: p.mediaCid } : {}),
          ...((p.mediaImage || p.mediaVideo) ? { mediaDataUrl: p.mediaImage || p.mediaVideo } : {}),
          ...(p.mediaVideo ? { mediaType: 'video' as const } : p.mediaImage ? { mediaType: 'image' as const } : {}),
        });
      }
    }

    if (data.deltas?.messages && Array.isArray(data.deltas.messages)) {
      for (const m of data.deltas.messages) {
        await localDb.saveMessage({
          id: m.id,
          threadId: m.threadId || m.recipientDid,
          senderDid: m.senderDid,
          recipientDid: m.recipientDid,
          senderName: m.senderName || 'Peer',
          text: m.text,
          status: 'sent',
          timestamp: m.timestamp,
          syncStatus: 'SYNCED',
        });
      }
    }

    return {
      reconciledIds,
      serverTimestamp: Number(data.serverTimestamp || Date.now()),
    };
  }

  private async executeOpOverHttp(op: QueuedOperation): Promise<boolean> {
    const token =
      getActiveSessionToken() ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_session_token') : null);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': op.idempotencyKey,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    switch (op.type) {
      case 'CREATE_POST': {
        const res = await fetch(`${API_BASE_URL}/api/feed/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify(op.payload),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.post) {
            await localDb.savePost({
              ...data.post,
              syncStatus: 'SYNCED',
            });
            return true;
          }
        }
        return false;
      }

      case 'SEND_CHAT': {
        const res = await fetch(`${API_BASE_URL}/api/chat/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify(op.payload),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.message) {
            await localDb.updateMessageStatus(data.message.id, 'sent', 'SYNCED');
            return true;
          }
        }
        return false;
      }

      case 'LIKE_POST': {
        const res = await fetch(`${API_BASE_URL}/api/feed/like`, {
          method: 'POST',
          headers,
          body: JSON.stringify(op.payload),
        });
        return res.ok;
      }

      case 'ADD_COMMENT': {
        const res = await fetch(`${API_BASE_URL}/api/feed/comments`, {
          method: 'POST',
          headers,
          body: JSON.stringify(op.payload),
        });
        return res.ok;
      }

      case 'UPDATE_PROFILE': {
        const res = await fetch(`${API_BASE_URL}/api/profile/update`, {
          method: 'POST',
          headers,
          body: JSON.stringify(op.payload),
        });
        return res.ok;
      }

      default:
        return false;
    }
  }

  private async executeOpOverMesh(op: QueuedOperation): Promise<boolean> {
    switch (op.type) {
      case 'CREATE_POST': {
        const res = await mobileMesh.broadcastPost(
          op.payload.caption,
          op.payload.authorName || 'Local User',
          op.payload.authorHandle || '@user',
          op.payload.mediaCid,
        );
        return res.success;
      }

      case 'SEND_CHAT': {
        const res = await mobileMesh.sendChatMessage(
          op.payload.recipientDid,
          op.payload.text,
          op.payload.senderName || 'Local User',
        );
        return res.success;
      }

      default:
        return false;
    }
  }

  public getStatus(): SyncEngineStatus {
    return {
      isSyncing: this.isRunning,
      pendingOutboxCount: localDb.getPendingOutbox().length,
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastSyncResult: this.lastSyncResult,
    };
  }

  public onStatusChange(listener: (status: SyncEngineStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {}
    }
  }
}

export const syncEngine = MobileSyncEngine.getInstance();
