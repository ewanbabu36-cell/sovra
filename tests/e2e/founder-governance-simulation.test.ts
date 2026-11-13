/**
 * @file tests/e2e/founder-governance-simulation.test.ts
 * End-to-End Governance Simulation: Autonomous Continuity & Founder Independence.
 *
 * Simulates:
 * 1. Founder starts in pseudonymous posture under Tier 1/2 separation.
 * 2. Sudden founder disappearance/incapacitation during active network operation.
 * 3. Autonomous succession state transition without interrupting blockchain consensus.
 * 4. Quadratic community voting on SIP-PROTOCOL proposal without founder presence.
 * 5. Multi-party threshold (3-of-5) execution through timelock buffer.
 * 6. Cryptographic tamper-evident audit log verification.
 * 7. Real-time public transparency dashboard metrics verification.
 */

import { describe, it, expect } from 'vitest';
import {
  generateEd25519KeyPair,
  signEd25519,
  bytesToHex,
} from '@sovra/crypto';
import {
  FounderIdentityRegistry,
  AdminIdentityRegistry,
  RolePermissionRegistry,
  MultiPartyApprovalEngine,
  GovernanceProposalEngine,
  GovernanceVotingEngine,
  TamperEvidentAuditLog,
  KeyRotationRevocationEngine,
  SuccessionManagementEngine,
  GovernanceDocumentRegistry,
  PublicTransparencyDashboard,
} from '@sovra/identity';

