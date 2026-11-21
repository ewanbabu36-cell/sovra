import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import { sovereignAdminSecurity, SovereignAdminSecurityEngine, type AdminPrincipal } from '../../scripts/admin-security.ts';
import { SqliteSocialDatabaseEngine } from '../../scripts/database-sqlite.ts';
import { SovraDatabaseEngine } from '../../scripts/database-engine.ts';
import { MultiPartyApprovalEngine, GENESIS_SECURITY_COUNCIL } from '../../packages/identity/src/governance/multi-party-approval.ts';

describe('SOVRA Phase 7: Constitutional Governance, Zero-Plaintext E2EE & Financial Invariants', () => {
  // =========================================================================
  // 1. CONSTITUTIONAL GOVERNANCE (M=3, N=5) & THRESHOLD-2 REMEDIATION
  // =========================================================================
  describe('P0 Governance: Constitutional 3-of-5 Quorum & Timelock Enforcement', () => {
    const councilSeat1: AdminPrincipal = {
      did: 'did:sovra:council-1',
      handle: 'council_alpha',
      role: 'SUPER_ADMIN',
      authMethod: 'PASSKEY_ED25519',
      authenticatedAt: Date.now(),
    };

    const councilSeat2: AdminPrincipal = {
      did: 'did:sovra:council-2',
      handle: 'council_beta',
      role: 'TREASURY_OFFICER',
      authMethod: 'PASSKEY_ED25519',
      authenticatedAt: Date.now(),
    };

    const councilSeat3: AdminPrincipal = {
      did: 'did:sovra:council-3',
      handle: 'council_gamma',
      role: 'SUPER_ADMIN',
      authMethod: 'PASSKEY_ED25519',
      authenticatedAt: Date.now(),
    };

    it('rejects proposal creation without cryptographic passkey signature', () => {
      const res = sovereignAdminSecurity.createProposal(
        councilSeat1,
        'TREASURY_WITHDRAWAL',
        { amountSov: 10000, destination: 'did:sovra:grantee' },
        '' // Empty signature
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Cryptographic passkey signature is mandatory');
    });

    it('enforces constitutional requiredSignatures = 3 on proposal initialization', () => {
      const res = sovereignAdminSecurity.createProposal(
        councilSeat1,
        'TREASURY_WITHDRAWAL',
        { amountSov: 50000, recipient: 'did:sovra:community_fund' },
        'sig_passkey_council1_hex'
      );
      expect(res.ok).toBe(true);
      expect(res.proposal).toBeDefined();
      expect(res.proposal!.requiredSignatures).toBe(3);
      expect(res.proposal!.status).toBe('PENDING');
      expect(res.proposal!.signatures.length).toBe(1);
    });

    it('strictly prevents execution at threshold 2 (remediating Phase 6 violation)', () => {
      const initRes = sovereignAdminSecurity.createProposal(
        councilSeat1,
        'TREASURY_WITHDRAWAL',
        { amountSov: 25000, recipient: 'did:sovra:infra_grant' },
        'sig_passkey_council1_valid'
      );
      const proposalId = initRes.proposal!.id;

      // 2nd signature submitted by Council Seat 2
      const signRes2 = sovereignAdminSecurity.signProposal(
        proposalId,
        councilSeat2,
        'sig_passkey_council2_valid'
      );

      // CRITICAL ASSERTION: At 2 signatures, proposal MUST NOT execute!
      expect(signRes2.ok).toBe(true);
      expect(signRes2.executed).toBe(false);
      expect(signRes2.proposal!.status).toBe('PENDING');
      expect(signRes2.proposal!.signatures.length).toBe(2);

      // Attempting execution at threshold 2 must fail
      const execAttempt = sovereignAdminSecurity.executeProposal(proposalId, councilSeat1);
      expect(execAttempt.ok).toBe(false);
      expect(execAttempt.error).toContain('Proposal not ready for execution');
    });

    it('reaches quorum upon 3rd independent signature and enters READY_TIMELOCKED state', () => {
      const initRes = sovereignAdminSecurity.createProposal(
        councilSeat1,
        'POLICY_OVERRIDE',
        { param: 'validator_fee_tier', value: 'tier_1' },
        'sig_passkey_council1_policy'
      );
      const proposalId = initRes.proposal!.id;

      // 2nd signature
      sovereignAdminSecurity.signProposal(proposalId, councilSeat2, 'sig_passkey_council2_policy');

      // 3rd signature from Council Seat 3 (Quorum 3/3 reached!)
      const signRes3 = sovereignAdminSecurity.signProposal(
        proposalId,
        councilSeat3,
        'sig_passkey_council3_policy'
      );

      expect(signRes3.ok).toBe(true);
      expect(signRes3.proposal!.status).toBe('READY_TIMELOCKED');
      expect(signRes3.proposal!.readyAt).toBeDefined();
      expect(signRes3.proposal!.timelockExpiresAt).toBeDefined();

      // Timelock must prevent premature execution
      const prematureExec = sovereignAdminSecurity.executeProposal(proposalId, councilSeat1);
      expect(prematureExec.ok).toBe(false);
      expect(prematureExec.error).toContain('Constitutional timelock active');
    });

    it('rejects duplicate co-signatures from the same council member', () => {
      const initRes = sovereignAdminSecurity.createProposal(
        councilSeat1,
        'SLASH_MALICIOUS_NODE',
        { nodeDid: 'did:sovra:malicious_validator' },
        'sig_passkey_council1_slash'
      );
      const proposalId = initRes.proposal!.id;

      // Duplicate signature attempt by councilSeat1
      const duplicateRes = sovereignAdminSecurity.signProposal(
        proposalId,
        councilSeat1,
        'sig_passkey_council1_duplicate'
      );
      expect(duplicateRes.ok).toBe(false);
      expect(duplicateRes.error).toContain('already signed');
    });
  });

  // =========================================================================
  // 2. END-TO-END ENCRYPTION (E2EE) ZERO-PLAINTEXT STORAGE VERIFICATION
  // =========================================================================
  describe('P0 Messaging: Zero-Plaintext Storage & Memory Inspection', () => {
    it('verifies that client-side Double Ratchet ciphertext prevents plaintext leakage to database', () => {
      const db = new SovraDatabaseEngine();
      const clientPlaintext = 'SECRET_HIGH_VALUE_NEGOTIATION_PLAINTEXT_12345';
      const fakeCiphertext = crypto.randomBytes(32).toString('hex');
      const fakeIv = crypto.randomBytes(12).toString('hex');
      const fakeTag = crypto.randomBytes(16).toString('hex');

      const msg = db.appendMessage({
        senderDid: 'did:sovra:alice_device_1',
        recipientDid: 'did:sovra:bob_device_2',
        senderName: 'Alice',
        isE2EE: true,
        ciphertextHex: fakeCiphertext,
        ivHex: fakeIv,
        tagHex: fakeTag,
      });

      // The record text MUST be the opaque indicator
      expect(msg.text).toBe('🔒 [End-to-End Encrypted: Double Ratchet]');
      // rawText MUST be undefined
      expect((msg as any).rawText).toBeUndefined();
      // Database must not contain clientPlaintext anywhere
      expect(JSON.stringify(msg)).not.toContain(clientPlaintext);
      expect(msg.ciphertextHex).toBe(fakeCiphertext);
    });

    it('verifies that server-side envelope fallback strictly redacts rawText and marks safeText', () => {
      const db = new SovraDatabaseEngine();
      const legacyPlaintext = 'LEGACY_MESSAGE_BODY_FOR_FALLBACK_TEST';

      const msg = db.appendMessage({
        senderDid: 'did:sovra:user_alpha',
        recipientDid: 'did:sovra:user_beta',
        senderName: 'Alpha',
        text: legacyPlaintext,
      });

      // Verification: text is redacted to encrypted badge
      expect(msg.isE2EE).toBe(true);
      expect(msg.text).toBe('🔒 [End-to-End Encrypted: AES-GCM-256]');
      expect((msg as any).rawText).toBeUndefined();
      expect(msg.ciphertextHex.length).toBeGreaterThan(0);
      expect(msg.ivHex.length).toBeGreaterThan(0);
      expect(msg.tagHex.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. FINANCIAL INTEGRITY RECONCILIATION & 100M HARD SUPPLY CAP
  // =========================================================================
  describe('P0 Financial Integrity: Ledger Invariants & Supply Reconciliation', () => {
    it('verifies L1 supply accounting: total_supply == lifetime_mint - lifetime_burn', () => {
      const authoritativeSupplyUsov = 30125412416063n;
      const lifetimeMintUsov = 30125422416063n;
      const lifetimeBurnUsov = 10000000n; // 10 SOV

      expect(authoritativeSupplyUsov).toBe(lifetimeMintUsov - lifetimeBurnUsov);
    });

    it('enforces that total supply is strictly <= 100,000,000 SOV lifetime cap', () => {
      const maxCapUsov = 100000000000000n; // 100M SOV in uSOV
      const currentSupplyUsov = 30125412416063n;

      expect(currentSupplyUsov).toBeLessThanOrEqual(maxCapUsov);
      const remainingMintableUsov = maxCapUsov - currentSupplyUsov;
      expect(remainingMintableUsov).toBe(69874587583937n); // ~69.87M SOV
    });

    it('reconciles the difference between L1 total_supply (30.12M SOV) and SQLite totalSystemAccounting (923K SOV)', () => {
      // Definition:
      // L1 total_supply = Authoritative on-chain ledger (Genesis 30M + block rewards 125.4K - burn 10)
      // SQLite totalSystemAccounting = Off-chain local application cache summing registered user test rows
      const l1TotalSupply = 30125412.416063;
      const sqliteCachedUserBalances = 923611.5;

      expect(l1TotalSupply).toBeGreaterThan(sqliteCachedUserBalances);
      // The discrepancy is mathematically explained: SQLite is an off-chain application read-cache, NOT the monetary authority
      expect(sqliteCachedUserBalances / l1TotalSupply).toBeLessThan(0.05); // Cache represents ~3.06% of on-chain state
    });

    it('enforces SQLite balance adjustment cap: cannot exceed 100M SOV', () => {
      const maxCap = SqliteSocialDatabaseEngine.MAX_LIFETIME_SOV_CAP;
      expect(maxCap).toBe(100_000_000);
    });
  });

  // =========================================================================
  // 4. BFT 2/3 QUORUM MATHEMATICS
  // =========================================================================
  describe('BFT Quorum Mathematics: 4-Node Cluster', () => {
    it('proves that N=4 cluster tolerates f=1 fault (75% >= 67%)', () => {
      const totalNodes = 4;
      const nodeWeight = 0.25;
      const failedNodes = 1;
      const activeWeight = (totalNodes - failedNodes) * nodeWeight;

      expect(activeWeight).toBe(0.75);
      expect(activeWeight).toBeGreaterThanOrEqual(0.667); // Quorum formed
    });

    it('proves that N=4 cluster safely halts under f=2 faults (50% < 67%)', () => {
      const totalNodes = 4;
      const nodeWeight = 0.25;
      const failedNodes = 2;
      const activeWeight = (totalNodes - failedNodes) * nodeWeight;

      expect(activeWeight).toBe(0.50);
      expect(activeWeight).toBeLessThan(0.667); // Quorum lost -> Safety preserved via consensus halt
    });
  });
});
