import crypto from 'node:crypto';
import type { SovraStore } from './storage/sovra-store.ts';

export type L1BroadcastOutcome =
  | { status: 'COMMITTED'; txHash: string; blockHeight: number; endpoint: string }
  | { status: 'REJECTED'; code: number; log: string; endpoint: string }
  | { status: 'RETRYABLE'; reason: string; endpoint?: string };

export interface L1RpcTransport {
  getClusterStatus(endpoint: string): Promise<{ ok: boolean; latestBlockHeight: number; catchingUp: boolean; network?: string }>;
  queryTx(endpoint: string, txHashHex: string): Promise<{ found: boolean; committed: boolean; code: number; blockHeight: number; log?: string }>;
  broadcastTxCommit(endpoint: string, rawTxBytes: Uint8Array): Promise<L1BroadcastOutcome>;
}

export interface L1SettlementRelayerOptions {
  store: SovraStore;
  riskEngine?: any;
  rpcUrls?: string[];
  pollIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetries?: number;
  transport?: L1RpcTransport;
  payloadEncoder?: (intent: any) => Uint8Array;
}

export function parseL1RpcUrls(raw?: string): string[] {
  const src = (raw || process.env.SOVRA_L1_RPC_URLS || process.env.SOVRA_L1_RPC_URL || 'http://127.0.0.1:26657').trim();
  const urls = src
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter((u) => /^https?:\/\//i.test(u));
  return urls.length > 0 ? Array.from(new Set(urls)) : ['http://127.0.0.1:26657'];
}

export class CometBftHttpTransport implements L1RpcTransport {
  private readonly timeoutMs: number;

  constructor(timeoutMs = 3500) {
    this.timeoutMs = timeoutMs;
  }

  public async getClusterStatus(endpoint: string): Promise<{ ok: boolean; latestBlockHeight: number; catchingUp: boolean; network?: string }> {
    try {
      const res = await fetch(`${endpoint}/status`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return { ok: false, latestBlockHeight: 0, catchingUp: true };
      const data = (await res.json()) as any;
      const syncInfo = data?.result?.sync_info || {};
      return {
        ok: true,
        latestBlockHeight: Number(syncInfo.latest_block_height || 0),
        catchingUp: Boolean(syncInfo.catching_up),
        network: data?.result?.node_info?.network,
      };
    } catch {
      return { ok: false, latestBlockHeight: 0, catchingUp: true };
    }
  }

  public async queryTx(
    endpoint: string,
    txHashHex: string,
  ): Promise<{ found: boolean; committed: boolean; code: number; blockHeight: number; log?: string }> {
    try {
      const cleanHash = txHashHex.replace(/^0x/i, '').toUpperCase();
      const res = await fetch(`${endpoint}/tx?hash=0x${cleanHash}`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return { found: false, committed: false, code: -1, blockHeight: 0 };
      const data = (await res.json()) as any;
      if (data?.error || !data?.result) {
        return { found: false, committed: false, code: -1, blockHeight: 0 };
      }
      const code = Number(data.result.tx_result?.code ?? 0);
      const blockHeight = Number(data.result.height || 0);
      return {
        found: true,
        committed: code === 0 && blockHeight > 0,
        code,
        blockHeight,
        log: String(data.result.tx_result?.log || ''),
      };
    } catch {
      return { found: false, committed: false, code: -1, blockHeight: 0 };
    }
  }

  public async broadcastTxCommit(endpoint: string, rawTxBytes: Uint8Array): Promise<L1BroadcastOutcome> {
    try {
      const hexPayload = Buffer.from(rawTxBytes).toString('hex');
      const res = await fetch(`${endpoint}/broadcast_tx_commit?tx=0x${hexPayload}`, {
        signal: AbortSignal.timeout(this.timeoutMs * 2),
      });
      if (!res.ok) {
        return { status: 'RETRYABLE', reason: `RPC HTTP ${res.status}`, endpoint };
      }
      const data = (await res.json()) as any;
      if (data?.error) {
        const msg = String(data.error?.data || data.error?.message || 'RPC JSON error');
        if (/already exists in cache|tx already in mempool/i.test(msg)) {
          return { status: 'RETRYABLE', reason: msg, endpoint };
        }
        return { status: 'RETRYABLE', reason: msg, endpoint };
      }
      const result = data?.result || {};
      const checkCode = Number(result.check_tx?.code ?? 0);
      const deliverCode = Number(result.deliver_tx?.code ?? result.tx_result?.code ?? 0);
      const height = Number(result.height || 0);
      const hash = String(result.hash || crypto.createHash('sha256').update(rawTxBytes).digest('hex').toUpperCase());

      if (checkCode !== 0) {
        const log = String(result.check_tx?.log || 'CheckTx rejected');
        if (/mempool|busy|timeout|sequence/i.test(log)) {
          return { status: 'RETRYABLE', reason: log, endpoint };
        }
        return { status: 'REJECTED', code: checkCode, log, endpoint };
      }
      if (deliverCode !== 0) {
        return {
          status: 'REJECTED',
          code: deliverCode,
          log: String(result.deliver_tx?.log || result.tx_result?.log || 'DeliverTx rejected'),
          endpoint,
        };
      }
      if (height <= 0) {
        return { status: 'RETRYABLE', reason: 'Committed block height missing', endpoint };
      }
      return { status: 'COMMITTED', txHash: hash, blockHeight: height, endpoint };
    } catch (err: any) {
      return { status: 'RETRYABLE', reason: err?.message || 'L1 RPC network failure', endpoint };
    }
  }
}

export function defaultEncodeSettlementIntentTx(intent: any): Uint8Array {
  if (intent.signed_tx_hex && typeof intent.signed_tx_hex === 'string') {
    return Buffer.from(intent.signed_tx_hex.replace(/^0x/i, ''), 'hex');
  }
  if (intent.raw_tx && intent.raw_tx instanceof Uint8Array) {
    return intent.raw_tx;
  }
  const canonical = JSON.stringify({
    type: 'sovra/MsgReconcileTransfer',
    intentId: intent.id,
    from: intent.sender_did,
    to: intent.recipient_did,
    amountSov: Number(intent.amount_sov || 0),
    feeSov: Number(intent.fee_sov || 0),
    idempotencyKey: intent.idempotency_key || intent.id,
    createdAt: Number(intent.created_at || 0),
  });
  return new TextEncoder().encode(canonical);
}

export class L1SettlementRelayer {
  private readonly store: SovraStore;
  private readonly riskEngine?: any;
  private readonly rpcUrls: string[];
  private readonly pollIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxRetries: number;
  private readonly transport: L1RpcTransport;
  private readonly payloadEncoder: (intent: any) => Uint8Array;

  private timer: NodeJS.Timeout | null = null;
  private isRunningPass = false;
  private rpcCursor = 0;
  private retryState = new Map<string, { attempts: number; nextRetryAt: number; lastError?: string }>();

  private committedTotal = 0;
  private refundedTotal = 0;
  private retriesTotal = 0;
  private deadLetterCount = 0;
  private lastPassAt = 0;
  private healthyRpcCount = 0;
  private highestBlockHeight = 0;
  private syncLagBlocks = 0;
  private pendingIntentCount = 0;

  constructor(options: L1SettlementRelayerOptions) {
    this.store = options.store;
    this.riskEngine = options.riskEngine;
    this.rpcUrls = options.rpcUrls && options.rpcUrls.length > 0 ? options.rpcUrls : parseL1RpcUrls();
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 8;
    this.transport = options.transport ?? new CometBftHttpTransport();
    this.payloadEncoder = options.payloadEncoder ?? defaultEncodeSettlementIntentTx;
  }

  public getRpcEndpoints(): string[] {
    return [...this.rpcUrls];
  }

  public async probeClusterHealth(): Promise<{
    healthyCount: number;
    totalEndpoints: number;
    highestBlockHeight: number;
    syncLagBlocks: number;
  }> {
    let healthyCount = 0;
    let maxHeight = 0;
    let minHeight = Number.MAX_SAFE_INTEGER;
    let anyCatchingUp = false;

    const results = await Promise.all(
      this.rpcUrls.map(async (ep) => ({ ep, status: await this.transport.getClusterStatus(ep) })),
    );
    for (const r of results) {
      if (r.status.ok) {
        healthyCount++;
        if (r.status.latestBlockHeight > maxHeight) maxHeight = r.status.latestBlockHeight;
        if (r.status.latestBlockHeight < minHeight) minHeight = r.status.latestBlockHeight;
        if (r.status.catchingUp) anyCatchingUp = true;
      }
    }

    this.healthyRpcCount = healthyCount;
    this.highestBlockHeight = maxHeight;
    this.syncLagBlocks = healthyCount > 0 && minHeight !== Number.MAX_SAFE_INTEGER
      ? Math.max(anyCatchingUp ? 1 : 0, maxHeight - minHeight)
      : 0;

    return {
      healthyCount,
      totalEndpoints: this.rpcUrls.length,
      highestBlockHeight: this.highestBlockHeight,
      syncLagBlocks: this.syncLagBlocks,
    };
  }

  public async processPendingIntents(forceImmediateRetry = false): Promise<{
    scanned: number;
    committed: number;
    refunded: number;
    deferred: number;
    healedFeeMarkers: number;
    healthyRpcCount: number;
  }> {
    if (this.isRunningPass) {
      return {
        scanned: 0,
        committed: 0,
        refunded: 0,
        deferred: 0,
        healedFeeMarkers: 0,
        healthyRpcCount: this.healthyRpcCount,
      };
    }

    this.isRunningPass = true;
    this.lastPassAt = Date.now();
    let committed = 0;
    let refunded = 0;
    let deferred = 0;
    let healedFeeMarkers = 0;

    try {
      const pending = await this.store.getPendingSettlementIntents();
      this.pendingIntentCount = pending.length;

      const cluster = await this.probeClusterHealth();
      if (pending.length === 0) {
        return {
          scanned: 0,
          committed: 0,
          refunded: 0,
          deferred: 0,
          healedFeeMarkers: 0,
          healthyRpcCount: cluster.healthyCount,
        };
      }

      if (cluster.healthyCount === 0) {
        deferred = pending.length;
        return {
          scanned: pending.length,
          committed: 0,
          refunded: 0,
          deferred,
          healedFeeMarkers: 0,
          healthyRpcCount: 0,
        };
      }

      const now = Date.now();
      for (const intent of pending) {
        const retryEntry = this.retryState.get(intent.id);
        if (!forceImmediateRetry && retryEntry && retryEntry.nextRetryAt > now) {
          deferred++;
          continue;
        }

        const rawTx = this.payloadEncoder(intent);
        const txHashHex = crypto.createHash('sha256').update(rawTx).digest('hex').toUpperCase();

        // Try healthy endpoints in round-robin failover order
        let finalOutcome: L1BroadcastOutcome = { status: 'RETRYABLE', reason: 'No RPC endpoints responded' };
        for (let i = 0; i < this.rpcUrls.length; i++) {
          const idx = (this.rpcCursor + i) % this.rpcUrls.length;
          const endpoint = this.rpcUrls[idx];

          // Idempotency guard: check if tx already landed on L1
          const existing = await this.transport.queryTx(endpoint, txHashHex);
          if (existing.found) {
            if (existing.committed) {
              finalOutcome = {
                status: 'COMMITTED',
                txHash: txHashHex,
                blockHeight: existing.blockHeight,
                endpoint,
              };
              this.rpcCursor = (idx + 1) % this.rpcUrls.length;
              break;
            }
            if (existing.code > 0) {
              finalOutcome = {
                status: 'REJECTED',
                code: existing.code,
                log: existing.log || 'Existing L1 tx rejected',
                endpoint,
              };
              break;
            }
          }

          const outcome = await this.transport.broadcastTxCommit(endpoint, rawTx);
          finalOutcome = outcome;
          if (outcome.status === 'COMMITTED' || outcome.status === 'REJECTED') {
            this.rpcCursor = (idx + 1) % this.rpcUrls.length;
            break;
          }
        }

        if (finalOutcome.status === 'COMMITTED') {
          const commitRes = await this.store.commitSettlementIntent({
            intentId: intent.id,
            l1TxHash: finalOutcome.txHash,
            l1BlockHeight: finalOutcome.blockHeight,
          });
          if (commitRes.ok) {
            committed++;
            this.committedTotal++;
            this.retryState.delete(intent.id);

            // Heal fee deficit markers in SQLite/PG & Risk ledger
            const rawSqlite = this.store.getSqliteEngine?.()?.getRawDb?.() || this.store.getSqliteEngine?.()?.db;
            if (rawSqlite) {
              try {
                const upd = rawSqlite
                  .prepare("UPDATE risk_management_ledger SET prevented = 1 WHERE category = 'L1_OFFCHAIN_FEE_DEFICIT' AND prevented = 0")
                  .run();
                healedFeeMarkers += Number(upd?.changes || 0);
              } catch {}
            }
            const pgPool = this.store.getPgPool();
            if (pgPool) {
              try {
                const pgRes = await pgPool.query(
                  "UPDATE risk_management_ledger SET prevented = TRUE WHERE category = 'L1_OFFCHAIN_FEE_DEFICIT' AND prevented = FALSE",
                );
                healedFeeMarkers += Number(pgRes.rowCount || 0);
              } catch {}
            }
            if (this.riskEngine?.recordRiskEvent) {
              this.riskEngine.recordRiskEvent({
                category: 'MITIGATION_RECOVERY',
                severity: 'LOW',
                direction: 'RECOVERED_OR_SAVED',
                amountSov: Number(intent.fee_sov || 0.0001),
                actorDid: intent.sender_did,
                endpoint: '/internal/l1-relayer',
                description: `Auto-relayed settlement intent ${intent.id} to CometBFT L1 block #${finalOutcome.blockHeight}`,
                prevented: true,
                metadata: {
                  intentId: intent.id,
                  l1TxHash: finalOutcome.txHash,
                  l1BlockHeight: finalOutcome.blockHeight,
                  rpcEndpoint: finalOutcome.endpoint,
                },
              });
            }
          } else {
            deferred++;
          }
        } else if (finalOutcome.status === 'REJECTED') {
          const refundRes = await this.store.failAndRefundSettlementIntent({
            intentId: intent.id,
            errorReason: `L1 consensus rejected (code=${finalOutcome.code}): ${finalOutcome.log}`,
          });
          if (refundRes.ok) {
            refunded++;
            this.refundedTotal++;
            this.retryState.delete(intent.id);
            if (this.riskEngine?.recordRiskEvent) {
              this.riskEngine.recordRiskEvent({
                category: 'MITIGATION_RECOVERY',
                severity: 'HIGH',
                direction: 'RECOVERED_OR_SAVED',
                amountSov: Number(intent.amount_sov || 0) + Number(intent.fee_sov || 0),
                actorDid: intent.sender_did,
                endpoint: '/internal/l1-relayer',
                description: `Atomic refund completed for rejected L1 settlement intent ${intent.id}: ${finalOutcome.log}`,
                prevented: true,
                metadata: { intentId: intent.id, code: finalOutcome.code, rpcEndpoint: finalOutcome.endpoint },
              });
            }
          } else {
            deferred++;
          }
        } else {
          deferred++;
          this.retriesTotal++;
          const prevAttempts = retryEntry?.attempts || 0;
          const nextAttempts = prevAttempts + 1;
          const backoffMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * Math.pow(2, prevAttempts));
          this.retryState.set(intent.id, {
            attempts: nextAttempts,
            nextRetryAt: now + backoffMs,
            lastError: finalOutcome.reason,
          });
          if (nextAttempts >= this.maxRetries) {
            this.deadLetterCount++;
          }
        }
      }

      const remaining = await this.store.getPendingSettlementIntents();
      this.pendingIntentCount = remaining.length;

      return {
        scanned: pending.length,
        committed,
        refunded,
        deferred,
        healedFeeMarkers,
        healthyRpcCount: cluster.healthyCount,
      };
    } finally {
      this.isRunningPass = false;
    }
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processPendingIntents().catch(() => {});
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getMetricsSnapshot() {
    return {
      committedTotal: this.committedTotal,
      refundedTotal: this.refundedTotal,
      retriesTotal: this.retriesTotal,
      deadLetterCount: this.deadLetterCount,
      pendingIntentCount: this.pendingIntentCount,
      healthyRpcCount: this.healthyRpcCount,
      highestBlockHeight: this.highestBlockHeight,
      syncLagBlocks: this.syncLagBlocks,
      lastPassAt: this.lastPassAt,
      endpoints: [...this.rpcUrls],
    };
  }

  public toPrometheusMetrics(): string {
    const s = this.getMetricsSnapshot();
    return [
      '# HELP sovra_l1_relayer_committed_total Total settlements autonomously committed on CometBFT L1',
      '# TYPE sovra_l1_relayer_committed_total counter',
      `sovra_l1_relayer_committed_total ${s.committedTotal}`,
      '# HELP sovra_l1_relayer_refunded_total Total rejected L1 settlement intents atomically refunded',
      '# TYPE sovra_l1_relayer_refunded_total counter',
      `sovra_l1_relayer_refunded_total ${s.refundedTotal}`,
      '# HELP sovra_l1_relayer_retries_total Total retryable L1 settlement relay attempts',
      '# TYPE sovra_l1_relayer_retries_total counter',
      `sovra_l1_relayer_retries_total ${s.retriesTotal}`,
      '# HELP sovra_l1_relayer_pending_intents Current pending/reconciliation settlement intent queue depth',
      '# TYPE sovra_l1_relayer_pending_intents gauge',
      `sovra_l1_relayer_pending_intents ${s.pendingIntentCount}`,
      '# HELP sovra_l1_relayer_sync_lag_blocks Observed block height lag across configured L1 RPC nodes',
      '# TYPE sovra_l1_relayer_sync_lag_blocks gauge',
      `sovra_l1_relayer_sync_lag_blocks ${s.syncLagBlocks}`,
      '# HELP sovra_l1_rpc_healthy_nodes Number of healthy L1 CometBFT RPC nodes reachable',
      '# TYPE sovra_l1_rpc_healthy_nodes gauge',
      `sovra_l1_rpc_healthy_nodes ${s.healthyRpcCount}`,
    ].join('\n');
  }
}
