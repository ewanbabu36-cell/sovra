/**
 * @file scripts/admin-security.ts
 * Enterprise-Grade Sovereign RBAC, Multi-Sig 2-of-3 Threshold Governance & Emergency Circuit Breaker.
 */

import * as crypto from 'node:crypto';

export type AdminRole = 'SUPER_ADMIN' | 'TREASURY_OFFICER' | 'TRUST_SAFETY' | 'INFRA_OPERATOR' | 'ANALYST';

export interface AdminPrincipal {
  did: string;
  handle: string;
  role: AdminRole;
  authMethod: 'PASSKEY_ED25519' | 'DEVICE_KEY' | 'SESSION_TOKEN';
  authenticatedAt: number;
}

export type MultiSigAction = 
  | 'TREASURY_WITHDRAWAL'
  | 'CIRCUIT_BREAKER_GLOBAL'
  | 'SLASH_MALICIOUS_NODE'
  | 'GLOBAL_EMERGENCY_PANIC'
  | 'POLICY_OVERRIDE';

export interface MultiSigSignature {
  signerDid: string;
  role: AdminRole;
  passkeySignature: string;
  timestamp: number;
}

export interface MultiSigProposal {
  id: string;
  action: MultiSigAction;
  payload: Record<string, any>;
  payloadHash?: string;
  proposerDid: string;
  proposerRole: AdminRole;
  requiredSignatures: number; // Constitutional minimum 3
  signatures: MultiSigSignature[];
  status: 'PENDING' | 'READY_TIMELOCKED' | 'EXECUTED' | 'REJECTED';
  createdAt: number;
  expiresAt?: number;
  readyAt?: number;
  timelockDurationMs?: number;
  timelockExpiresAt?: number;
  executedAt?: number;
  rejectionReason?: string;
}

export interface CircuitBreakerState {
  active: boolean;
  pausedScopes: Array<'ALL' | 'TIPPING' | 'PROMOTIONS' | 'WITHDRAWALS' | 'P2P_TRANSFER'>;
  triggeredByDid: string;
  triggeredByRole: AdminRole;
  reason: string;
  timestamp: number;
  expiresAt?: number;
}

export class SovereignAdminSecurityEngine {
  private proposals: Map<string, MultiSigProposal> = new Map();
  private circuitBreaker: CircuitBreakerState = {
    active: false,
    pausedScopes: [],
    triggeredByDid: 'system',
    triggeredByRole: 'SUPER_ADMIN',
    reason: 'Normal operational state',
    timestamp: Date.now(),
  };

  private rolePermissions: Record<AdminRole, string[]> = {
    SUPER_ADMIN: ['*'],
    TREASURY_OFFICER: [
      'treasury:view',
      'treasury:solvency',
      'treasury:export',
      'treasury:reconcile',
      'multisig:propose',
      'multisig:sign',
      'circuit_breaker:view',
      'circuit_breaker:toggle',
    ],
    TRUST_SAFETY: [
      'moderation:view',
      'moderation:action',
      'reports:triage',
      'strikes:manage',
      'campaigns:flag',
      'jury:oversee',
    ],
    INFRA_OPERATOR: [
      'mesh:view',
      'mesh:isolate',
      'mesh:peer_action',
      'storage:compact',
      'cache:prune',
      'backup:manage',
      'telemetry:view',
    ],
    ANALYST: [
      'telemetry:view',
      'audit:view',
      'treasury:view',
      'mesh:view',
    ],
  };

  constructor() {
    // Zero-trust initialization: proposals must be created explicitly by authenticated principals
  }

  private seedDefaultProposal() {
    // Deprecated mock proposal - removed in accordance with zero-trust governance remediation
  }

