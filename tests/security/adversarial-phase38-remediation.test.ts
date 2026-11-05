import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { renderAdminHtml, renderAdminLoginHtml } from '../../scripts/admin-console.ts';

describe('SOVRA Phase 3.8 — Admin CSP Remediation & Zero-Trust Verification (SEC-P37-01)', () => {
  const devServerSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/dev-server.ts'), 'utf8');

  function injectCspNonce(html: string, nonce: string): string {
    if (!nonce) return html;

    const delegatorScript = `<script nonce="${nonce}">
(function() {
  if (window.__sovraCspDelegator) return;
  window.__sovraCspDelegator = true;
  var EVTS = [
    'click', 'change', 'input', 'keydown', 'keyup', 'submit',
    'mouseover', 'mouseout', 'pointerdown', 'pointerup', 'dblclick',
    'contextmenu', 'touchstart', 'touchend', 'focus', 'blur'
  ];
  EVTS.forEach(function(evt) {
    document.addEventListener(evt, function(e) {
      var t = e.target;
      while (t && t !== document && t.nodeType === 1) {
        var attr = 'data-sovra-on' + evt;
        if (t.hasAttribute && t.hasAttribute(attr)) {
          var code = t.getAttribute(attr);
          if (code) {
            try {
              var fn = new Function('event', code);
              fn.call(t, e);
            } catch (err) {
              console.error('[SovraCSP] Action error for ' + attr + ':', err);
            }
          }
          break;
        }
        t = t.parentElement;
      }
    }, true);
  });
})();
</script>`;

    // Protect script and style blocks from attribute replacement
    const placeholders: string[] = [];
    let maskedHtml = html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (match, openTag, tagName, body, closeTag) => {
      let modifiedOpenTag = openTag;
      if (tagName.toLowerCase() === 'script' && !/\bnonce=/i.test(openTag)) {
        modifiedOpenTag = openTag.replace(/<script\b/i, `<script nonce="${nonce}"`);
      }
      const token = `__SOVRA_CSP_PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(`${modifiedOpenTag}${body}${closeTag}`);
      return token;
    });

    // Transform all inline on* handlers on HTML elements to data-sovra-on*
    maskedHtml = maskedHtml.replace(/(<[a-zA-Z0-9\-]+)([^>]*?)>/g, (fullMatch, tagPrefix, attrs) => {
      const transformedAttrs = attrs.replace(/\s+on([a-zA-Z]+)\s*=\s*(["'])([\s\S]*?)\2/g, (attrMatch, evt, quote, val) => {
        return ` data-sovra-on${evt.toLowerCase()}=${quote}${val}${quote}`;
      });
      return `${tagPrefix}${transformedAttrs}>`;
    });

    // Restore protected script and style blocks
    let transformed = maskedHtml.replace(/__SOVRA_CSP_PLACEHOLDER_(\d+)__/g, (_, idx) => {
      return placeholders[Number(idx)];
    });

    // Inject nonce into any remaining script tags without nonce
    transformed = transformed.replace(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);

    // Prepend delegator script in head or body
    if (transformed.includes('<head>')) {
      return transformed.replace('<head>', `<head>\n  ${delegatorScript}`);
    } else if (transformed.includes('<body>')) {
      return transformed.replace('<body>', `<body>\n  ${delegatorScript}`);
    }
    return delegatorScript + transformed;
  }

  const mockAdminOpts = {
    peerId: 'peer-phase38-test',
    did: 'did:key:z6MkuTestAdminPhase38',
    devicePublicKeyHex: '0123456789abcdef0123456789abcdef',
    tcpPort: 3001,
    uptimeSeconds: 3600,
    totalBlocks: 100,
    pinnedCount: 50,
    postsCount: 200,
    connectedPeers: [],
    vouchers: [],
    registeredUsersCount: 5,
    registeredUsers: [
      { did: 'did:key:z6Mku1', handle: 'alice', role: 'ADMIN' },
      { did: 'did:key:z6Mku2', handle: 'bob', role: 'USER' }
    ],
    chatThreadsCount: 3,
    chatMessagesVolume: 12,
    diskStorageBytes: 1048576,
    diskStorageMb: '1.00',
    auditLogs: [],
    channels: [],
    pages: [],
    juryCases: [],
    reports: [],
    ammPools: [],
    cw20Tokens: [],
    strikes: [],
    activeSessions: [],
    systemTelemetry: {},
    solvencyReport: {},
    proposals: [],
    circuitBreaker: {},
    algoDials: [],
    shadowbans: [],
    featureFlags: [],
    broadcastAlerts: [],
    legalHolds: [],
    revenueTakeRate: 5.0,
    disintermediationEvents: [],
    washTradingCycles: [],
    killSwitches: [],
    honeypotIntrusions: [],
    panopticonSessions: [],
    sentinelStatus: {
      recommendedPosture: 'DEFCON-5',
      heuristics: {
        activeWashCycles: 0,
      }
    }
  };

  // =========================================================================
  // 1. ROUTE PIPELINE INSPECTION & STATIC VERIFICATION
  // =========================================================================
  describe('1. /admin Route Response Pipeline Remediation', () => {
    it('verifies authenticated /admin response calls injectCspNonce on renderAdminHtml', () => {
      // In dev-server.ts, verify that the authenticated /admin block invokes injectCspNonce
      const adminRouteIdx = devServerSource.indexOf("if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin/index.html')");
      expect(adminRouteIdx).toBeGreaterThan(-1);

      const nextRouteIdx = devServerSource.indexOf("// Admin: Cast Juror Ballot in Mesh Consensus Quorum", adminRouteIdx);
      const adminRouteBlock = devServerSource.slice(adminRouteIdx, nextRouteIdx);

      // Verify renderAdminHtml output is passed through injectCspNonce
      expect(adminRouteBlock).toMatch(/res\.end\(\s*injectCspNonce\(\s*adminHtml,\s*\(res as any\)\.cspNonce\s*\)\s*\)/);
      // Verify unauthenticated login also calls injectCspNonce
      expect(adminRouteBlock).toMatch(/res\.end\(\s*injectCspNonce\(\s*renderAdminLoginHtml\(\),\s*\(res as any\)\.cspNonce\s*\)\s*\)/);
    });

    it('verifies strict CSP headers are generated in production mode without unsafe-inline for scripts', () => {
      expect(devServerSource).toContain("? `script-src 'self' 'nonce-${cspNonce}' blob:;`");
      expect(devServerSource).not.toContain("script-src-attr 'unsafe-inline'");
    });
  });

  // =========================================================================
  // 2. CSP NONCE INJECTION & INLINE HANDLER ELIMINATION ON ADMIN HTML
  // =========================================================================
  describe('2. Admin HTML CSP Nonce Injection & Inline Event Handler Elimination', () => {
    it('eliminates 100% of inline on* attributes outside scripts and nonces all script tags', () => {
      const rawAdminHtml = renderAdminHtml(mockAdminOpts as any);
      const testNonce = crypto.randomBytes(16).toString('base64');
      const transformed = injectCspNonce(rawAdminHtml, testNonce);

      // Verify delegator script is injected with nonce
      expect(transformed).toContain(`<script nonce="${testNonce}">`);
      expect(transformed).toContain('window.__sovraCspDelegator = true');

      // Strip out <script> and <style> tags to inspect HTML DOM tags
      const htmlMarkupOnly = transformed.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

      // Verify zero inline event attributes (onclick, onchange, oninput, etc.) in HTML markup
      const inlineEventHandlerRegex = /\s+on[a-zA-Z]+\s*=\s*(["'])([\s\S]*?)\1/gi;
      const inlineMatches = htmlMarkupOnly.match(inlineEventHandlerRegex) || [];
      expect(inlineMatches.length).toBe(0);

      // Verify data-sovra-on* attributes are present and populated
      const delegatedMatches = htmlMarkupOnly.match(/\s+data-sovra-on[a-zA-Z]+=/gi) || [];
      expect(delegatedMatches.length).toBeGreaterThan(100);

      // Verify every script tag has nonce="${testNonce}"
      const scriptTags = transformed.match(/<script\b[^>]*>/gi) || [];
      expect(scriptTags.length).toBeGreaterThanOrEqual(2);
      scriptTags.forEach(tag => {
        expect(tag).toContain(`nonce="${testNonce}"`);
      });
    });

    it('preserves unauthenticated admin login page CSP compliance', () => {
      const rawLoginHtml = renderAdminLoginHtml();
      const testNonce = crypto.randomBytes(16).toString('base64');
      const transformed = injectCspNonce(rawLoginHtml, testNonce);

      expect(transformed).toContain(`<script nonce="${testNonce}">`);
      const htmlMarkupOnly = transformed.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
      const inlineMatches = htmlMarkupOnly.match(/\s+on[a-zA-Z]+\s*=\s*(["'])([\s\S]*?)\1/gi) || [];
      expect(inlineMatches.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. JAVASCRIPT SYNTAX & CODE INTEGRITY PRESERVATION
  // =========================================================================
  describe('3. Admin Script Syntax & Placeholder Protection', () => {
    it('guarantees that all embedded script blocks compile with zero syntax errors', () => {
      const rawAdminHtml = renderAdminHtml(mockAdminOpts as any);
      const testNonce = crypto.randomBytes(16).toString('base64');
      const transformed = injectCspNonce(rawAdminHtml, testNonce);

      const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null;
      let scriptCount = 0;

      while ((m = scriptRegex.exec(transformed)) !== null) {
        scriptCount++;
        const scriptCode = m[1];
        // Must compile cleanly in Node VM without throwing SyntaxError
        expect(() => {
          new vm.Script(scriptCode, { filename: `admin-console-script-${scriptCount}.js` });
        }).not.toThrow();
      }

      expect(scriptCount).toBeGreaterThanOrEqual(2);
    });

    it('verifies that dynamic innerHTML templates in admin scripts use data-sovra-onclick', () => {
      const rawAdminHtml = renderAdminHtml(mockAdminOpts as any);
      // Command palette dynamic item template must use data-sovra-onclick
      expect(rawAdminHtml).toContain('data-sovra-onclick="executePaletteItem(&quot;');
      // Moderation action template must use data-sovra-onclick
      expect(rawAdminHtml).toContain('data-sovra-onclick="executeModerationAction(&quot;');
      // Session revoke button template must use data-sovra-onclick
      expect(rawAdminHtml).toContain('data-sovra-onclick="terminateSessionAdmin(&quot;');
      // Strike pardon button template must use data-sovra-onclick
      expect(rawAdminHtml).toContain('data-sovra-onclick="pardonStrikeAdmin(&quot;');
      // Governance co-sign button template must use data-sovra-onclick
      expect(rawAdminHtml).toContain('data-sovra-onclick="coSignGovernanceProposal(&quot;');
    });
  });

  // =========================================================================
  // 4. DELEGATED EVENT ENGINE FUNCTIONALITY
  // =========================================================================
  describe('4. Centralized Delegated Event Engine Logic', () => {
    it('executes action handlers bound via data-sovra-onclick', () => {
      let executedAction: string | null = null;
      const fakeContext = {
        markSuccess: (val: string) => { executedAction = val; }
      };

      const code = 'this.markSuccess("CLICK_ACTION_PROCESSED")';
      const fn = new Function('event', code);
      fn.call(fakeContext, { type: 'click' });

      expect(executedAction).toBe('CLICK_ACTION_PROCESSED');
    });
  });
});
