/**
 * 👑 SOVRA PROTOCOL - VALIDATOR HEALTH MONITOR & CONSENSUS LAG DETECTOR
 * File: services/api/src/monitoring/consensus-monitor.ts
 *
 * Implements:
 * 1. Multi-validator telemetry polling (/status, /net_info, /query/supply)
 * 2. Consensus lag detection and peer health tracking
 * 3. Alert classification (SEV1: Consensus Halted, SEV2: Validator Lag, SEV3: Peer Degradation)
 * 4. Prometheus metrics exposition (/metrics)
 */

import { securityEventCollector } from './security-events.js';

export interface ValidatorStatus {
  endpoint: string;
  moniker: string;
  chainId: string;
  height: number;
  catchingUp: boolean;
  peers: number;
  responsive: boolean;
  responseTimeMs: number;
  lastChecked: number;
}

export interface ConsensusAlert {
  id: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  title: string;
  description: string;
  timestamp: number;
  resolved: boolean;
}

export interface ConsensusHealthSummary {
  healthy: boolean;
  networkHeight: number;
  minHeight: number;
  maxLagBlocks: number;
  activeValidators: number;
  totalValidators: number;
  consensusHalted: boolean;
  masterInvariantHolds: boolean;
  totalSupplyUsov: string;
  alerts: ConsensusAlert[];
  validators: ValidatorStatus[];
}

export interface EnterprisePrometheusTelemetry {
  httpRequestsTotal?: number | undefined;
  httpLatencyP95Ms?: number | undefined;
  postgresHealthy?: number | undefined;
  redisHealthy?: number | undefined;
  pendingSettlementIntents?: number | undefined;
  riskNetPnlSov?: number | undefined;
  riskExposureSov?: number | undefined;
}

export class ConsensusMonitor {
  private rpcUrls: string[];
  private pollIntervalMs: number;
  private lagThresholdBlocks: number;
  private isPolling = false;
  private timer: NodeJS.Timeout | null = null;
  private validatorStates = new Map<string, ValidatorStatus>();
  private activeAlerts: ConsensusAlert[] = [];
  private lastNetworkHeight = 0;
  private lastHeightAdvanceTime = Date.now();
  private maxStallDurationMs: number;

  constructor(options: {
    rpcUrls?: string[];
    pollIntervalMs?: number;
    lagThresholdBlocks?: number;
    maxStallDurationMs?: number;
  } = {}) {
    this.rpcUrls = options.rpcUrls || [
      'http://127.0.0.1:26657',
      'http://127.0.0.1:26667',
      'http://127.0.0.1:26677',
      'http://127.0.0.1:26687',
    ];
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.lagThresholdBlocks = options.lagThresholdBlocks || 5;
    this.maxStallDurationMs = options.maxStallDurationMs || 30000;
  }

  /**
   * Probes an individual validator node
   */
  public async probeValidator(url: string): Promise<ValidatorStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const statusRes = await fetch(`${url}/status`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!statusRes.ok) {
        throw new Error(`HTTP ${statusRes.status}`);
      }

      const statusData = await statusRes.json();
      const responseTimeMs = Date.now() - start;

      let peersCount = 0;
      try {
        const netController = new AbortController();
        const netTimeout = setTimeout(() => netController.abort(), 1500);
        const netRes = await fetch(`${url}/net_info`, { signal: netController.signal });
        clearTimeout(netTimeout);
        if (netRes.ok) {
          const netData = await netRes.json();
          peersCount = netData.result?.n_peers ?? netData.n_peers ?? (netData.peers?.length || 0);
        }
      } catch {
        // net_info optional
      }

      const height = Number(
        statusData.height ||
        statusData.result?.sync_info?.latest_block_height ||
        statusData.sync_info?.latest_block_height ||
        0
      );

      const moniker =
        statusData.moniker ||
        statusData.result?.node_info?.moniker ||
        statusData.node_info?.moniker ||
        'unknown';

      const chainId =
        statusData.chain_id ||
        statusData.result?.node_info?.network ||
        statusData.node_info?.network ||
        'unknown';

      const catchingUp = Boolean(
        statusData.catching_up ||
        statusData.result?.sync_info?.catching_up ||
        statusData.sync_info?.catching_up
      );

      const status: ValidatorStatus = {
        endpoint: url,
        moniker,
        chainId,
        height,
        catchingUp,
        peers: peersCount,
        responsive: true,
        responseTimeMs,
        lastChecked: Date.now(),
      };

