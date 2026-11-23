import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface SuiteRecord {
  suiteIndex: number;
  testFile: string;
  testFileSha256: string;
  command: string;
  exitCode: number;
  startTime: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  status: 'PASSED' | 'FAILED';
  outputSha256: string;
}

const TEST_SUITES = [
  'tests/integration/phase10-consensus-operations.test.ts',
  'tests/security/adversarial-remediation-gate.test.ts',
  'tests/security/p0-phase5-verification.test.ts',
  'tests/security/phase9-security-isolation.test.ts',
  'tests/security/phase7-governance-e2ee-adversarial.test.ts',
  'tests/reliability/phase11-disaster-recovery-adversarial.test.ts',
  'tests/security/phase10-financial-testnet.test.ts',
  'packages/identity/test/governance.test.ts',
  'tests/reliability/backup-restore-production-drill.test.ts',
  'tests/integration/phase10-api-production.test.ts',
  'tests/security/phase11-hmac-replay-security.test.ts',
  'tests/integration/phase9-api-decoupling-horizontal.test.ts',
  'tests/integration/phase6-multi-node-federation.test.ts',
  'tests/security/phase10-security-monitoring.test.ts',
  'tests/integration/phase7-multi-cloud-federation.test.ts',
  'tests/integration/phase9-multi-cloud-partition.test.ts',
  'tests/security/phase9-financial-concurrency.test.ts',
  'tests/security/phase12-secret-and-auth-hardening.test.ts',
  'tests/security/phase12-cors-validation.test.ts',
  'tests/security/phase12-distributed-security-store.test.ts',
  'tests/security/phase15-2-validator-rotation-recovery.test.ts',
  'tests/security/phase15-3-validator-transition-boundary.test.ts',
  'tests/security/phase15-4-live-consensus-transition.test.ts',
  'tests/security/phase15-5-live-recovery.test.ts',
  'tests/security/phase15-6-adversarial-audit.test.ts',
  'packages/crypto/test/pqc.test.ts',
  'tests/security/phase16-sanitization-quarantine.test.ts',
  'tests/security/seven_vulnerabilities_hardening.test.ts',
  'tests/security/target_a_wallet_voucher_hardening.test.ts',
  'tests/security/target_b_guardian_recovery_hardening.test.ts',
  'tests/security/target_c_media_proxy_ssrf_hardening.test.ts',
];

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function runAllSuites() {
  console.log('='.repeat(80));
  console.log('SOVRA PHASE 16 — ZERO-TRUST CODEBASE SANITIZATION REGRESSION RUNNER');
  console.log(`Executing ${TEST_SUITES.length} test suites sequentially...`);
  console.log('='.repeat(80));

  const suiteRecords: SuiteRecord[] = [];
  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;
  let grandTodo = 0;
  const overallStart = Date.now();

  for (let i = 0; i < TEST_SUITES.length; i++) {
    const testFile = TEST_SUITES[i];
    const fullPath = path.resolve(testFile);
    if (!fs.existsSync(fullPath)) {
      console.error(`[ERROR] Test file not found: ${testFile}`);
      process.exit(1);
    }

    const fileHash = computeSha256(fullPath);
    const jsonOutFile = path.resolve(`.tmp-vitest-report-${i}.json`);
    const cmd = `npx vitest run ${testFile} --reporter=json --outputFile=${jsonOutFile}`;
    console.log(`\n[${i + 1}/${TEST_SUITES.length}] Running: ${testFile}`);
    console.log(`Command: ${cmd}`);

    const startTs = new Date().toISOString();
    const t0 = Date.now();
    let stdout = '';
    let exitCode = 0;

    try {
      stdout = execSync(cmd, {
        cwd: path.resolve('.'),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test', CI: '1', FIAT_WEBHOOK_SECRET: 'phase16_test_fiat_webhook_secret_2026' },
      });
    } catch (err: any) {
      exitCode = err.status || 1;
      stdout = (err.stdout || '') + '\n' + (err.stderr || '');
    }

    const durationMs = Date.now() - t0;
    const outputHash = crypto.createHash('sha256').update(stdout).digest('hex');

    // Parse exact test counts from Vitest JSON report
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let todo = 0;

    if (fs.existsSync(jsonOutFile)) {
      try {
        const rawJson = fs.readFileSync(jsonOutFile, 'utf-8');
        const parsed = JSON.parse(rawJson);
        total = parsed.numTotalTests ?? 0;
        passed = parsed.numPassedTests ?? 0;
        failed = parsed.numFailedTests ?? 0;
        skipped = parsed.numPendingTests ?? 0;
        todo = parsed.numTodoTests ?? 0;
        fs.unlinkSync(jsonOutFile);
      } catch (err) {
        console.warn(`[WARN] Failed to parse JSON report for ${testFile}:`, err);
      }
    }

    // Secondary fallback: parse stdout regex if json report was unavailable
    if (total === 0) {
      const testsMatch = stdout.match(/Tests\s+([\d\w\s|]+)/);
      if (testsMatch) {
        const line = testsMatch[1];
        const pMatch = line.match(/(\d+)\s+passed/);
        const fMatch = line.match(/(\d+)\s+failed/);
        const sMatch = line.match(/(\d+)\s+skipped/);
        const tMatch = line.match(/(\d+)\s+todo/);
        const totMatch = line.match(/\((\d+)\)/);

        if (pMatch) passed = parseInt(pMatch[1], 10);
        if (fMatch) failed = parseInt(fMatch[1], 10);
        if (sMatch) skipped = parseInt(sMatch[1], 10);
        if (tMatch) todo = parseInt(tMatch[1], 10);
        if (totMatch) total = parseInt(totMatch[1], 10);
        else total = passed + failed + skipped + todo;
      } else {
        if (exitCode === 0) {
          passed = 1;
          total = 1;
        } else {
          failed = 1;
          total = 1;
        }
      }
    }

    const status: 'PASSED' | 'FAILED' = exitCode === 0 && failed === 0 ? 'PASSED' : 'FAILED';

    grandTotal += total;
    grandPassed += passed;
    grandFailed += failed;
    grandSkipped += skipped;
    grandTodo += todo;

    console.log(`Outcome: ${status} | Total: ${total}, Passed: ${passed}, Failed: ${failed} (${durationMs}ms)`);

    suiteRecords.push({
      suiteIndex: i + 1,
      testFile,
      testFileSha256: fileHash,
      command: cmd,
      exitCode,
      startTime: startTs,
      durationMs,
      total,
      passed,
      failed,
      skipped,
      todo,
      status,
      outputSha256: outputHash,
    });

    if (status === 'FAILED') {
      console.error(`\n[FATAL] Suite failed: ${testFile}`);
      console.error(stdout.slice(-1500));
      process.exit(1);
    }
  }

  const overallDurationMs = Date.now() - overallStart;

  console.log('\n' + '='.repeat(80));
  console.log('PHASE 16 REGRESSION RUN SUMMARY:');
  console.log(`Total Suites:     ${TEST_SUITES.length}`);
  console.log(`Total Tests:      ${grandTotal}`);
  console.log(`Passed Tests:     ${grandPassed}`);
  console.log(`Failed Tests:     ${grandFailed}`);
  console.log(`Skipped Tests:    ${grandSkipped}`);
  console.log(`Pass Rate:        ${((grandPassed / grandTotal) * 100).toFixed(2)}%`);
  console.log(`Overall Duration: ${(overallDurationMs / 1000).toFixed(2)}s`);
  console.log('='.repeat(80));

  const evidencePayload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      generator: 'scripts/phase16-reproducible-regression-runner.ts',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      phase: '16',
      totalSuites: TEST_SUITES.length,
      totalTests: grandTotal,
      passedTests: grandPassed,
      failedTests: grandFailed,
      skippedTests: grandSkipped,
      passRatePercent: Number(((grandPassed / grandTotal) * 100).toFixed(2)),
      overallDurationMs,
      allPassed: grandFailed === 0,
    },
    suites: suiteRecords,
  };

  const evidencePath = path.resolve('phase16-regression-reproducibility-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidencePayload, null, 2), 'utf-8');
  console.log(`Evidence written to: ${evidencePath}`);
}

runAllSuites().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
