# SOVRA — NEXT PHASE ACCEPTANCE CRITERIA
## Phase 2.0: Core Constitutional & Cryptographic Integrity Remediation

**Document ID:** SOVRA-AC-PHASE2.0  
**Task ID:** TSK-P2.0-INTEGRITY-REMEDIATION  
**Target Phase:** Phase 2.0 (Recommended Next Development Phase)  
**Priority:** P0 — CRITICAL ARCHITECTURAL & CONSTITUTIONAL INTEGRITY  
**Repository Working Directory:** `d:\Sovra`  
**Baseline Git Commit:** `63065389167c1968163d0fde929d46443bf3fcaa`  
**Status:** READY FOR STAKEHOLDER REVIEW & EXPLICIT AUTHORIZATION  

---

## 1. Phase Objective & Problem Statement

Phase 2.0 remediates the three critical (P0) architectural vulnerabilities exposed during the Master Vision vs Actual Development Audit (`SOVRA-VISION-AUDIT-001`):

1. **VULN-01 (Chat Gateway Fake-E2EE):** The `/api/chat/send` endpoint currently accepts raw plaintext and encrypts it server-side using a deterministically derived key. This exposes plaintext in server memory and creates an unacceptable eavesdropping risk.
2. **VULN-02 (Dual-Ledger Synthetic Currency Creation):** The `/api/wallet/faucet/claim` endpoint and `depositFunds` method credit arbitrary floating-point SOV balances in SQLite with random 32-byte hex hashes, violating Constitutional Invariant 1 (100M Lifetime Cap).
3. **VULN-03 (Legacy Centralized God Dial & Panopticon):** The admin console retains interactive controls for "The God Dial" (silent shadowbanning & viral category de-amplification) and "The God Eye (Panopticon)" with unilateral kill switches, violating Constitutional Invariants 2 and 6.

This phase hardens SOVRA's foundations, aligning real code with the Ten Inviolable Constitutional Invariants before Layer-1 blockchain bridging begins.

---

## 2. In-Scope Requirements & Exact Gaps to Close

| Requirement ID | Vision Invariant | Code Location to Remediate | Exact Remediation Required |
| :--- | :--- | :--- | :--- |
| **VIS-08-01** / **VIS-17-01** | Constitutional Invariant 4: True End-to-End Encryption | `scripts/routes/chat.routes.ts:390-405` | Remove server-side encryption fallback. Reject any message without client-generated Double Ratchet `ciphertextHex`, `ivHex`, and `tagHex`. Ensure server never sees or stores plaintext. |
| **VIS-13-01** / **VIS-13-03** | Constitutional Invariant 1: 100M Fixed Monetary Cap | `scripts/routes/wallet.routes.ts:411-460`<br>`scripts/database-engine.ts:7840-7860` | Deprecate unbacked SQLite faucet minting. Replace float `balance_sov` with integer `balance_usov` ($1\text{ SOV} = 10^6\;\mu\text{SOV}$). Unify ledger transactions with cryptographic signatures. |
| **VIS-06-03** / **VIS-10-03** | Constitutional Invariant 2 & 6: Zero Founder Backdoors & Multi-Sig | `scripts/admin-console.ts:2949-2980`<br>`scripts/admin-console.ts:3578-3610` | Completely purge "The God Dial" (silent shadowbanning) and "The God Eye (Panopticon)" kill switches from the admin console DOM and backend handlers. |

---

## 3. Explicit Acceptance Criteria (AC)

### AC-1: Zero Plaintext Chat Gateway Enforcement
- **AC-1.1:** Any `POST /api/chat/send` request where `ciphertextHex` is missing, empty, or invalid MUST be immediately rejected with **HTTP 400 Bad Request** (`{ ok: false, error: 'E2EE_CIPHERTEXT_REQUIRED: Plaintext messages are rejected by protocol invariant' }`).
- **AC-1.2:** The server MUST NOT contain any code that derives encryption keys from sender/recipient DIDs (`SOVRA_MSG_SEAL`) or calls `crypto.createCipheriv` for chat message payloads.
- **AC-1.3:** Stored message records in SQLite `direct_messages` table MUST persist only encrypted ciphertext (`ciphertext_hex`), initialization vectors (`iv_hex`), authentication tags (`tag_hex`), and ephemeral ratchet public keys. Plaintext text MUST strictly be set to an immutable sentinel string: `'[End-to-End Encrypted Message]'`.
- **AC-1.4:** The client-side Double Ratchet implementation in `packages/messaging/src/chat-engine.ts` MUST be the sole engine responsible for key derivation, message encryption, and message decryption.

### AC-2: Monetary Cap & Integer Precision Hardening
- **AC-2.1:** Float `balance_sov` in SQLite `users` table MUST be deprecated in favor of integer `balance_usov` (`INTEGER NOT NULL DEFAULT 0`). Zero JavaScript `number` floating-point division or rounding is permitted in financial state transitions.
- **AC-2.2:** The `/api/wallet/faucet/claim` endpoint MUST NOT generate arbitrary unbacked tokens in SQLite. It MUST either:
  1. Forward signed faucet requests to a strictly bounded testnet faucet pool with daily maximum allowances (e.g. max 50 SOV per DID per 24 hours from a pre-funded 1,000,000 SOV genesis allocation), OR
  2. Be disabled entirely in non-test environments with a hard 403 Forbidden.
