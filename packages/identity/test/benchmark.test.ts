import { describe, it, expect } from 'vitest';
import {
  DecentralizedIdentityService,
  SovraIdentityKey,
  SovraDeviceKey,
  createDeviceDelegation,
  verifyDeviceSignedAction,
  canonicalizeJson,
} from '../src/index.js';

describe('Decentralized Identity Cryptographic Benchmarks', () => {
  it('measures identity creation throughput', async () => {
    const service = new DecentralizedIdentityService();
    const iterations = 50;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await service.createIdentity();
    }

    const elapsedMs = performance.now() - start;
    const opsPerSec = Math.round((iterations / elapsedMs) * 1000);

    // console.info(`Identity creation benchmark: ${opsPerSec} ops/sec (${elapsedMs.toFixed(1)}ms for ${iterations} ops)`);
    expect(opsPerSec).toBeGreaterThan(10); // Minimum acceptable performance threshold
  });

  it('measures signature generation and verification throughput', () => {
    const identityKey = SovraIdentityKey.generate();
    const payload = new TextEncoder().encode('Benchmark test message for digital signature');
    const iterations = 100;

    // 1. Signature Generation Benchmark
    const startSign = performance.now();
    const signatures: string[] = [];
    for (let i = 0; i < iterations; i++) {
      signatures.push(identityKey.signHex(payload));
    }
    const elapsedSignMs = performance.now() - startSign;
    const signOpsPerSec = Math.round((iterations / elapsedSignMs) * 1000);

    // 2. Signature Verification Benchmark
    const now = Math.floor(Date.now() / 1000);
    const deviceKey = SovraDeviceKey.generate(
      'dev-bench',
      'BenchDevice',
      identityKey.did,
      now + 3600,
    );
    const delegation = createDeviceDelegation(identityKey, deviceKey, now + 3600);
    const devSig = deviceKey.signHex(payload);

    const startVerify = performance.now();
    for (let i = 0; i < iterations; i++) {
      verifyDeviceSignedAction(identityKey.did, delegation, payload, devSig, () => false, now);
    }
    const elapsedVerifyMs = performance.now() - startVerify;
    const verifyOpsPerSec = Math.round((iterations / elapsedVerifyMs) * 1000);

    expect(signOpsPerSec).toBeGreaterThan(50);
    expect(verifyOpsPerSec).toBeGreaterThan(50);
  });

  it('measures canonical JSON serialization throughput', () => {
    const sampleEvent = {
      version: 1,
      targetDid: 'did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw',
      deviceId: 'dev-pixel-9',
      deviceName: 'Mobile Phone',
      authorizedAt: 1780000000,
      validUntil: 1811536000,
      nested: { tags: ['tech', 'sovra', 'identity'], priority: 1 },
    };

    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      canonicalizeJson(sampleEvent);
    }
    const elapsedMs = performance.now() - start;
    const opsPerSec = Math.round((iterations / elapsedMs) * 1000);

    expect(opsPerSec).toBeGreaterThan(500);
  });
});
