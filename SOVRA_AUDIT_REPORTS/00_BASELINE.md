# SOVRA Source-Code Health, Functionality & Release Readiness Audit
## Deliverable 00: Initial Repository & Environment Baseline

**Audit Date:** 2026-10-09  
**Execution Environment:** Local Windows Workstation (`d:\Sovra`)  
**Operating Principle:** INSPECT FIRST. VERIFY SECOND. REPORT THE TRUTH. DO NOT MODIFY THE PRODUCT.

---

### 1. Repository Identification & Version Control

| Dimension | Measured Value |
| :--- | :--- |
| **Repository Root** | `D:\Sovra` |
| **Active Git Branch** | `main` |
| **Current HEAD Commit** | `77eb009cbd34a52b42f384ae0ac01da0fb27c67b` |
| **HEAD Commit Message** | `fix(webrtc): add dual HTTPS server and mobile secure context guidance for LAN calls` |
| **Monorepo Architecture** | pnpm workspace (`pnpm-workspace.yaml`) with 22 member projects |
| **Package Manager** | `pnpm` v12.8.1 (via local `.\pnpm.cmd`), `npm` v11.17.0 |
| **Lockfile Present** | `pnpm-lock.yaml` (present, tracked) |

---

### 2. Runtime & Toolchain Baseline

| Component | Detected Version | Path / State | Verification Command |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.20.0` | `C:\Program Files\nodejs\node.exe` | `node -v` |
| **npm** | `11.17.0` | Node bundled | `npm -v` |
| **pnpm** | `12.8.1` | Local workspace shim `.\pnpm.cmd` | `.\pnpm.cmd -v` |
| **Java / JDK** | OpenJDK 17.0.20.1 | Eclipse Adoptium Temurin-17.0.20.1+1 | `java -version` |
| **Android SDK** | API Level 34 | `C:\Users\alamr\AppData\Local\Android\Sdk` | `local.properties` |
| **Android Build Tools** | 34.0.0 | In SDK `build-tools` | Verified in SDK |
| **Android Gradle Wrapper** | Gradle 8.3 | `apps/sovra-mobile/android/gradlew.bat` | `.\gradlew.bat --version` |
| **ADB Executable** | Android Debug Bridge 1.0.41 | `C:\Users\alamr\AppData\Local\Android\Sdk\platform-tools\adb.exe` | Verified executable |
| **Connected ADB Devices** | 0 devices attached | `adb devices -l` returns empty device list | Physical devices: 0 |

---

### 3. Git Status & Working Tree Manifest

Prior to audit start, the working tree contained pre-existing uncommitted modifications and untracked artifacts from previous development sessions:

#### Modified Tracked Files (12 files)
```text
 M apps/sovra-app/src/ui/index.ts
 M apps/sovra-mobile/App.tsx
 M apps/sovra-mobile/android/app/build.gradle
 M apps/sovra-mobile/android/app/src/main/AndroidManifest.xml
 M apps/sovra-mobile/ios/SovraMobile/SovraBleBridge.mm
 M apps/sovra-mobile/ios/SovraMobile/SovraBleNativeModule.mm
 M apps/sovra-mobile/test/dynamic-data-layer.test.ts
 M docker/docker-compose.production.yml
 M scripts/admin-console.ts
 M scripts/database-engine.ts
 M scripts/database-sqlite.ts
 M scripts/dev-server.ts
```

#### Pre-existing Untracked Artifacts (Selective Summary)
- Historical audit markdown files (`SOVRA_*.md`, `docs/*.md`)
- Test storage drills (`.test-drill-01-*`, `.test-drill-02-*`, `.test-final-restore-*`)
- Development runtime state (`.sovra-storage-dev/`, `.sovra-backups/`, `.sovra-tls/`)
- Mobile build artifacts (`apps/sovra-mobile/android/.gradle/`, `apps/sovra-mobile/android/app/build/`)

**Preservation Mandate:** Under the strict read-only contract, no existing files are discarded, reset, or overwritten. All audit reports are written solely to `SOVRA_AUDIT_REPORTS/`.

---

### 4. Workspace Structure & Package Scripts

The monorepo contains 22 workspace projects defined in `pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'nodes/*'
  - 'services/*'
```

#### Root Scripts (`package.json`)
- `pnpm run build` -> `pnpm -r run build`
- `pnpm run build:client` -> `node --experimental-strip-types scripts/build-client-bundle.ts`
- `pnpm run dev` -> `node --experimental-strip-types scripts/dev-server.ts`
- `pnpm run test` -> `vitest run`
- `pnpm run test:watch` -> `vitest`
- `pnpm run test:architecture` -> `vitest run tests/security/dependency-boundaries.test.ts`
- `pnpm run lint` -> `eslint .`
- `pnpm run typecheck` -> `pnpm -r run typecheck`
- `pnpm run format` -> `prettier --write ...`

---

### 5. Execution Environment Constraints & Safety Boundaries

1. **Host OS:** Windows 11 (x64). Shell: PowerShell.
2. **Local Ports:** Port 3001 (HTTP), 3443 (HTTPS), 4001 (P2P TCP) actively bound by background test server instance.
3. **Physical Hardware Limitations:** No physical Android devices, iOS iPhones, or Bluetooth/BLE hardware test benches are attached to the host (`adb devices` = 0).
4. **Cloud/Staging Boundaries:** No live Kubernetes cluster, public TURN server, or external DNS zone is authorized for modifications during this local audit.
5. **Safety Gate:** Database files (`.sovra-storage-dev/sovra-social.sqlite`) are protected from destructive reset. All inspections are non-destructive.
