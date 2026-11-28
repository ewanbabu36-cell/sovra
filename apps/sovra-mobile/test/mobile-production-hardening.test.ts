import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Stage 5 — Mobile Production Bundle, Zero-Domain Defaults & Android Release Hardening', () => {
  const rootDir = process.cwd();

  it('mounts real React BottomTabNavigator root in apps/sovra-mobile/src/main.tsx without empty shell stub', () => {
    const mainSrc = fs.readFileSync(path.join(rootDir, 'apps/sovra-mobile/src/main.tsx'), 'utf8');
    expect(mainSrc).toContain("from 'react-dom/client'");
    expect(mainSrc).toContain("from './navigation/BottomTabNavigator.js'");
    expect(mainSrc).toContain('createRoot');
    expect(mainSrc).toContain('multiRelayManager.setZeroDomainOnly');
  });

  it('compiles a full non-stub mobile bundle (dist/bundle.js) containing navigation screens', () => {
    const bundlePath = path.join(rootDir, 'apps/sovra-mobile/dist/bundle.js');
    expect(fs.existsSync(bundlePath)).toBe(true);
    const stat = fs.statSync(bundlePath);
    // Reject the previous 1,031-byte placeholder shell
    expect(stat.size).toBeGreaterThan(50 * 1024);

    const bundleSrc = fs.readFileSync(bundlePath, 'utf8');
    expect(bundleSrc).toContain('mobileIncomingCallOverlay');
    expect(bundleSrc).toContain('sovra-mobile-shell');
  });

  it('enforces release keystore env vars, R8 minification, and lint failure checks in Android build.gradle', () => {
    const gradlePath = path.join(rootDir, 'apps/sovra-mobile/android/app/build.gradle');
    const gradleSrc = fs.readFileSync(gradlePath, 'utf8');

    expect(gradleSrc).not.toContain('sovraSecure2026!');
    expect(gradleSrc).not.toContain('"sovra-release-key.jks"');
    expect(gradleSrc).toContain('SOVRA_RELEASE_KEYSTORE_FILE');
    expect(gradleSrc).toContain('minifyEnabled = true');
    expect(gradleSrc).toContain('proguard-rules.pro');
    expect(gradleSrc).toContain('abortOnError = true');
    expect(gradleSrc).toContain('checkReleaseBuilds = true');
    expect(fs.existsSync(path.join(rootDir, 'apps/sovra-mobile/android/app/proguard-rules.pro'))).toBe(true);
  });
});
