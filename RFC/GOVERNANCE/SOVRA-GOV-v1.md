# RFC SOVRA-GOV v1.0
## Open Community Governance & Fork Rights (`SOVRA-GOV`)

**Protocol Identifier:** `SOVRA-GOV`  
**Namespace:** `/sovra/gov/1.0.0`  
**Version:** `1.0`

---

## 1. Proposal Categories

| Category | Scope |
|---|---|
| `SOVRA-P` | Core & data protocol changes |
| `SOVRA-S` | Security & cryptographic advisories/mitigations |
| `SOVRA-A` | Application, social, commerce & app capability standards |
| `SOVRA-G` | Governance process & decision rule amendments |
| `SOVRA-O` | Operational guidelines & node operator best practices |

---

## 2. Proposal Lifecycle

`DRAFT -> DISCUSSION -> REVIEW -> ACCEPTED / REJECTED -> IMPLEMENTATION -> RELEASE`

Every accepted protocol upgrade MUST provide: (1) specification artifact/CID, (2) backward-compatibility assessment, (3) technical/security review, (4) independent reference implementation & interoperability test results, (5) migration notes, and (6) public release signatures.

---

## 3. Safeguards & Fork Rights

- **Zero Compulsory Token Voting:** Valid ballots verify participant Ed25519 identity/operator keys (`governance.vote`) with 1-identity-1-vote or declared non-plutocratic review quorums — no token purchase or coin stake is required.
- **No Permanent Founder Veto:** No founder key can reject, halt, or unilaterally push an upgrade.
- **Unrestricted Fork Rights:** Any community subset may publish a `ForkDeclaration` referencing a canonical lineage ancestor (`parent_protocol_version`, `fork_network_id`) and continue independently.

Reference implementation: [packages/identity/src/governance/community-governance.ts](file:///d:/Sovra/packages/identity/src/governance/community-governance.ts).
