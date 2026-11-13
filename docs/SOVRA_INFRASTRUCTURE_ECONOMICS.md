# SOVRA — SELF-SUSTAINING INFRASTRUCTURE ECONOMICS & TREASURY SPECIFICATION

> **Standard:** Non-Inflationary Sovereign Tokenomics & Infrastructure Sustainability  
> **Status:** Phase 0 Architecture Deliverable  
> **Repository Commit:** `6306538` | **Date:** 2026-11-05  

---

## 1. Economic Philosophy & Hard Constraints

SOVRA rejects inflationary ponzinomics, predatory venture lock-in, and surveillance ad models. To sustain physical hardware, bandwidth, and community operations indefinitely, SOVRA enforces **seven non-negotiable economic axioms**:
1. **Strict 100 Million Hard Cap:** Total lifetime supply is mathematically capped at $100,000,000 \text{ SOV}$ ($100\text{M SOV} \equiv 10^{14} \mu\text{SOV}$).
2. **20-Year Emission Horizon:** The remaining $85\text{M SOV}$ issuance pool decays deterministically over a 20-year halving curve via Layer-1 consensus.
3. **No Secondary Tokens:** There is only one native token: SOVRA Coin (SOV). No speculative governance tokens, meme coins, or secondary wrappers are permitted.
4. **Advertising Does Not Mint Tokens:** Commercial advertising deposits consume existing circulating coins; it never mints new supply.
5. **Permanent Deflationary Burns:** All burned tokens are irrevocably transferred to the genesis burn address (`sovra100000000000000000000000000000000000000`).
6. **No Unrestricted Treasury Minting:** The network treasury cannot create tokens out of thin air. It operates strictly within approved allocations.
7. **No Guaranteed Yields or Financial Returns:** Compensation is strictly work-for-service (storage byte-hours, packet routing, block proposal).

---

## 2. Infrastructure Revenue Streams

```mermaid
graph TD
    Brand["Advertiser / Brand"] -->|Deposit Campaign Budget (SOV)| Escrow["Smart Contract Campaign Escrow"]
    Escrow -->|95% Direct Credit| Creator["Content Creator Wallet"]
    Escrow -->|5% Protocol Fee| Splitter["Protocol Fee Splitter"]
    
    Splitter -->|2.5% Permanent Burn| BurnAddress[("Permanent Zero Address Burn")]
    Splitter -->|2.5% Operations Credit| Treasury[("Infrastructure Operations Treasury")]

    Merchant["Business / Merchant"] -->|Verified Profile Fee (SOV)| Treasury
    ProCreator["Pro Studio User"] -->|High-Bitrate Transcode Fee (SOV)| Treasury

    Treasury -->|Compensate Seeders| StorageNodes["BitSwap Storage Seeders"]
    Treasury -->|Compensate Relays| RelayNodes["P2P Circuit Relays"]
    Treasury -->|Sponsor Domain Renewals| InfraOps["Multi-Provider DNS & Bare-Metal VPS"]
```

### 2.1 The 95/5 Sponsored Ad Model
As verified in [`tests/e2e/sponsored-campaign-escrows.test.ts`](file:///d:/Sovra/tests/e2e/sponsored-campaign-escrows.test.ts):
- **95% to Publishers / Creators:** Flows directly to content creators based on client-attested blind view vouchers.
- **5% Network Fee:**
  - $2.5\%$ is permanently burned on Layer-1, reducing total circulating supply.
  - $2.5\%$ is deposited into the on-chain Infrastructure Treasury to fund hardware hosting grants and domain renewals.

### 2.2 Optional Premium & Enterprise Business Services
- **Verified Business Profiles & Catalogues:** Merchants pay a monthly or annual micro-fee in SOV for verified cryptographic badges and decentralized store discovery.
- **Priority Cloud Transcoding Ladder:** High-resolution 4K/60fps transcoding queues charge a compute fee settled directly with transcoder edge nodes.
- **Custom Vanity Domain Aliasing:** Linking sovereign DIDs to decentralized or traditional domain names.

---

## 3. The Transparent Infrastructure Treasury

The Infrastructure Treasury is an on-chain CosmWasm smart contract governed by multi-party cryptographic authorization.

### 3.1 Permitted Expenditure Categories
1. **Public Seed Node & Relay Grants:** Offsetting monthly hosting costs (\$3.50 – \$12/mo) for verified independent operators.
2. **Domain Registration & DNS Redundancy:** Covering registrar renewal fees across `sovra.network`, `sovra.io`, and `sovra.app`.
3. **Core Security Audits & Bug Bounties:** Compensating independent security researchers for responsible vulnerability disclosure.
4. **Disaster Recovery Replication Storage:** Funding multi-cloud S3/R2 object storage pools for continuous Litestream WAL streaming.

### 3.2 Governance & Multisig Controls
- **Threshold Policy:** Requires 3-of-5 cryptographic signatures from elected community node delegates.
- **Rate-Limiting Quota:** Maximum treasury disbursement per calendar month is hard-capped at $\le 0.5\%$ of total treasury balance.
- **Public Auditability:** Every expense, invoice hash, and recipient DID is recorded on the Layer-1 blockchain ledger with full public accounting.

---

## 4. Operator Compensation Model (Proof-of-Usage)

Node operators are rewarded on a predictable, meritocratic basis:

| Operator Role | Compensating Source | Settlement Metric | Target Monthly Payout Profile |
|:---|:---|:---|:---|
| **Storage Seeder** | Layer-1 PoU Issuance | Byte-hours pinned + Proof-of-Retrievability challenges | Proportional to storage quota provided ($100\text{ GB} – 10\text{ TB}$). |
| **Circuit Relay** | Layer-1 PoU Issuance | Signed hop telemetry vouchers | Proportional to forwarded bytes and NAT circuits bridged. |
| **Validator** | CometBFT Block Emission | Proposed & signed block pre-commits | Fixed block reward decaying along 20-year half-life curve. |
| **Transcoder Node** | User Compute Fees | Completed video segment work proofs | Direct pay-per-segment micropayment in micro-SOV. |