describe('E2E Simulation: Community-First, Founder-Independent Governance', () => {
  it('successfully transitions from founder guidance to autonomous community stewardship and executes SIP', () => {
    // -----------------------------------------------------------------------
    // STEP 1: INITIALIZE ECOSYSTEM & FOUNDER IN PSEUDONYMOUS POSTURE
    // -----------------------------------------------------------------------
    const founderKeys = generateEd25519KeyPair();
    const founderRegistry = new FounderIdentityRegistry();

    const founderRecord = founderRegistry.registerFounder({
      pseudonym: 'SovereignGenesis',
      publicKeyBytes: founderKeys.publicKey,
      statutoryComplianceRegistered: true,
      complianceJurisdiction: 'Decentralized Sovereign Association',
      registeredAt: 1000,
    });

    expect(founderRecord.revealStatus).toBe('PSEUDONYMOUS');
    expect(founderRegistry.getPublicProfile().pseudonym).toBe('SovereignGenesis');

    // Setup 5 independent Technical Committee maintainers
    const maintainerKeys = Array.from({ length: 5 }, () => generateEd25519KeyPair());
    const maintainerDIDs = maintainerKeys.map((k, i) => `did:sovra:tech-comm:${i + 1}`);

    const successionEngine = new SuccessionManagementEngine();
    successionEngine.initializeSuccession({
      founderDid: founderRecord.founderDid,
      successorCouncilDIDs: maintainerDIDs,
      inactivityTimeoutSeconds: 180 * 86400, // 180 days
      initialTimestamp: 1000,
    });

    const auditLog = new TamperEvidentAuditLog();

    // -----------------------------------------------------------------------
    // STEP 2: SIMULATE SUDDEN FOUNDER DISAPPEARANCE (185 DAYS OF INACTIVITY)
    // -----------------------------------------------------------------------
    const tCurrent = 1000 + 185 * 86400; // 185 days later
    const successionCheck = successionEngine.evaluateLiveness(tCurrent);

    expect(successionCheck.state).toBe('COMMUNITY_STEWARDSHIP');
    expect(successionEngine.isCommunityStewardshipActive()).toBe(true);

    // -----------------------------------------------------------------------
    // STEP 3: COMMUNITY SUBMITS CRITICAL PROTOCOL UPGRADE (SIP-PROTOCOL)
    // -----------------------------------------------------------------------
    const proposalEngine = new GovernanceProposalEngine();
    const proposal = proposalEngine.submitProposal({
      category: 'SIP_PROTOCOL',
      title: 'Upgrade P2P BitSwap Buffer and Activate Mainnet Sentry Federation',
      description: 'Expands P2P BitSwap chunk buffers to 2MB and enforces multi-provider sentry nodes.',
      proposerDid: maintainerDIDs[0]!,
      conflictDeclared: false,
      createdAt: tCurrent,
      customDiscussionDays: 30, // 30-day discussion required for protocol
      votingDays: 14,
    });

    expect(proposal.stage).toBe('DISCUSSION');

    // 30 days of community discussion elapse
    const tVotingStart = tCurrent + 31 * 86400;
    proposalEngine.activateVoting(proposal.id, tVotingStart);
    expect(proposal.stage).toBe('VOTING_ACTIVE');

    // -----------------------------------------------------------------------
    // STEP 4: QUADRATIC VOTING WITH ANTI-WHALE PROTECTION
    // -----------------------------------------------------------------------
    const votingEngine = new GovernanceVotingEngine();

    // 1 hostile whale with 5,000,000 SOV votes NO
    const whaleKey = generateEd25519KeyPair();
    const whaleDid = 'did:sovra:hostile-whale';
    const whaleVotePayload = `SOVRA_VOTE:${proposal.id}:NO:${whaleDid}`;
    const whaleSig = signEd25519(whaleKey.privateKey, Buffer.from(whaleVotePayload, 'utf8'));

    votingEngine.castVote({
      proposalId: proposal.id,
      voterProfile: {
        did: whaleDid,
        stakeMicroSov: 5_000_000_000_000n,
        accountAgeDays: 450,
        usageScore: 1.0,
      },
      option: 'NO',
      signatureHex: bytesToHex(whaleSig),
      voterPublicKeyBytes: whaleKey.publicKey,
      timestamp: tVotingStart + 100,
    });

    // 60 active community members vote YES
    for (let i = 0; i < 60; i++) {
      const memKey = generateEd25519KeyPair();
      const memDid = `did:sovra:voter:${i}`;
      const memVotePayload = `SOVRA_VOTE:${proposal.id}:YES:${memDid}`;
      const memSig = signEd25519(memKey.privateKey, Buffer.from(memVotePayload, 'utf8'));

      votingEngine.castVote({
        proposalId: proposal.id,
        voterProfile: {
          did: memDid,
          stakeMicroSov: 250_000_000n, // 250 SOV
          accountAgeDays: 200,
          usageScore: 0.9,
        },
        option: 'YES',
        signatureHex: bytesToHex(memSig),
        voterPublicKeyBytes: memKey.publicKey,
        timestamp: tVotingStart + 200 + i * 10,
      });
    }

    // Tally ballots (61 voters, 100 total network DIDs)
    const tally = votingEngine.tallyProposal(proposal.id, 'SIP_PROTOCOL', 100);

    expect(tally.quorumReached).toBe(true);
    expect(tally.thresholdMet).toBe(true);
    expect(tally.passed).toBe(true);
    expect(tally.winningOption).toBe('YES');

    // -----------------------------------------------------------------------
    // STEP 5: MULTI-PARTY APPROVAL & TIMELOCK EXECUTION (3-OF-5 THRESHOLD)
    // -----------------------------------------------------------------------
    const mpa = new MultiPartyApprovalEngine();
    const action = mpa.proposeAction({
      actionType: 'PROTOCOL_PARAMETER_UPGRADE',
      proposerDid: maintainerDIDs[0]!,
      payload: {
        proposalId: proposal.id,
        bitswapBufferSizeKB: 2048,
        sentryNodesRequired: 4,
      },
      eligibleSigners: maintainerDIDs,
      requiredApprovals: 3,
      timelockDurationSeconds: 168 * 3600, // 7-day timelock for protocol
      createdAt: tVotingStart + 14 * 86400,
    });

    const tActionCreated = tVotingStart + 14 * 86400;

    // 3 maintainers approve with Ed25519 signatures
    for (let i = 0; i < 3; i++) {
      const hashBytes = Buffer.from(action.payloadHash, 'hex');
      const sig = signEd25519(maintainerKeys[i]!.privateKey, hashBytes);

      mpa.submitApproval({
        actionId: action.id,
        signerDid: maintainerDIDs[i]!,
        signatureHex: bytesToHex(sig),
        signerPublicKeyBytes: maintainerKeys[i]!.publicKey,
        currentTime: tActionCreated + 500,
      });
    }

    expect(action.status).toBe('READY_TIMELOCKED');

    // Execute after timelock (7 days later)
    const tExecution = tActionCreated + 170 * 3600;
    const execution = mpa.executeAction(action.id, maintainerDIDs[0]!, tExecution);

    expect(execution.ok).toBe(true);
    expect(execution.executedPayload.bitswapBufferSizeKB).toBe(2048);

    // -----------------------------------------------------------------------
    // STEP 6: COMMIT TO TAMPER-EVIDENT AUDIT LOG & VERIFY INTEGRITY
    // -----------------------------------------------------------------------
    const prevEntry = auditLog.getEntry(0)!;
    const auditPayloadStr = JSON.stringify(execution.executedPayload);
    const auditPayloadHash = require('crypto').createHash('sha256').update(auditPayloadStr).digest('hex');

    const auditSignPayload = `AUDIT_EVENT:1:${tExecution}:${maintainerDIDs[0]!}:PROTOCOL_UPGRADE_EXECUTED:${auditPayloadHash}:${prevEntry.entryHash}`;
    const auditSig = signEd25519(maintainerKeys[0]!.privateKey, Buffer.from(auditSignPayload, 'utf8'));

    auditLog.appendEntry({
      actorDid: maintainerDIDs[0]!,
      action: 'PROTOCOL_UPGRADE_EXECUTED',
      payload: execution.executedPayload,
      details: 'SIP-PROTOCOL successfully executed by Community Technical Committee.',
      actorPublicKeyBytes: maintainerKeys[0]!.publicKey,
      signatureHex: bytesToHex(auditSig),
      timestamp: tExecution,
    });

    const chainVerification = auditLog.verifyChainIntegrity();
    expect(chainVerification.valid).toBe(true);
    expect(chainVerification.totalEntries).toBe(2);

    // -----------------------------------------------------------------------
    // STEP 7: VERIFY PUBLIC TRANSPARENCY DASHBOARD METRICS
    // -----------------------------------------------------------------------
    const report = PublicTransparencyDashboard.generateReport({
      issuedSupplyMicroSov: 20_000_000_000_000n, // 20M SOV
      permanentlyBurnedMicroSov: 500_000_000_000n, // 500k SOV
      treasuryBalanceMicroSov: 8_000_000_000_000n, // 8M SOV
      pendingActionsCount: 0,
      totalGrantsDistributedMicroSov: 2_000_000_000_000n,
      activeProposalsCount: 0,
      passedProposalsCount: 1,
      rejectedProposalsCount: 0,
      totalRegisteredVoters: 100,
      auditLog,
      founderRegistry,
      successionEngine,
      currentTime: tExecution,
    });

    expect(report.coinMetrics.capInvariantPreserved).toBe(true);
    expect(report.coinMetrics.maxLifetimeSupplyMicroSov).toBe(100_000_000_000_000n);
    expect(report.founderStatus.successionState).toBe('COMMUNITY_STEWARDSHIP');
    expect(report.auditChainMetrics.chainIntegrityValid).toBe(true);
  });
});
