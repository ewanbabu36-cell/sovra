import { describe, it, expect } from 'vitest';
import http from 'node:http';
import vm from 'node:vm';

describe('Client Script Integrity & UI Freeze Prevention Gate', () => {
  it('serves valid HTML with zero syntax errors in all embedded script blocks', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    expect(html).toBeTruthy();
    expect(html.length).toBeGreaterThan(1000);

    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let scriptCount = 0;
    const errors: string[] = [];

    while ((match = scriptRegex.exec(html)) !== null) {
      scriptCount++;
      const code = match[1];
      if (!code.trim()) continue;

      try {
        new vm.Script(code, { filename: `served_script_${scriptCount}.js` });
      } catch (err: any) {
        errors.push(`Script #${scriptCount} has SyntaxError: ${err.message}`);
      }
    }

    expect(scriptCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 30000);

  it('guarantees all modal overlays default to hidden to prevent backdrop clicks blocking the screen', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Check critical modal overlays
    const requiredModals = [
      'safetyReportModal',
      'juryBallotModal',
      'postOptionsModal',
      'repostModal',
      'omniSearchModal',
      'safetyCenterModal'
    ];

    for (const modalId of requiredModals) {
      const regex = new RegExp(`id="${modalId}"[^>]*style="[^"]*display:\\s*none`, 'i');
      expect(regex.test(html)).toBe(true);
    }
  }, 30000);

  it('guarantees admin controls are isolated and hidden from consumer view by default', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:3001', (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 1. Ops Console tab on left rail nav must be hidden by default
    expect(html).toMatch(/id="tab-admin"[^>]*style="[^"]*display:\s*none/i);

    // 2. Operator Section in Drawer must be hidden by default
    expect(html).toMatch(/id="drawerAdminSection"[^>]*style="[^"]*display:\s*none/i);

    // 3. Consumer Profile header items exist
    expect(html).toContain('id="drawerProfileName"');
    expect(html).toContain('id="drawerProfileHandle"');

    // 4. Privacy & Safety Center modal trigger exists for normal citizens
    expect(html).toContain('openSafetyCenterModal()');
    expect(html).toContain('Privacy &amp; Safety Center');

    // 5. Operator Diagnostic Hub buttons & cards must be hidden by default
    expect(html).toMatch(/id="hubBtnP2pDiagnostics"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="hubBtnMeshTelemetry"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="nodeDiagnosticsCard"[^>]*style="[^"]*display:\s*none/i);
    expect(html).toMatch(/id="meshTelemetryCard"[^>]*style="[^"]*display:\s*none/i);

    // 6. Consumer Hub buttons exist
    expect(html).toContain('id="hubBtnIdentity"');
    expect(html).toContain('id="hubBtnCreator"');
    expect(html).toContain('id="hubBtnSafety"');
    expect(html).toContain('id="hubBtnDisplay"');

    // 7. Right Rail footer Ops link is hidden by default
    expect(html).toMatch(/id="rightRailOpsLink"[^>]*style="[^"]*display:\s*none/i);
  }, 30000);
});
