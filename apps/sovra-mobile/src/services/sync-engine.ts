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
import { getActiveSessionToken } from './api.js';
import { multiRelayManager } from './multi-relay-manager.js';

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
  private wakeupEventSource: any = null;
  private wakeupUnsubRelay: (() => void) | null = null;
  private wakeupRelayUrl = '';
  private lastWakeupEventId = 0;
  private seenWakeupHints = new Set<string>();
  private unifiedPushListenersAttached = false;
  private unifiedPushEndpoint = '';

  private constructor() {
    // Start background sync loop
    this.startPeriodicSync();

    if (typeof window !== 'undefined') {
      try {
        const savedCursor = Number(localStorage.getItem('sovra_sse_last_event_id_v1') || '0');
        if (Number.isFinite(savedCursor) && savedCursor > 0) this.lastWakeupEventId = savedCursor;
      } catch {}
      window.addEventListener('online', () => {
        this.triggerSync();
      });
      this.attachUnifiedPushListeners();
      this.startZeroCloudWakeup();
    }
  }

  private getUnifiedPushBridge(): {
    listDistributors?: () => string;
    registerDistributor?: (distributorPackage: string, instanceToken: string) => boolean;
    unregisterDistributor?: (distributorPackage: string, instanceToken: string) => boolean;
    getLastEndpointJson?: () => string;
  } | null {
    if (typeof window === 'undefined') return null;
    return (window as any).SovraUnifiedPushNative ?? null;
  }

  public listUnifiedPushDistributors(): string[] {
    try {
      const raw = this.getUnifiedPushBridge()?.listDistributors?.();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    } catch {
      return [];
    }
  }

  public async syncUnifiedPushEndpoint(endpoint: string, token = 'sovra-default', didOverride?: string): Promise<boolean> {
    if (!endpoint || (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))) return false;
    this.unifiedPushEndpoint = endpoint;
    const targetDid = didOverride || this.getLocalDidFromStorage() || 'did:key:z6MksLocalUser';
    try {
      const base = multiRelayManager.getActiveBaseUrl().replace(/\/+$/, '');
      if (!base) return false;
      const res = await fetch(`${base}/api/push/register-native`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userDid: targetDid,
          token,
          endpointUrl: endpoint,
          provider: 'unifiedpush',
          platform: 'android',
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public registerUnifiedPushDistributor(distributorPackage?: string, didOverride?: string): boolean {
    const bridge = this.getUnifiedPushBridge();
    if (!bridge) return false;
    this.attachUnifiedPushListeners(didOverride);
    const chosen = distributorPackage || this.listUnifiedPushDistributors()[0];
    if (!chosen) return false;
    const initiated = Boolean(bridge.registerDistributor?.(chosen, 'sovra-default'));
    try {
      const cached = JSON.parse(bridge.getLastEndpointJson?.() || '{}') as { endpoint?: string; token?: string };
      if (cached?.endpoint) {
        this.syncUnifiedPushEndpoint(cached.endpoint, cached.token || 'sovra-default', didOverride).catch(() => {});
      }
    } catch {}
    return initiated;
  }

  public attachUnifiedPushListeners(didOverride?: string): void {
    if (typeof window === 'undefined' || this.unifiedPushListenersAttached) return;
    this.unifiedPushListenersAttached = true;
    window.addEventListener('sovraUnifiedPushEndpoint', (ev: any) => {
      const endpoint = String(ev?.detail?.endpoint || '');
      const token = String(ev?.detail?.token || 'sovra-default');
      if (endpoint) {
        this.syncUnifiedPushEndpoint(endpoint, token, didOverride).catch(() => {});
      }
    });
    window.addEventListener('sovraUnifiedPushMessage', () => {
      this.triggerSync().catch(() => {});
    });
  }

  public getPushDeliveryTelemetry(): {
    foregroundChannel: 'sse' | 'inactive';
    foregroundRelayUrl: string;
    lastWakeupEventId: number;
    backgroundAndroidChannel: 'unifiedpush' | 'none';
    unifiedPushBridgeAvailable: boolean;
    installedUnifiedPushDistributors: string[];
    unifiedPushEndpoint: string;
    backgroundIosChannel: 'unsupported';
  } {
    const distributors = this.listUnifiedPushDistributors();
    return {
      foregroundChannel: this.wakeupEventSource ? 'sse' : 'inactive',
      foregroundRelayUrl: this.wakeupRelayUrl,
      lastWakeupEventId: this.lastWakeupEventId,
      backgroundAndroidChannel: this.unifiedPushEndpoint ? 'unifiedpush' : 'none',
      unifiedPushBridgeAvailable: Boolean(this.getUnifiedPushBridge()),
      installedUnifiedPushDistributors: distributors,
      unifiedPushEndpoint: this.unifiedPushEndpoint,
      backgroundIosChannel: 'unsupported',
    };
  }

  public startZeroCloudWakeup(didOverride?: string): boolean {
    this.attachUnifiedPushListeners(didOverride);
    try {
      const bridge = this.getUnifiedPushBridge();
      const cached = bridge?.getLastEndpointJson ? JSON.parse(bridge.getLastEndpointJson()) : null;
      if (cached?.endpoint) {
        this.unifiedPushEndpoint = String(cached.endpoint);
      }
    } catch {}
    if (typeof EventSource === 'undefined') return false;
    const isTestEnv = typeof process !== 'undefined' && Boolean((process as any).env?.VITEST);
    if (isTestEnv && !didOverride) return false;

    const targetDid = didOverride || this.getLocalDidFromStorage() || 'did:key:z6MksLocalUser';
    const connectToRelay = (baseUrl: string) => {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      if (this.wakeupEventSource && this.wakeupRelayUrl === cleanBase) return;
      this.stopWakeupSocketOnly();
      try {
        const es = new EventSource(
          `${cleanBase}/api/push/stream?did=${encodeURIComponent(targetDid)}&lastEventId=${this.lastWakeupEventId}`,
        );
        this.wakeupEventSource = es;
        this.wakeupRelayUrl = cleanBase;
        es.addEventListener('wakeup', (ev: any) => {
          try {
            const parsed = JSON.parse(ev.data || '{}');
            if (typeof parsed.id === 'number' && parsed.id > this.lastWakeupEventId) {
              this.lastWakeupEventId = parsed.id;
              try {
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem('sovra_sse_last_event_id_v1', String(this.lastWakeupEventId));
                }
              } catch {}
            }
            const hint = String(parsed.opaqueWakeupHint || ev.lastEventId || '');
            if (hint && this.seenWakeupHints.has(hint)) return;
            if (hint) {
              this.seenWakeupHints.add(hint);
              if (this.seenWakeupHints.size > 512) this.seenWakeupHints.clear();
            }
            this.triggerSync().catch(() => {});
          } catch {}
        });
      } catch {}
    };

    connectToRelay(multiRelayManager.getActiveBaseUrl());
    if (!this.wakeupUnsubRelay) {
      this.wakeupUnsubRelay = multiRelayManager.subscribe((_relays, active) => {
        if (active?.url && active.url !== this.wakeupRelayUrl) {
          connectToRelay(active.url);
        }
      });
    }
    return Boolean(this.wakeupEventSource);
  }

  private stopWakeupSocketOnly(): void {
    if (this.wakeupEventSource) {
      try { this.wakeupEventSource.close(); } catch {}
      this.wakeupEventSource = null;
      this.wakeupRelayUrl = '';
    }
  }

  public stopZeroCloudWakeup(): void {
    this.stopWakeupSocketOnly();
    if (this.wakeupUnsubRelay) {
      this.wakeupUnsubRelay();
      this.wakeupUnsubRelay = null;
    }
  }

  private getLocalDidFromStorage(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('sovra_secure_key_vault_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.did) return String(parsed.did);
        }
      }
    } catch {}
    return '';
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

      // Step 2: Process remaining un-reconciled ops in bounded concurrent batches (CONCURRENCY = 4)
      const SYNC_CONCURRENCY = 4;
      for (let i = 0; i < remainingOps.length; i += SYNC_CONCURRENCY) {
        const batch = remainingOps.slice(i, i + SYNC_CONCURRENCY);
        await Promise.allSettled(
          batch.map(async (op) => {
            await localDb.markOperationAttempting(op.operationId);

            let success = false;
            let errorMsg = '';

            // Priority 1: Concurrent multi-relay HTTP failover race (1.5s hedged timeout)
            if (isOnline) {
              try {
                success = await this.executeOpOverHttp(op);
              } catch (httpErr: any) {
                errorMsg = httpErr?.message || 'HTTP sync error';
              }
            }

            // Priority 2: Immediate BLE / Wi-Fi Direct Mesh fallback
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
          }),
        );
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

    const res = await multiRelayManager.fetchWithFallback('/api/sync/reconcile', {
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

  private async postOpWithFailover(
    path: string,
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    return multiRelayManager.fetchWithFallback(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
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
        const res = await this.postOpWithFailover('/api/feed/create', op.payload, headers);
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
        const res = await this.postOpWithFailover('/api/chat/messages', op.payload, headers);
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
        const res = await this.postOpWithFailover('/api/feed/like', op.payload, headers);
        return res.ok;
      }

      case 'ADD_COMMENT': {
        const res = await this.postOpWithFailover('/api/feed/comment', op.payload, headers);
        return res.ok;
      }

      case 'UPDATE_PROFILE': {
        const res = await this.postOpWithFailover('/api/profile/update', op.payload, headers);
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

      case 'LIKE_POST': {
        const res = await mobileMesh.broadcastReaction(
          op.payload.postId || op.payload.targetEventId,
          op.payload.emoji || '❤️',
          Boolean(op.payload.isRetraction),
        );
        return res.success;
      }

      case 'ADD_COMMENT': {
        const res = await mobileMesh.broadcastComment(
          op.payload.postId,
          op.payload.text || op.payload.comment || '',
          op.payload.authorName || 'Local User',
        );
        return res.success;
      }

      case 'UPDATE_PROFILE': {
        const res = await mobileMesh.broadcastProfileUpdate(op.payload || {});
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
