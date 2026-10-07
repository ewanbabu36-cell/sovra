import { describe, it, test, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

describe('Automated Browser-Script Syntax Verification Gate', () => {
  const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

  test('Browser HTML (Product A - Consumer App) contains zero client-side syntax errors', async () => {
    let html = '';
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) {
        html = await res.text();
      }
    } catch {
      // If server is not running on localhost, read dev-server.ts source to extract template
      const devServerFile = path.resolve(__dirname, '../../scripts/dev-server.ts');
      html = fs.readFileSync(devServerFile, 'utf8');
    }

    expect(html).toBeTruthy();
    const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);

    for (const [_, code] of scripts) {
      expect(() => new vm.Script(code)).not.toThrow();
    }
  });

  test('Browser HTML (Product B - Ops & Admin Console) contains zero client-side syntax errors', async () => {
    let html = '';
    try {
      const res = await fetch(`${BASE_URL}/admin`);
      if (res.ok) {
        html = await res.text();
      }
    } catch {
      const adminFile = path.resolve(__dirname, '../../scripts/admin-console.ts');
      html = fs.readFileSync(adminFile, 'utf8');
    }

    expect(html).toBeTruthy();
    const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);

    for (const [_, code] of scripts) {
      expect(() => new vm.Script(code)).not.toThrow();
    }
  });

  test('Compiled Client Bundle (/assets/bundle.js - Solution C) is served and contains zero syntax errors', async () => {
    let bundleCode = '';
    try {
      const res = await fetch(`${BASE_URL}/assets/bundle.js`);
      if (res.ok) {
        expect(res.headers.get('content-type')).toContain('javascript');
        bundleCode = await res.text();
      }
    } catch {
      const bundlePath = path.resolve(__dirname, '../../apps/sovra-app/dist/bundle.js');
      if (fs.existsSync(bundlePath)) {
        bundleCode = fs.readFileSync(bundlePath, 'utf8');
      }
    }

    expect(bundleCode.length).toBeGreaterThan(1000);
    expect(() => new vm.Script(bundleCode)).not.toThrow();
  });
});
