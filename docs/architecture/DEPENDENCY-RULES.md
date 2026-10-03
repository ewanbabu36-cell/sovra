# SOVRA Monorepo Dependency Rules & Isolation Matrix

## 1. Core Architectural Invariants

To eliminate centralization traps and architectural rot, the monorepo enforces **strict unidirectional dependency flow**.

```
                        +----------------------+
                        |   apps/sovra-app     |  <---+
                        +----------------------+      |
                                   |                  |
                                   v                  |
+-------------------+   +----------------------+      |
| apps/sovra-admin  |   |    nodes/*           |      |
+-------------------+   +----------------------+      |
          |                        |                  |
          v                        v                  |
   +---------------------------------------+          |
   |           Domain Packages             |          |
   | (social, messaging, moderation, etc.) |          |
   +---------------------------------------+          |
          |                        |                  |
          v                        v                  |
+-------------------+   +----------------------+      |
| packages/protocol |   |    packages/p2p      |      |
+-------------------+   +----------------------+      |
          |                        |                  |
          v                        v                  |
+-------------------+   +----------------------+      |
| packages/identity |   |   packages/storage   |      |
+-------------------+   +----------------------+      |
          |                        |                  |
          v                        v                  |
+----------------------------------------------+      |
|               packages/crypto                |      |
+----------------------------------------------+      |
          |                                           |
          v                                           |
+----------------------------------------------+      |
|               packages/shared                | <----+
+----------------------------------------------+      |
          ^                                           |
          |                                           |
+----------------------------------------------+      |
|                 packages/ui                  | -----+
+----------------------------------------------+
```

---

## 2. Forbidden Dependency Invariants

The following dependency edges are **strictly prohibited** and enforced via automated test gates:

1. **`* -> apps/sovra-admin` (CRITICAL)**  
   No package, node, service, or end-user application may import or depend on `@sovra/admin`.  
   _Security Rationale:_ Prevents the Company Admin Panel from ever becoming a runtime dependency of the decentralized network.

2. **`packages/* -> apps/*` (CRITICAL)**  
   Packages must never depend on applications. Applications consume packages, never the reverse.

3. **`packages/protocol -> apps/sovra-admin` (CRITICAL)**  
   The protocol layer must remain completely agnostic of company operational systems.

4. **`packages/crypto -> packages/ui` (CRITICAL)**  
   Cryptographic packages must remain pure logic without presentation layer dependencies.

5. **`packages/ui -> packages/crypto` & `packages/ui -> packages/protocol`**  
   The UI presentation package must only export design tokens and dumb components. Application code integrates UI components with protocol data models.

6. **Circular Package Dependencies**  
   Circular relationships across `packages/*` are strictly forbidden.

---

## 3. Automated Dependency Gate Verification

Compliance is verified on every build and CI pipeline execution by:
`tests/security/dependency-boundaries.test.ts`

This test suite inspects every `package.json` in `packages/`, `nodes/`, and `services/`, asserting that:

- `@sovra/admin` is absent from all dependencies and devDependencies across backend packages.
- `@sovra/app` is absent from all domain packages.
- `@sovra/crypto` only depends on `@sovra/shared`.
- `@sovra/ui` does not import `@sovra/crypto`, `@sovra/protocol`, or `@sovra/p2p`.
