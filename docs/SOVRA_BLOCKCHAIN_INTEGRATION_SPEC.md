# SOVRA — BLOCKCHAIN & TOKEN ECONOMY INTEGRATION SPECIFICATION

> **Standard:** Zero-Trust, Decentralized Layer-1 Specification  
> **Status:** Phase 0 Architecture Deliverable  
> **Repository Baseline:** Commit `6306538` | Go 1.27.0 Engine | Wazero CosmWasm  

---

## 1. Executive Summary & Protocol Overview

The SOVRA blockchain is an independent, sovereign Layer-1 protocol engineered in Go (`chain/`), providing deterministic consensus, sovereign digital identity anchors, decentralized storage incentivization, and economic settlement for the SOVRA ecosystem.

Unlike traditional EVM-dependent networks, SOVRA utilizes a native CometBFT consensus engine paired with CockroachDB's Pebble LSM key-value store and a zero-dependency WebAssembly runtime powered by Wazero. This architecture enables microsecond block processing, deterministic state transitions, and client-side verifiable Proof-of-Usage (PoU) without reliance on external gas-heavy networks.

---

## 2. Core Chain Architecture

```mermaid
graph TD
    Client["Client Wallet (packages/crypto)"] -->|Signed Tx (Ed25519/secp256k1)| Gateway["Tendermint RPC Gateway (:26657)"]
    Gateway --> Mempool["Mempool Engine (chain/mempool)"]
    Mempool --> Consensus["CometBFT Consensus Engine"]
    Consensus --> ABCI["ABCI++ Engine (chain/node)"]
    ABCI --> AuthKeeper["Auth Keeper (chain/x/auth)"]
    ABCI --> IssuanceKeeper["Issuance & PoU Keeper (chain/x/issuance)"]
    ABCI --> WasmKeeper["CosmWasm Engine (chain/x/wasm)"]
    AuthKeeper --> PebbleStore["Pebble DB State Storage (chain/store)"]
    IssuanceKeeper --> PebbleStore
    WasmKeeper --> PebbleStore
```