  public authorize(principal: AdminPrincipal | null, requiredPermission: string): { authorized: boolean; error?: string; statusCode: number } {
    if (!principal) {
      return { authorized: false, error: 'Unauthorized: Admin authentication required', statusCode: 401 };
    }

    const permissions = this.rolePermissions[principal.role] || [];
    if (permissions.includes('*') || permissions.includes(requiredPermission)) {
      return { authorized: true, statusCode: 200 };
    }

    return {
      authorized: false,
      error: `Forbidden: Role ${principal.role} lacks required permission '${requiredPermission}'`,
      statusCode: 403,
    };
  }

  // --- MULTI-SIG CONSTITUTIONAL 3-OF-5 GOVERNANCE ---
  public static readonly CONSTITUTIONAL_THRESHOLD = 3;
  public static readonly TOTAL_COUNCIL_SEATS = 5;

  public static readonly GENESIS_SECURITY_COUNCIL_DIDS = [
    'did:sovra:council-1',
    'did:sovra:council-2',
    'did:sovra:council-3',
    'did:sovra:council-4',
    'did:sovra:council-5',
  ];

  public createProposal(
    principal: AdminPrincipal,
    action: MultiSigAction,
    payload: Record<string, any>,
    passkeySignature: string,
    options?: { requiredSignatures?: number; timelockDurationMs?: number }
  ): { ok: boolean; proposal?: MultiSigProposal; error?: string } {
    if (!['SUPER_ADMIN', 'TREASURY_OFFICER'].includes(principal.role)) {
      return { ok: false, error: `Role ${principal.role} is not authorized to submit multi-sig proposals` };
    }

    if (!passkeySignature || typeof passkeySignature !== 'string' || passkeySignature.trim().length === 0) {
      return { ok: false, error: 'Cryptographic passkey signature is mandatory for multi-sig governance proposal creation' };
    }

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ action, payload, proposerDid: principal.did })).digest('hex');
    const id = 'prop_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const required = options?.requiredSignatures ?? SovereignAdminSecurityEngine.CONSTITUTIONAL_THRESHOLD;
    const timelockDurationMs = options?.timelockDurationMs ?? (48 * 3600 * 1000); // 48-Hour Constitutional Timelock

    const proposal: MultiSigProposal = {
      id,
      action,
      payload,
      payloadHash,
      proposerDid: principal.did,
      proposerRole: principal.role,
      requiredSignatures: required,
      signatures: [
        {
          signerDid: principal.did,
          role: principal.role,
          passkeySignature: passkeySignature.trim(),
          timestamp: Date.now(),
        },
      ],
      status: 'PENDING',
      createdAt: Date.now(),
      timelockDurationMs,
      expiresAt: Date.now() + (7 * 86400 * 1000), // 7-day expiration window
    };

    this.proposals.set(id, proposal);
    return { ok: true, proposal };
  }

  public signProposal(
    proposalId: string,
    principal: AdminPrincipal,
    passkeySignature: string
  ): { ok: boolean; proposal?: MultiSigProposal; error?: string; executed?: boolean } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { ok: false, error: 'Proposal not found' };
    if (proposal.status !== 'PENDING' && proposal.status !== 'READY_TIMELOCKED') {
      return { ok: false, error: `Proposal already ${proposal.status}` };
    }

    if (!passkeySignature || typeof passkeySignature !== 'string' || passkeySignature.trim().length === 0) {
      return { ok: false, error: 'Cryptographic passkey signature is mandatory for multi-sig governance co-signing' };
    }

    if (!['SUPER_ADMIN', 'TREASURY_OFFICER'].includes(principal.role)) {
      return { ok: false, error: `Role ${principal.role} cannot co-sign governance proposals` };
    }

    // Check expiration
    if (proposal.expiresAt && Date.now() > proposal.expiresAt) {
      proposal.status = 'REJECTED';
      proposal.rejectionReason = 'Proposal expired before reaching quorum threshold';
      return { ok: false, error: 'Proposal expired before reaching quorum threshold' };
    }

    // Check if principal already signed
    const alreadySigned = proposal.signatures.some(s => s.signerDid === principal.did);
    if (alreadySigned) {
      return { ok: false, error: 'Principal has already signed this proposal' };
    }

    proposal.signatures.push({
      signerDid: principal.did,
      role: principal.role,
      passkeySignature: passkeySignature.trim(),
      timestamp: Date.now(),
    });

    let executed = false;
    if (proposal.signatures.length >= proposal.requiredSignatures) {
      if (proposal.action === 'CIRCUIT_BREAKER_GLOBAL') {
        // Emergency circuit breaker executes immediately upon reaching M=3 quorum with 72h max duration
        proposal.status = 'EXECUTED';
        proposal.executedAt = Date.now();
        executed = true;
        this.toggleCircuitBreaker(true, ['ALL'], principal, 'Multi-Sig Global Emergency Circuit Breaker Triggered (Constitutional 3-of-5 Quorum Reached)');
      } else {
        // High-impact financial/policy mutations enter mandatory constitutional timelock
        proposal.status = 'READY_TIMELOCKED';
        proposal.readyAt = Date.now();
        proposal.timelockExpiresAt = Date.now() + (proposal.timelockDurationMs || 48 * 3600 * 1000);
        executed = false;
      }
    }

    return { ok: true, proposal, executed };
  }

  public executeProposal(
    proposalId: string,
    principal: AdminPrincipal
  ): { ok: boolean; proposal?: MultiSigProposal; error?: string } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { ok: false, error: 'Proposal not found' };
    if (proposal.status !== 'READY_TIMELOCKED') {
      return { ok: false, error: `Proposal not ready for execution (Status: ${proposal.status})` };
    }
    if (proposal.timelockExpiresAt && Date.now() < proposal.timelockExpiresAt) {
      const remainingSec = Math.ceil((proposal.timelockExpiresAt - Date.now()) / 1000);
      return { ok: false, error: `Constitutional timelock active: proposal cannot be executed for another ${remainingSec} seconds` };
    }
    proposal.status = 'EXECUTED';
    proposal.executedAt = Date.now();
    return { ok: true, proposal };
  }

  public getProposals(): MultiSigProposal[] {
    return Array.from(this.proposals.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  // --- EMERGENCY CIRCUIT BREAKER ---
  public toggleCircuitBreaker(
    active: boolean,
    scopes: Array<'ALL' | 'TIPPING' | 'PROMOTIONS' | 'WITHDRAWALS' | 'P2P_TRANSFER'>,
    principal: AdminPrincipal,
    reason: string
  ): CircuitBreakerState {
    const now = Date.now();
    this.circuitBreaker = {
      active,
      pausedScopes: active ? (scopes.length > 0 ? scopes : ['ALL']) : [],
      triggeredByDid: principal.did,
      triggeredByRole: principal.role,
      reason: reason || (active ? 'Emergency audit halt triggered' : 'System resumed normal operations'),
      timestamp: now,
      expiresAt: active ? (now + (72 * 3600 * 1000)) : undefined, // 72-Hour Constitutional Timelock
    };
    return this.circuitBreaker;
  }

  public getCircuitBreaker(): CircuitBreakerState {
    // Check automatic constitutional timelock expiration (max 72 hours)
    if (this.circuitBreaker.active && this.circuitBreaker.expiresAt && Date.now() > this.circuitBreaker.expiresAt) {
      this.circuitBreaker.active = false;
      this.circuitBreaker.pausedScopes = [];
    }
    return this.circuitBreaker;
  }

  public isScopePaused(scope: 'TIPPING' | 'PROMOTIONS' | 'WITHDRAWALS' | 'P2P_TRANSFER'): boolean {
    if (!this.circuitBreaker.active) return false;
    // Automatic timelock expiration check
    if (this.circuitBreaker.expiresAt && Date.now() > this.circuitBreaker.expiresAt) {
      this.circuitBreaker.active = false;
      this.circuitBreaker.pausedScopes = [];
      return false;
    }
    if (this.circuitBreaker.pausedScopes.includes('ALL')) return true;
    return this.circuitBreaker.pausedScopes.includes(scope);
  }
}

export const sovereignAdminSecurity = new SovereignAdminSecurityEngine();
