import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEd25519KeyPair,
  signEd25519,
  bytesToHex,
  hexToBytes,
} from '@sovra/crypto';
import {
  FounderIdentityRegistry,
  AdminIdentityRegistry,
  RolePermissionRegistry,
  MultiPartyApprovalEngine,
  GovernanceProposalEngine,
  GovernanceVotingEngine,
  GovernanceQuorumValidator,
  TamperEvidentAuditLog,
  KeyRotationRevocationEngine,
  SuccessionManagementEngine,
  GovernanceDocumentRegistry,
  PublicTransparencyDashboard,
} from '../src/governance/index.js';

describe('SOVRA Foundational Governance & Founder Identity Subsystem', () => {
  let founderKeys: ReturnType<typeof generateEd25519KeyPair>;
  let founderRegistry: FounderIdentityRegistry;

  beforeEach(() => {
    founderKeys = generateEd25519KeyPair();
    founderRegistry = new FounderIdentityRegistry();
  });

  // =========================================================================
  // 1. FOUNDER IDENTITY, PSEUDONYMITY & VOLUNTARY MILESTONE REVEAL
  // =========================================================================
  describe('Founder Identity & Pseudonymity', () => {
    it('registers founder with pseudonym and Ed25519 key, maintaining identity separation', () => {
      const record = founderRegistry.registerFounder({
        pseudonym: 'SovereignArchitect',
        publicKeyBytes: founderKeys.publicKey,
        statutoryComplianceRegistered: true,
        complianceJurisdiction: 'Global Digital Trust',
      });

      expect(record.founderDid).toContain('did:sovra:founder:');
      expect(record.pseudonym).toBe('SovereignArchitect');
      expect(record.currentMilestone).toBe(1);
      expect(record.revealStatus).toBe('PSEUDONYMOUS');
      expect(record.statutoryComplianceRegistered).toBe(true);

      // Public profile omits statutory/internal compliance details
      const publicProfile = founderRegistry.getPublicProfile();
      expect(publicProfile.pseudonym).toBe('SovereignArchitect');
      expect(publicProfile.currentMilestone).toBe(1);
      expect((publicProfile as Record<string, unknown>).complianceJurisdiction).toBeUndefined();
    });

    it('cryptographically signs and verifies official founder statements', () => {
      founderRegistry.registerFounder({
        pseudonym: 'SovereignArchitect',
        publicKeyBytes: founderKeys.publicKey,
      });

      const message = Buffer.from('OFFICIAL_FOUNDER_DIRECTIVE_001', 'utf8');
      const sig = signEd25519(founderKeys.privateKey, message);
      const sigHex = bytesToHex(sig);

      const isValid = founderRegistry.verifyFounderSignature(message, sigHex);
      expect(isValid).toBe(true);

      const tamperedMessage = Buffer.from('TAMPERED_DIRECTIVE_001', 'utf8');
      expect(founderRegistry.verifyFounderSignature(tamperedMessage, sigHex)).toBe(false);
    });

    it('advances milestones voluntarily with signed cryptographic intent', () => {
      founderRegistry.registerFounder({
        pseudonym: 'SovereignArchitect',
        publicKeyBytes: founderKeys.publicKey,
      });

      // Sign milestone advance intent
      const payload = 'SOVRA_MILESTONE_ADVANCE:2:PARTIAL_ATTESTATION:Verified code audit completed';
      const sig = signEd25519(founderKeys.privateKey, Buffer.from(payload, 'utf8'));

      const updated = founderRegistry.advanceMilestone({
        milestone: 2,
        choice: 'PARTIAL_ATTESTATION',
        statement: 'Verified code audit completed',
        signatureHex: bytesToHex(sig),
      });

      expect(updated.currentMilestone).toBe(2);
      expect(updated.revealStatus).toBe('PARTIAL_ATTESTATION');
      expect(updated.publicDisclosureStatement).toBe('Verified code audit completed');
    });

    it('constitutional guardrail: detects and rejects forced de-anonymization proposals', () => {
      founderRegistry.registerFounder({
        pseudonym: 'SovereignArchitect',
        publicKeyBytes: founderKeys.publicKey,
      });

      const illicitProposal = 'Urgent Resolution to Force Reveal Founder Legal Identity and KYC';
      const check = founderRegistry.checkForcedRevealImmunity(illicitProposal);

      expect(check.permitted).toBe(false);
      expect(check.reason).toContain('CONSTITUTIONAL VIOLATION');
      expect(check.reason).toContain('force reveal');
    });
  });

  // =========================================================================
  // 2. ANTI-FOUNDER-UNILATERALISM & ROLE BOUNDARIES
  // =========================================================================
  describe('Anti-Founder-Unilateralism & Role Boundaries', () => {
    it('strictly forbids unilateral coin minting by founder or anyone', () => {
      expect(() => {
        RolePermissionRegistry.assertNonFounderUnilateral('UNILATERAL_COIN_MINT', 'did:sovra:founder:01');
      }).toThrowError(/CRITICAL CONSTITUTIONAL VIOLATION.*UNILATERAL_COIN_MINT/);
    });

    it('strictly forbids unilateral treasury withdrawal or ledger editing', () => {
      expect(() => {
        RolePermissionRegistry.assertNonFounderUnilateral('UNILATERAL_TREASURY_WITHDRAW', 'did:sovra:founder:01');
      }).toThrowError(/CRITICAL CONSTITUTIONAL VIOLATION.*UNILATERAL_TREASURY_WITHDRAW/);

      expect(() => {
        RolePermissionRegistry.assertNonFounderUnilateral('UNILATERAL_LEDGER_EDIT', 'did:sovra:founder:01');
      }).toThrowError(/CRITICAL CONSTITUTIONAL VIOLATION.*UNILATERAL_LEDGER_EDIT/);
    });

    it('strictly forbids accessing user private keys or compromising E2EE', () => {
      expect(() => {
        RolePermissionRegistry.assertNonFounderUnilateral('ACCESS_USER_PRIVATE_KEYS', 'did:sovra:founder:01');
      }).toThrowError(/CRITICAL CONSTITUTIONAL VIOLATION.*ACCESS_USER_PRIVATE_KEYS/);

      expect(() => {
        RolePermissionRegistry.assertNonFounderUnilateral('DECRYPT_E2EE_USER_MESSAGES', 'did:sovra:founder:01');
      }).toThrowError(/CRITICAL CONSTITUTIONAL VIOLATION.*DECRYPT_E2EE_USER_MESSAGES/);
    });
  });

  // =========================================================================
  // 3. MULTI-PARTY APPROVAL ENGINE (M-of-N THRESHOLD & TIMELOCK)
  // =========================================================================
  describe('Multi-Party Approval Engine', () => {
    it('executes high-impact treasury transfer only upon 3-of-5 signatures and timelock expiration', () => {
      const mpa = new MultiPartyApprovalEngine();

      // Setup 5 signers
      const signers = Array.from({ length: 5 }, () => generateEd25519KeyPair());
      const signerDIDs = signers.map((s, idx) => `did:sovra:maintainer:${idx + 1}`);

      const proposal = mpa.proposeAction({
        actionType: 'TREASURY_TRANSFER',
        proposerDid: signerDIDs[0]!,
        payload: { recipient: 'did:sovra:grantee:42', amountMicroSov: '50000000000' },
        eligibleSigners: signerDIDs,
        requiredApprovals: 3,
        timelockDurationSeconds: 100, // 100 seconds
        createdAt: 1000,
      });

      expect(proposal.status).toBe('PENDING');

      // Helper to submit approval
      const approve = (signerIdx: number) => {
        const hashBytes = Buffer.from(proposal.payloadHash, 'hex');
        const sig = signEd25519(signers[signerIdx]!.privateKey, hashBytes);
        return mpa.submitApproval({
          actionId: proposal.id,
          signerDid: signerDIDs[signerIdx]!,
          signatureHex: bytesToHex(sig),
          signerPublicKeyBytes: signers[signerIdx]!.publicKey,
          currentTime: 1010,
        });
      };

      // Signer 0 approves
      const res1 = approve(0);
      expect(res1.currentApprovals).toBe(1);
      expect(res1.status).toBe('PENDING');

      // Signer 1 approves
      const res2 = approve(1);
      expect(res2.currentApprovals).toBe(2);
      expect(res2.status).toBe('PENDING');

      // Unauthorized signer attempts approval -> fails
      const rogueKey = generateEd25519KeyPair();
      const rogueSig = signEd25519(rogueKey.privateKey, Buffer.from(proposal.payloadHash, 'hex'));
      expect(() => {
        mpa.submitApproval({
          actionId: proposal.id,
          signerDid: 'did:sovra:rogue',
          signatureHex: bytesToHex(rogueSig),
          signerPublicKeyBytes: rogueKey.publicKey,
        });
      }).toThrowError(/not authorized/);

      // Signer 2 approves -> threshold (3) met! Transitions to READY_TIMELOCKED
      const res3 = approve(2);
      expect(res3.currentApprovals).toBe(3);
      expect(res3.status).toBe('READY_TIMELOCKED');

      // Attempt immediate execution during timelock (time = 1050 < 1010 + 100 = 1110)
      expect(() => {
        mpa.executeAction(proposal.id, signerDIDs[0]!, 1050);
      }).toThrowError(/Timelock restriction active/);

      // Execute after timelock (time = 1120 > 1110)
      const execution = mpa.executeAction(proposal.id, signerDIDs[0]!, 1120);
      expect(execution.ok).toBe(true);
      expect(execution.executedPayload.recipient).toBe('did:sovra:grantee:42');

      const finalState = mpa.getAction(proposal.id);
      expect(finalState?.status).toBe('EXECUTED');
    });
  });

  // =========================================================================
  // 4. QUADRATIC VOTING & ANTI-WHALE / ANTI-PLUTOCRACY SAFEGUARDS
  // =========================================================================
  describe('Quadratic Voting & Anti-Whale Safeguards', () => {
    it('100 community members overpower a 10,000,000 SOV whale due to quadratic weighting and whale cap', () => {
      const votingEngine = new GovernanceVotingEngine();
      const proposalId = 'sip-tech-test-01';

      // Whale: 10,000,000 SOV (10^13 micro-SOV), age: 400d, usage: 1.0
      const whaleKey = generateEd25519KeyPair();
      const whaleDid = 'did:sovra:whale';
      const whaleProfile = {
        did: whaleDid,
        stakeMicroSov: 10_000_000_000_000n,
        accountAgeDays: 400,
        usageScore: 1.0,
      };

      // Whale votes NO
      const whaleVotePayload = `SOVRA_VOTE:${proposalId}:NO:${whaleDid}`;
      const whaleSig = signEd25519(whaleKey.privateKey, Buffer.from(whaleVotePayload, 'utf8'));

      votingEngine.castVote({
        proposalId,
        voterProfile: whaleProfile,
        option: 'NO',
        signatureHex: bytesToHex(whaleSig),
        voterPublicKeyBytes: whaleKey.publicKey,
      });

      // 50 community members: 100 SOV each (10^8 micro-SOV), age: 365d, usage: 1.0
      for (let i = 0; i < 50; i++) {
        const memKey = generateEd25519KeyPair();
        const memDid = `did:sovra:member:${i}`;
        const memProfile = {
          did: memDid,
          stakeMicroSov: 100_000_000n,
          accountAgeDays: 365,
          usageScore: 1.0,
        };

        const memPayload = `SOVRA_VOTE:${proposalId}:YES:${memDid}`;
        const memSig = signEd25519(memKey.privateKey, Buffer.from(memPayload, 'utf8'));

        votingEngine.castVote({
          proposalId,
          voterProfile: memProfile,
          option: 'YES',
          signatureHex: bytesToHex(memSig),
          voterPublicKeyBytes: memKey.publicKey,
        });
      }

      // Total eligible voters = 100
      const tally = votingEngine.tallyProposal(proposalId, 'SIP_TECH', 100);

      // YES votes heavily overpower NO votes!
      expect(tally.optionWeights['YES']).toBeGreaterThan(tally.optionWeights['NO']!);
      expect(tally.winningOption).toBe('YES');
      expect(tally.passed).toBe(true);
    });

    it('rejects Sybil accounts under 30 days old', () => {
      const votingEngine = new GovernanceVotingEngine();
      const sybilProfile = {
        did: 'did:sovra:sybil-infant',
        stakeMicroSov: 500_000_000n,
        accountAgeDays: 12, // Only 12 days old!
        usageScore: 0.5,
      };

      const key = generateEd25519KeyPair();
      expect(() => {
        votingEngine.castVote({
          proposalId: 'sip-tech-01',
          voterProfile: sybilProfile,
          option: 'YES',
          signatureHex: bytesToHex(new Uint8Array(64)),
          voterPublicKeyBytes: key.publicKey,
        });
      }).toThrowError(/Sybil protection active.*30-day maturity/);
    });
  });

  // =========================================================================
  // 5. CONSTITUTIONAL REDLINE SCREENING ON PROPOSALS
  // =========================================================================
  describe('Constitutional Redline Screening', () => {
    let proposalEngine: GovernanceProposalEngine;

    beforeEach(() => {
      proposalEngine = new GovernanceProposalEngine();
    });

    it('rejects proposals attempting compulsory founder de-anonymization', () => {
      expect(() => {
        proposalEngine.submitProposal({
          category: 'SIP_CONST',
          title: 'Mandatory KYC founder and unmask identity',
          description: 'We demand the founder disclose legal name and passport to the assembly immediately.',
          proposerDid: 'did:sovra:malicious-actor',
        });
      }).toThrowError(/CONSTITUTIONAL REDLINE BREACH.*compulsory de-anonymization/);
    });

    it('rejects proposals attempting to inflate supply beyond 100M SOV', () => {
      expect(() => {
        proposalEngine.submitProposal({
          category: 'SIP_PROTOCOL',
          title: 'Emergency Inflation to Inflate Cap',
          description: 'This proposal intends to mint beyond 100M tokens to fund operations.',
          proposerDid: 'did:sovra:inflationist',
        });
      }).toThrowError(/CONSTITUTIONAL REDLINE BREACH.*100,000,000 SOV hard cap/);
    });

    it('rejects proposals attempting to grant unilateral founder veto', () => {
      expect(() => {
        proposalEngine.submitProposal({
          category: 'SIP_CONST',
          title: 'Grant Founder Veto over Assembly Decisions',
          description: 'This resolution grants founder unilateral veto power over all SIP outcomes.',
          proposerDid: 'did:sovra:monarchist',
        });
      }).toThrowError(/CONSTITUTIONAL REDLINE BREACH.*unilateral founder override/);
    });

    it('accepts legitimate proposals and advances stages per category rules', () => {
      const legit = proposalEngine.submitProposal({
        category: 'SIP_TECH',
        title: 'Upgrade P2P BitSwap chunking buffer to 1MB',
        description: 'Optimizes P2P block exchange throughput across geo-distributed nodes.',
        proposerDid: 'did:sovra:dev:01',
        createdAt: 1000,
      });

      expect(legit.stage).toBe('DISCUSSION');
      expect(legit.category).toBe('SIP_TECH');

      // Cannot activate voting immediately before 14-day discussion window
      expect(() => {
        proposalEngine.activateVoting(legit.id, 1000 + 86400 * 5); // 5 days later
      }).toThrowError(/Mandatory discussion window is active/);

      // Activates after 14 days
      const activated = proposalEngine.activateVoting(legit.id, 1000 + 86400 * 15);
      expect(activated.stage).toBe('VOTING_ACTIVE');
    });
  });

  // =========================================================================
  // 6. TAMPER-EVIDENT HASH-CHAINED AUDIT LOG
  // =========================================================================
  describe('Tamper-Evident Audit Log', () => {
    it('appends cryptographically chained entries and validates 100% chain integrity', () => {
      const auditLog = new TamperEvidentAuditLog();
      const adminKey = generateEd25519KeyPair();
      const adminDid = 'did:sovra:admin:01';

      // Append 3 events
      for (let i = 1; i <= 3; i++) {
        const action = `ADMIN_OPERATION_${i}`;
        const prevEntry = auditLog.getEntry(i - 1)!;
        const payloadStr = JSON.stringify({ step: i });
        const payloadHash = require('crypto').createHash('sha256').update(payloadStr).digest('hex');

        const signPayload = `AUDIT_EVENT:${i}:${1000 + i * 10}:${adminDid}:${action}:${payloadHash}:${prevEntry.entryHash}`;
        const sig = signEd25519(adminKey.privateKey, Buffer.from(signPayload, 'utf8'));

        auditLog.appendEntry({
          actorDid: adminDid,
          action,
          payload: { step: i },
          details: `Executed step ${i}`,
          actorPublicKeyBytes: adminKey.publicKey,
          signatureHex: bytesToHex(sig),
          timestamp: 1000 + i * 10,
        });
      }

      expect(auditLog.getLength()).toBe(4); // Genesis + 3 entries
      const verification = auditLog.verifyChainIntegrity();
      expect(verification.valid).toBe(true);
      expect(verification.totalEntries).toBe(4);
    });

    it('detects tampering or bit-flips in historical audit records', () => {
      const auditLog = new TamperEvidentAuditLog();
      const adminKey = generateEd25519KeyPair();
      const adminDid = 'did:sovra:admin:01';

      // Append 2 events
      for (let i = 1; i <= 2; i++) {
        const action = `ADMIN_OP_${i}`;
        const prevEntry = auditLog.getEntry(i - 1)!;
        const payloadStr = JSON.stringify({ val: i });
        const payloadHash = require('crypto').createHash('sha256').update(payloadStr).digest('hex');
        const signPayload = `AUDIT_EVENT:${i}:${1000 + i}:${adminDid}:${action}:${payloadHash}:${prevEntry.entryHash}`;
        const sig = signEd25519(adminKey.privateKey, Buffer.from(signPayload, 'utf8'));

        auditLog.appendEntry({
          actorDid: adminDid,
          action,
          payload: { val: i },
          details: `Op ${i}`,
          actorPublicKeyBytes: adminKey.publicKey,
          signatureHex: bytesToHex(sig),
          timestamp: 1000 + i,
        });
      }

      // Tamper simulation: mutate entry 1
      const tamperedEntry = auditLog.getEntry(1)!;
      // @ts-expect-error deliberately tampering for test
      tamperedEntry.details = 'MALICIOUS_TAMPERED_DETAILS';

      const verification = auditLog.verifyChainIntegrity();
      expect(verification.valid).toBe(false);
      expect(verification.failureReason).toContain('tampering detected');
      expect(verification.brokenSequence).toBe(1);
    });
  });

  // =========================================================================
  // 7. KEY ROTATION & EMERGENCY REVOCATION
  // =========================================================================
  describe('Key Rotation & Emergency Revocation', () => {
    it('executes dual-signed key rotation successfully', () => {
      const engine = new KeyRotationRevocationEngine();
      const oldKey = generateEd25519KeyPair();
      const newKey = generateEd25519KeyPair();

      const oldDid = 'did:sovra:old';
      const newDid = 'did:sovra:new';
      const timestamp = 5000;
      const oldPubHex = bytesToHex(oldKey.publicKey);
      const newPubHex = bytesToHex(newKey.publicKey);

      const payload = `SOVRA_KEY_ROTATION:${oldDid}:${newDid}:${oldPubHex}:${newPubHex}:1:${timestamp}`;
      const payloadBytes = Buffer.from(payload, 'utf8');

      const oldSig = signEd25519(oldKey.privateKey, payloadBytes);
      const newSig = signEd25519(newKey.privateKey, payloadBytes);

      const record = engine.registerKeyRotation({
        oldDid,
        newDid,
        oldPublicKeyBytes: oldKey.publicKey,
        newPublicKeyBytes: newKey.publicKey,
        rotationSequence: 1,
        oldKeySignatureHex: bytesToHex(oldSig),
        newKeySignatureHex: bytesToHex(newSig),
        timestamp,
      });

      expect(record.oldDid).toBe(oldDid);
      expect(record.newDid).toBe(newDid);
      // Old key is superseded and blacklisted
      expect(engine.isRevoked(oldPubHex)).toBe(true);
    });

    it('blacklists compromised keys immediately upon emergency revocation', () => {
      const engine = new KeyRotationRevocationEngine();
      const authKey = generateEd25519KeyPair();
      const compromisedKeyHex = 'aa'.repeat(32);
      const targetDid = 'did:sovra:compromised-node';
      const timestamp = 6000;

      const payload = `SOVRA_REVOCATION:${targetDid}:${compromisedKeyHex}:COMPROMISED:did:sovra:security-council:${timestamp}`;
      const sig = signEd25519(authKey.privateKey, Buffer.from(payload, 'utf8'));

      engine.emergencyRevokeKey({
        targetDid,
        targetKeyHex: compromisedKeyHex,
        reason: 'COMPROMISED',
        revokedByDid: 'did:sovra:security-council',
        authorizerPublicKeyBytes: authKey.publicKey,
        signatureHex: bytesToHex(sig),
        timestamp,
      });

      expect(engine.isRevoked(targetDid)).toBe(true);
      expect(engine.isRevoked(compromisedKeyHex)).toBe(true);
    });
  });

  // =========================================================================
  // 8. FOUNDER SUCCESSION & AUTONOMOUS CONTINUITY
  // =========================================================================
  describe('Founder Succession & Autonomous Continuity', () => {
    it('triggers automated Community Stewardship upon 180-day founder inactivity', () => {
      const succession = new SuccessionManagementEngine();
      const founderDid = 'did:sovra:founder:01';
      const council = ['did:sovra:c1', 'did:sovra:c2', 'did:sovra:c3'];

      const start = 1000;
      succession.initializeSuccession({
        founderDid,
        successorCouncilDIDs: council,
        inactivityTimeoutSeconds: 180 * 86400,
        initialTimestamp: start,
      });

      expect(succession.getRecord().state).toBe('ACTIVE_FOUNDER');

      // Check after 60 days -> still active
      const eval1 = succession.evaluateLiveness(start + 60 * 86400);
      expect(eval1.state).toBe('ACTIVE_FOUNDER');

      // Check after 150 days -> grace period (>75% timeout)
      const eval2 = succession.evaluateLiveness(start + 150 * 86400);
      expect(eval2.state).toBe('INACTIVITY_GRACE');

      // Check after 185 days (>180d) -> automated succession triggered!
      const eval3 = succession.evaluateLiveness(start + 185 * 86400);
      expect(eval3.state).toBe('COMMUNITY_STEWARDSHIP');
      expect(succession.isCommunityStewardshipActive()).toBe(true);
      expect(eval3.handoverStatement).toContain('Autonomous succession triggered');
    });

    it('executes voluntary founder retirement seamlessly', () => {
      const succession = new SuccessionManagementEngine();
      const founderKey = generateEd25519KeyPair();
      const founderDid = 'did:sovra:founder:01';
      const council = ['did:sovra:c1', 'did:sovra:c2', 'did:sovra:c3'];

      succession.initializeSuccession({
        founderDid,
        successorCouncilDIDs: council,
        initialTimestamp: 1000,
      });

      const statement = 'I step down to complete the decentralization of SOVRA.';
      const payload = `SOVRA_VOLUNTARY_HANDOVER:${founderDid}:${statement}:2000`;
      const sig = signEd25519(founderKey.privateKey, Buffer.from(payload, 'utf8'));

      const updated = succession.executeVoluntaryHandover({
        founderDid,
        founderPublicKeyBytes: founderKey.publicKey,
        statement,
        signatureHex: bytesToHex(sig),
        timestamp: 2000,
      });

      expect(updated.state).toBe('COMMUNITY_STEWARDSHIP');
      expect(updated.handoverStatement).toBe(statement);
    });
  });

  // =========================================================================
  // 9. PUBLIC TRANSPARENCY DASHBOARD & DOCUMENT REGISTRY
  // =========================================================================
  describe('Transparency Dashboard & Document Registry', () => {
    it('registers canonical documents and verifies content hashes', () => {
      const docRegistry = new GovernanceDocumentRegistry();
      const policyText = '# SOVRA FOUNDER IDENTITY POLICY\nCommunity First, Founder Independent.';

      const doc = docRegistry.registerDocument({
        id: 'gov-pol-001',
        title: 'Founder Identity Policy',
        identifier: 'GOV-POL-001',
        version: '1.0.0',
        content: policyText,
      });

      expect(doc.id).toBe('gov-pol-001');
      expect(doc.sha256Digest).toBeDefined();

      expect(docRegistry.verifyDocumentIntegrity('gov-pol-001', policyText)).toBe(true);
      expect(docRegistry.verifyDocumentIntegrity('gov-pol-001', policyText + ' corrupted')).toBe(false);
    });

    it('generates verifiable public status verifying 100M SOV cap invariant', () => {
      const auditLog = new TamperEvidentAuditLog();
      const report = PublicTransparencyDashboard.generateReport({
        issuedSupplyMicroSov: 25_000_000_000_000n, // 25M SOV
        permanentlyBurnedMicroSov: 1_000_000_000_000n, // 1M SOV
        treasuryBalanceMicroSov: 10_000_000_000_000n, // 10M SOV
        pendingActionsCount: 2,
        totalGrantsDistributedMicroSov: 5_000_000_000_000n,
        activeProposalsCount: 3,
        passedProposalsCount: 12,
        rejectedProposalsCount: 2,
        totalRegisteredVoters: 1500,
        auditLog,
        currentTime: 2000,
      });

      expect(report.coinMetrics.maxLifetimeSupplyMicroSov).toBe(100_000_000_000_000n);
      expect(report.coinMetrics.circulatingSupplyMicroSov).toBe(24_000_000_000_000n);
      expect(report.coinMetrics.capInvariantPreserved).toBe(true);
      expect(report.auditChainMetrics.chainIntegrityValid).toBe(true);
      expect(report.governanceMetrics.totalRegisteredVoters).toBe(1500);
    });
  });

  // =========================================================================
  // 10. GENESIS SECURITY COUNCIL 3-OF-5 THRESHOLD & KEY BINDING VERIFICATION
  // =========================================================================
  describe('Genesis Security Council (Track D)', () => {
    it('binds all 5 genesis security council keys with 3-of-5 threshold enforcement', () => {
      const mpaEngine = new MultiPartyApprovalEngine();
      expect(MultiPartyApprovalEngine.REQUIRED_COUNCIL_APPROVALS).toBe(3);
      expect(MultiPartyApprovalEngine.TOTAL_COUNCIL_SEATS).toBe(5);

      // Verify each of the 5 council keys resolves accurately
      const councilDids = [
        'did:sovra:council-1',
        'did:sovra:council-2',
        'did:sovra:council-3',
        'did:sovra:council-4',
        'did:sovra:council-5',
      ];

      for (const did of councilDids) {
        const pubKey = mpaEngine.resolveAuthorizedPublicKey(did, 'EMERGENCY_SECURITY_PAUSE');
        expect(pubKey).toBeDefined();
        expect(pubKey.length).toBe(32);
      }

      // Propose an action requiring Security Council approval
      const proposal = mpaEngine.proposeAction({
        actionType: 'EMERGENCY_SECURITY_PAUSE',
        proposerDid: councilDids[0],
        payload: { reason: 'Scheduled security audit review', code: 'SEC-MAINNET-01' },
        eligibleSigners: councilDids,
        requiredApprovals: 3,
      });

      expect(proposal.requiredApprovals).toBe(3);
      expect(proposal.eligibleSigners.size).toBe(5);
      expect(proposal.status).toBe('PENDING');
    });
  });
});