### 2.1 File & Module Map
- **Consensus & ABCI Bridge:** [`chain/node/`](file:///d:/Sovra/chain/node)
- **State Storage Layer (Pebble DB):** [`chain/store/store.go`](file:///d:/Sovra/chain/store/store.go)
- **Token Issuance & PoU Engine:** [`chain/x/issuance/keeper/keeper.go`](file:///d:/Sovra/chain/x/issuance/keeper/keeper.go)
- **Token Parameters & Emission Formulas:** [`chain/x/issuance/types/emission.go`](file:///d:/Sovra/chain/x/issuance/types/emission.go), [`chain/x/issuance/types/constants.go`](file:///d:/Sovra/chain/x/issuance/types/constants.go)
- **Smart Contract Engine (Wazero):** [`chain/x/wasm/keeper/keeper.go`](file:///d:/Sovra/chain/x/wasm/keeper/keeper.go)
- **Account & Cryptographic Verification:** [`chain/x/auth/`](file:///d:/Sovra/chain/x/auth)

---

## 3. Token Economics & 100M Hard Cap Mathematical Proof

### 3.1 Constants Specification ([`chain/x/issuance/types/constants.go`](file:///d:/Sovra/chain/x/issuance/types/constants.go))
The base accounting unit of SOVRA is micro-SOV ($1 \text{ SOV} = 10^6 \mu\text{SOV}$).
- `MicroSOVPerSOV`: `1_000_000`
- `MaxSupplySOV`: `100_000_000` ($10^8$ SOV)
- `MaxSupplyMicroSOV`: `100_000_000_000_000` ($10^{14} \mu\text{SOV}$)
- `InitialCirculatingSOV`: `15_000_000` ($1.5 \times 10^7$ SOV)
- `InitialCirculatingMicroSOV`: `15_000_000_000_000` ($1.5 \times 10^{13} \mu\text{SOV}$)
- `TotalIssuancePoolSOV`: `85_000_000` ($8.5 \times 10^7$ SOV)
- `TotalIssuancePoolMicroSOV`: `85_000_000_000_000` ($8.5 \times 10^{13} \mu\text{SOV}$)

### 3.2 Emission Recurrence Formula ([`chain/x/issuance/types/emission.go`](file:///d:/Sovra/chain/x/issuance/types/emission.go))
The issuance module executes a half-life block-by-block decay on integer values:
$$\Delta S(h) = \left\lfloor \frac{R(h)}{K} \right\rfloor$$
Where:
- $h$ is the current block height.
- $R(h)$ is the remaining unminted pool balance in micro-SOV.
- $K$ is the decay constant corresponding to the halving period in blocks.
- $R(h+1) = R(h) - \Delta S(h)$.

### 3.3 Formal Proof of Strict Supply Boundedness
1. **Base Case:** At genesis ($h=0$), total minted supply $S(0) = S_{\text{init}} = 15 \times 10^{12} \mu\text{SOV}$. Remaining pool $R(0) = 85 \times 10^{12} \mu\text{SOV}$. Total potential supply $S(0) + R(0) = 100 \times 10^{12} \mu\text{SOV} \equiv 100,000,000 \text{ SOV}$.
2. **Induction Step:** For any block $h \ge 0$, $\Delta S(h) = \lfloor R(h) / K \rfloor$. Since $K > 1$, $\Delta S(h) \le R(h)$, which implies $R(h+1) \ge 0$.
3. **Conservation Invariant:** $S(h+1) + R(h+1) = (S(h) + \Delta S(h)) + (R(h) - \Delta S(h)) = S(h) + R(h) = 100 \times 10^{12} \mu\text{SOV}$.
4. **Termination:** Because integer floor truncation yields $\lfloor R / K \rfloor = 0$ when $R < K$, emissions cleanly cease when the pool reaches zero or negligible residue.
5. **Conclusion:** Total minted supply $S(h) \le 100,000,000 \text{ SOV}$ for all $h \in [0, \infty)$. Minting beyond $10^{14} \mu\text{SOV}$ is mathematically and programmatically impossible.

---

## 4. Proof-of-Usage (PoU) Keeper Architecture

The Proof-of-Usage engine rewards active network participants (storage node operators, relay routers, content creators, and end-users) without PoW energy waste or PoS oligarchic centralization.

### 4.1 Telemetry Ingestion & Score Weighting
PoU claims are submitted to the ABCI engine via `MsgClaimPoU`:
- **Storage Availability Proofs (Weight: 40%):** Validated against BitSwap and UnixFS Merkle block challenges.
- **Relay & Routing Work (Weight: 30%):** Validated against signed hop telemetry vouchers.
- **Creator Engagement & Social Utility (Weight: 20%):** Validated against decentralized interaction attestations.
- **Ecosystem Good-Actor Standing (Weight: 10%):** Validated via WebAuthn/Passkey identity verification.

### 4.2 Sybil Defense & ZK Verification
- Individual device DIDs must attach a zero-knowledge membership proof (Groth16 on BN254) proving uniqueness within the registered DID commitment tree without revealing the underlying physical identity.
- Rate-limiting prevents more than 1 PoU settlement per identity per epoch (7,200 blocks $\approx 24$ hours).

---

## 5. CosmWasm Smart Contract Engine

SOVRA embeds the CosmWasm contract model implemented via the pure Go Wazero WebAssembly runtime ([`chain/x/wasm/keeper/keeper.go`](file:///d:/Sovra/chain/x/wasm/keeper/keeper.go)).
- **Zero CGO Dependencies:** Entirely portable binary execution across Linux, Darwin, and Windows.
- **Deterministic Sandboxing:** Gas metering is enforced on every WASM opcode; infinite loops and excessive memory allocation trigger immediate `ErrOutOfGas`.
- **Supported Contracts:** Decentralized DAO escrow governance, sponsored brand campaign escrows, NFT digital copyright licensing, and cross-chain relay bridges.

---

## 6. Client Signing & RPC Bridge

### 6.1 Current Baseline vs Phase 5 Target
- **Current Baseline:** Custodial gateway in [`scripts/dev-server.ts`](file:///d:/Sovra/scripts/dev-server.ts#L89410) signs transactions using the validator private key (`chain/mytestnet/node0/validator-0.key.json`).
- **Target Architecture (Phase 5):** Client-side signing in [`packages/crypto/src/wallet.ts`](file:///d:/Sovra/packages/crypto/src/wallet.ts):
  1. The user device constructs `TxRaw` containing `SignDoc`.
  2. The mobile Secure Enclave or hardware Passkey signs the SHA-256 digest with Ed25519 or secp256k1.
  3. The client submits the serialized transaction directly to CometBFT RPC endpoint `POST /broadcast_tx_sync`.
  4. The gateway never receives, processes, or holds private keys.

---

## 7. Verification & Test Evidence

The Go blockchain test suite was executed against the active repository:
```bash
go test -v ./x/issuance/types ./x/issuance/keeper ./store ./p2p ./node ./x/auth ./x/wasm
```
**Results:**
- `x/issuance/types`: PASS (All emission and halving bounds verified)
- `x/issuance/keeper`: PASS (PoU pool distribution and anti-inflation guards verified)
- `store`: PASS (Pebble DB atomic batching, iterator prefix scanning verified)
- `p2p`: PASS (Node discovery and CometBFT block sync verified)
- `node`: PASS (ABCI++ begin/end block hooks verified)
- `x/auth`: PASS (Signature verification and nonce increment verified)
- `x/wasm`: PASS (Wazero WASM instantiate, execute, and query verified)
- **Exit Code:** `0` (100% Passing)