      this.validatorStates.set(url, status);
      return status;
    } catch (err: any) {
      const status: ValidatorStatus = {
        endpoint: url,
        moniker: 'unreachable',
        chainId: 'unknown',
        height: 0,
        catchingUp: false,
        peers: 0,
        responsive: false,
        responseTimeMs: Date.now() - start,
        lastChecked: Date.now(),
      };
      this.validatorStates.set(url, status);
      return status;
    }
  }

  /**
   * Scans all validators, checks lag, evaluates consensus health and raises alerts
   */
  public async evaluateHealth(): Promise<ConsensusHealthSummary> {
    const probeResults = await Promise.all(this.rpcUrls.map((u) => this.probeValidator(u)));

    const responsiveNodes = probeResults.filter((n) => n.responsive);
    const activeCount = responsiveNodes.length;
    const totalCount = probeResults.length;

    let networkHeight = 0;
    let minHeight = 0;
    let maxLag = 0;

    if (responsiveNodes.length > 0) {
      const heights = responsiveNodes.map((n) => n.height);
      networkHeight = Math.max(...heights);
      minHeight = Math.min(...heights);
      maxLag = networkHeight - minHeight;

      if (networkHeight > this.lastNetworkHeight) {
        this.lastNetworkHeight = networkHeight;
        this.lastHeightAdvanceTime = Date.now();
      }
    }

    // Detect consensus stall (fail closed when zero validators configured or quorum lost or > 30s without advance)
    const stallDuration = Date.now() - this.lastHeightAdvanceTime;
    const consensusHalted =
      totalCount === 0 ||
      activeCount < Math.ceil((2 / 3) * totalCount) ||
      (networkHeight > 0 && stallDuration > this.maxStallDurationMs);

    // Alert handling
    const alerts: ConsensusAlert[] = [];

    // SEV1: Consensus Halted / Supermajority lost
    if (consensusHalted) {
      const alert: ConsensusAlert = {
        id: `alt_sev1_${Date.now()}`,
        severity: 'SEV1',
        title: 'Consensus Stalled or Supermajority Lost',
        description: `Active validators: ${activeCount}/${totalCount}. Stall duration: ${Math.round(stallDuration / 1000)}s`,
        timestamp: Date.now(),
        resolved: false,
      };
      alerts.push(alert);
      securityEventCollector.recordEvent(
        'CRITICAL',
        'CONSENSUS_LAG',
        'SEV1_CONSENSUS_HALTED',
        { activeCount, totalCount, stallDuration, networkHeight }
      );
    }

    // SEV2: Validator Lag
    if (maxLag > this.lagThresholdBlocks) {
      const laggingNodes = responsiveNodes.filter((n) => networkHeight - n.height > this.lagThresholdBlocks);
      const alert: ConsensusAlert = {
        id: `alt_sev2_${Date.now()}`,
        severity: 'SEV2',
        title: 'Validator Block Lag Exceeded Threshold',
        description: `Lagging nodes: ${laggingNodes.map((n) => `${n.moniker} (lag=${networkHeight - n.height})`).join(', ')}`,
        timestamp: Date.now(),
        resolved: false,
      };
      alerts.push(alert);
      securityEventCollector.recordEvent(
        'WARN',
        'CONSENSUS_LAG',
        'SEV2_VALIDATOR_LAG',
        { maxLag, laggingCount: laggingNodes.length, threshold: this.lagThresholdBlocks }
      );
    }

    // SEV3: Degraded Node / Unreachable
    const unreachableNodes = probeResults.filter((n) => !n.responsive);
    if (unreachableNodes.length > 0 && unreachableNodes.length < totalCount) {
      const alert: ConsensusAlert = {
        id: `alt_sev3_${Date.now()}`,
        severity: 'SEV3',
        title: 'Validator Node Unreachable',
        description: `Nodes offline: ${unreachableNodes.map((n) => n.endpoint).join(', ')}`,
        timestamp: Date.now(),
        resolved: false,
      };
      alerts.push(alert);
      securityEventCollector.recordEvent(
        'WARN',
        'NODE_FAILURE',
        'SEV3_NODE_OFFLINE',
        { unreachableEndpoints: unreachableNodes.map((n) => n.endpoint) }
      );
    }

    this.activeAlerts = alerts;

    // Check supply invariant on first responsive node (fail closed when unreachable; never fabricate supply)
    let totalSupplyUsov = '0';
    let masterInvariantHolds = false;
    const primaryResponsive = responsiveNodes[0];
    if (primaryResponsive) {
      try {
        const supRes = await fetch(`${primaryResponsive.endpoint}/query/supply`);
        if (supRes.ok) {
          const sup = await supRes.json();
          totalSupplyUsov = sup.bank_supply || sup.total_supply || totalSupplyUsov;
          masterInvariantHolds = sup.master_invariant_holds ?? false;
        }
      } catch {
        // Fail closed on unreachable /query/supply
      }
    }

    return {
      healthy: totalCount > 0 && !consensusHalted && maxLag <= this.lagThresholdBlocks && activeCount >= Math.ceil((2 / 3) * totalCount),
      networkHeight,
      minHeight,
      maxLagBlocks: maxLag,
      activeValidators: activeCount,
      totalValidators: totalCount,
      consensusHalted,
      masterInvariantHolds,
      totalSupplyUsov,
      alerts,
      validators: probeResults,
    };
  }

  /**
   * Generates Prometheus-compatible metrics text
   */
  public generatePrometheusMetrics(
    summary: ConsensusHealthSummary,
    telemetry?: EnterprisePrometheusTelemetry,
  ): string {
    const lines: string[] = [
      '# HELP sovra_network_height Current maximum block height across CometBFT validators',
      '# TYPE sovra_network_height gauge',
      `sovra_network_height ${summary.networkHeight}`,
      '',
      '# HELP sovra_consensus_healthy Binary health gauge (1=consensus active within lag threshold, 0=halted or degraded)',
      '# TYPE sovra_consensus_healthy gauge',
      `sovra_consensus_healthy ${summary.healthy ? 1 : 0}`,
      '',
      '# HELP sovra_active_validators Count of responsive CometBFT validator nodes',
      '# TYPE sovra_active_validators gauge',
      `sovra_active_validators ${summary.activeValidators}`,
      '',
      '# HELP sovra_consensus_max_lag_blocks Maximum block lag between slowest and fastest validator',
      '# TYPE sovra_consensus_max_lag_blocks gauge',
      `sovra_consensus_max_lag_blocks ${summary.maxLagBlocks}`,
      '',
      '# HELP sovra_total_supply_usov Authoritative L1 total circulating supply in micro-SOV',
      '# TYPE sovra_total_supply_usov gauge',
      `sovra_total_supply_usov ${summary.totalSupplyUsov}`,
      '',
    ];

    for (const val of summary.validators) {
      const labels = `endpoint="${val.endpoint}",moniker="${val.moniker}"`;
      lines.push(
        `sovra_validator_height{${labels}} ${val.height}`,
        `sovra_validator_responsive{${labels}} ${val.responsive ? 1 : 0}`,
        `sovra_validator_response_time_ms{${labels}} ${val.responseTimeMs}`,
        `sovra_validator_peers{${labels}} ${val.peers}`
      );
    }

    if (telemetry) {
      lines.push(
        '',
        '# HELP sovra_http_requests_total Total HTTP requests handled by API node',
        '# TYPE sovra_http_requests_total counter',
        `sovra_http_requests_total ${telemetry.httpRequestsTotal ?? 0}`,
        '# HELP sovra_http_request_duration_p95_ms Observed 95th percentile HTTP request duration in ms',
        '# TYPE sovra_http_request_duration_p95_ms gauge',
        `sovra_http_request_duration_p95_ms ${(telemetry.httpLatencyP95Ms ?? 0).toFixed(2)}`,
        '# HELP sovra_postgres_healthy PostgreSQL primary store health status (1=up, 0=down/unconfigured)',
        '# TYPE sovra_postgres_healthy gauge',
        `sovra_postgres_healthy ${telemetry.postgresHealthy ?? 0}`,
        '# HELP sovra_redis_healthy Redis cluster security cache health status (1=up, 0=down/unconfigured)',
        '# TYPE sovra_redis_healthy gauge',
        `sovra_redis_healthy ${telemetry.redisHealthy ?? 0}`,
        '# HELP sovra_settlement_pending_intents Count of SUBMITTED or RECONCILIATION_REQUIRED L1 settlement intents',
        '# TYPE sovra_settlement_pending_intents gauge',
        `sovra_settlement_pending_intents ${telemetry.pendingSettlementIntents ?? 0}`,
        '# HELP sovra_risk_net_pnl_sov Real-time protocol company Net P&L in SOV',
        '# TYPE sovra_risk_net_pnl_sov gauge',
        `sovra_risk_net_pnl_sov ${(telemetry.riskNetPnlSov ?? 0).toFixed(4)}`,
        '# HELP sovra_risk_exposure_sov Real-time tracked financial risk exposure in SOV',
        '# TYPE sovra_risk_exposure_sov gauge',
        `sovra_risk_exposure_sov ${(telemetry.riskExposureSov ?? 0).toFixed(4)}`
      );
    }

    return lines.join('\n') + '\n';
  }

  public startPolling(onHealth?: (summary: ConsensusHealthSummary) => void): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.timer = setInterval(async () => {
      try {
        const summary = await this.evaluateHealth();
        if (onHealth) onHealth(summary);
      } catch {
        // Suppress background poll errors
      }
    }, this.pollIntervalMs);
  }

  public stopPolling(): void {
    this.isPolling = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getActiveAlerts(): ConsensusAlert[] {
    return this.activeAlerts;
  }
}