- **AC-2.3:** Random 32-byte hex generation for `sourceTx` (`'0x' + crypto.randomBytes(32).toString('hex')`) in `database-engine.ts:depositFunds` MUST be eliminated. Every financial balance mutation MUST record a verifiable cryptographic transfer voucher signed by an authorized sender or multi-sig treasury pool.

### AC-3: Total Purge of Centralized God Dial & Panopticon
- **AC-3.1:** Module 13 ("The God Dial: Algorithmic Virality & Visibility Filtering") MUST be completely removed from `scripts/admin-console.ts`. The admin sidebar navigation item, card views, category multipliers sliders, and silent shadowban dials MUST be deleted.
- **AC-3.2:** Module 18 ("The God Eye: Omnipresent Panopticon & Nuclear Matrix") MUST be completely removed from `scripts/admin-console.ts`. All unilateral nuclear kill switches MUST be purged.
- **AC-3.3:** Any administrative state mutation requiring emergency pause MUST strictly route through the existing multi-party authorization module (`packages/identity/src/governance/multisig.ts`) requiring 3-of-5 threshold cryptographic signatures and timelocks.

### AC-4: Non-Regression of Existing Hardened Subsystems
- **AC-4.1:** All 35 tests in `tests/security/phase1_1_adversarial_remediation.test.ts` MUST continue to pass with 100% success rate.
- **AC-4.2:** All 22 tests in `tests/security/admin_user_creator_moderation.test.ts` MUST execute and pass cleanly against the updated dev-server without timeouts.
- **AC-4.3:** The Merkle hash-chained audit logging engine MUST continue to record all administrative and moderation events with valid parent hash linkages.

---

## 4. Required Automated Verification Test Scenarios

The remediation must deliver a dedicated adversarial test suite (`tests/security/phase2_0_integrity_remediation.test.ts`) covering:

| Scenario ID | Test Name | Attack / Evaluation Vector | Expected Result |
| :--- | :--- | :--- | :--- |
| **TEST-P2.0-01** | `rejects_raw_plaintext_chat` | Attacker sends `POST /api/chat/send` with `{ text: 'Hello secret' }` and no ciphertext | HTTP 400; message rejected; zero records in SQLite |
| **TEST-P2.0-02** | `accepts_valid_client_double_ratchet` | Legitimate client submits valid ChaCha20-Poly1305 ciphertext, IV, and tag | HTTP 200; stored record contains only ciphertext; text is sentinel string |
| **TEST-P2.0-03** | `server_memory_zero_plaintext_leakage` | Forensic memory inspection during chat message ingestion | Server heap contains zero unencrypted message payload bytes |
| **TEST-P2.0-04** | `faucet_unbacked_mint_prevention` | Attacker calls `/api/wallet/faucet/claim` with arbitrary amount (1,000,000 SOV) | HTTP 400/429; balance unmutated; zero unbacked tokens created |
| **TEST-P2.0-05** | `integer_usov_precision_invariance` | Execute 1,000 fractional micro-payments (1 uSOV each) | Sum of balances equals exact integer total; zero floating-point drift |
| **TEST-P2.0-06** | `admin_console_god_dial_dom_absence` | HTTP GET `/admin` and scan response DOM for `view-god-dial` or `virality-multiplier` | Zero occurrences; elements completely eliminated from response |
| **TEST-P2.0-07** | `admin_console_panopticon_dom_absence` | HTTP GET `/admin` and scan response DOM for `view-panopticon-god-mode` or `nuclear-kill` | Zero occurrences; elements completely eliminated from response |
| **TEST-P2.0-08** | `unilateral_emergency_action_rejected` | Single admin attempts to trigger emergency network pause without 3-of-5 multisig | HTTP 403 Forbidden; audit log records unauthorized attempt |

---

## 5. Security & Invariant Checklist

- [ ] **Constitutional Invariant 1 Verified:** Fixed supply cap of 100M SOV enforced down to 1 uSOV integer precision.
- [ ] **Constitutional Invariant 2 Verified:** Zero god-mode dials, master backdoors, or founder bypasses in production codebase.
- [ ] **Constitutional Invariant 4 Verified:** True client-to-client Double Ratchet encryption; zero plaintext exposure on server.
- [ ] **Constitutional Invariant 6 Verified:** Multi-party authorization (3-of-5) required for all high-impact operational mutations.
- [ ] **Constitutional Invariant 8 Verified:** Tamper-evident Merkle hash chain remains continuous and unbroken.

---

## 6. Definition of Done (DoD)

Phase 2.0 is considered complete **ONLY** when:
1. All 3 critical P0 vulnerabilities (`VULN-01`, `VULN-02`, `VULN-03`) are remediated in source code.
2. The dedicated test suite `tests/security/phase2_0_integrity_remediation.test.ts` passes with 100% success rate (8/8 scenarios).
3. The existing regression suite `tests/security/phase1_1_adversarial_remediation.test.ts` passes with 100% success rate (35/35 scenarios).
4. An independent zero-trust verification report (`docs/PHASE2_0_INDEPENDENT_VERIFICATION_REPORT.md`) is compiled with exact line numbers, commands, and exit codes.
5. `git diff` confirms that zero new features were added outside the strict remediation scope.

---

## 7. Next Step Authorization Gate

**STOP.** Phase 2.0 implementation is defined, specified, and gated. No source modifications or test implementations will proceed until the stakeholder explicitly reviews these acceptance criteria and issues authorization.
