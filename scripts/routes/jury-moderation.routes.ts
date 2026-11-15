/**
 * @file scripts/routes/jury-moderation.routes.ts
 * Sovereign Community Jury & Decentralized Moderation Engine Route Controller.
 *
 * Implements:
 * - Evidence-Based Community Jury Reports & Consolidation
 * - Jury Case Ballots & Transparency Audits
 * - Content Policy Declarations
 * - Author Defense Submission & Appeals Quorum
 * - Parametric Case Lifecycles (/api/moderation/cases/:id/...)
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface JuryModerationRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, bodyObj?: Record<string, any>) => AuthenticatedPrincipal | null;
}

export async function handleJuryModerationRoutes(ctx: JuryModerationRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, resolvePrincipal, enforceAuth } = ctx;

  const pathname = url.pathname;
  if (!pathname.startsWith('/api/moderation') && !pathname.startsWith('/api/jury')) {
    return false;
  }

    // ⚖️ EVIDENCE-BASED COMMUNITY JURY & 24-HOUR AUTOMATIC MODERATION ENGINE
    // "Equal Justice System: Universal Rights For Every Human Being"
    // =========================================================================

    // 1. Submit or Consolidate Jury Report
    if ((url.pathname === '/api/moderation/reports' || url.pathname === '/api/moderation/jury/report' || url.pathname === '/api/jury/report') && req.method === 'POST') {
      const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
      if (!bodyOk) return true;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const principal = enforceAuth(req, res, parsed);
        if (!principal) return;

        const targetType = (parsed.targetType === 'profile' || parsed.targetType === 'user') ? 'profile' : 'post';
        const targetId = String(parsed.targetId || parsed.postId || parsed.userDid || '').trim();
        if (!targetId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'targetId (or postId) is required' }));
          return true;
        }

        // Map reason/category
        let categoryInput = String(parsed.violationCategory || parsed.reason || 'HATE_SPEECH_DEHUMANIZATION').toUpperCase();
        if (categoryInput === 'HATE_SPEECH') categoryInput = 'HATE_SPEECH_DEHUMANIZATION';
        else if (categoryInput === 'ILLEGAL') categoryInput = 'IMMINENT_VIOLENCE_INCITEMENT';
        else if (categoryInput === 'TERRORISM') categoryInput = 'TERRORISM_EXTREMISM';
        else if (categoryInput === 'MISINFORMATION') categoryInput = 'MISINFORMATION_DECEPTION';
        else if (categoryInput === 'HARASSMENT') categoryInput = 'HARASSMENT_STALKING';
        else if (categoryInput === 'CSAM') categoryInput = 'CHILD_EXPLOITATION_CSAM';
        else if (categoryInput === 'NCII') categoryInput = 'NCII_SEXUAL_EXPLOITATION';
        else if (categoryInput === 'DOXXING') categoryInput = 'DOXXING_PRIVATE_INFO';

        const violationSubcategory = parsed.violationSubcategory ? String(parsed.violationSubcategory) : undefined;
        const evidenceText = String(parsed.evidenceText || parsed.details || '').trim();
        const evidenceUrls = Array.isArray(parsed.evidenceUrls) ? parsed.evidenceUrls.map(String) : [];
        const reporterPrivacy = parsed.reporterPrivacy || 'ANONYMOUS_TO_PUBLIC';

        const result = sovraDb.createOrConsolidateJuryReport({
          targetType: targetType as any,
          targetId,
          violationCategory: categoryInput as any,
          violationSubcategory,
          evidenceText,
          evidenceUrls,
          reporterDid: principal.did,
          reporterPrivacy,
        });

        if (!result.ok) {
          const statusCode = result.error?.includes('not found') ? 404 : (result.error?.includes('Duplicate') ? 429 : 400);
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return true;
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          case: result.case,
          caseId: result.case?.id,
          ballot: result.case,
          consolidated: result.consolidated,
          emergency: result.emergency,
          message: result.consolidated ? 'Report consolidated with existing case' : 'New jury case created'
        }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON body' }));
      }
      return true;
    }

    // 2. Query Jury Cases / Ballots
    if ((url.pathname === '/api/moderation/cases' || url.pathname === '/api/moderation/jury/cases' || url.pathname === '/api/jury/ballots') && req.method === 'GET') {
      const principal = resolvePrincipal(req);
      const status = url.searchParams.get('status') as any;
      const targetType = url.searchParams.get('targetType') as any;
      const authorDid = url.searchParams.get('authorDid') || undefined;
      const violationCategory = url.searchParams.get('violationCategory') as any;
      const jurorEligibleOnly = url.searchParams.get('jurorEligibleOnly') === 'true';

      const cases = sovraDb.getJuryCases({
        status: status || undefined,
        targetType: targetType || undefined,
        authorDid,
        violationCategory: violationCategory || undefined,
        jurorEligibleOnly,
        forJurorDid: jurorEligibleOnly && principal ? principal.did : undefined,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cases, ballots: cases }));
      return true;
    }

    // 3. Transparency Metrics
    if ((url.pathname === '/api/moderation/transparency' || url.pathname === '/api/moderation/jury/transparency') && req.method === 'GET') {
      const metrics = sovraDb.getTransparencyMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, metrics }));
      return true;
    }

    // 4. Policy Configuration Settings
    if (url.pathname === '/api/moderation/policies') {
      if (req.method === 'GET') {
        const policies = sovraDb.getModerationPolicyConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, policies }));
        return true;
      }
      if (req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const principal = enforceAuth(req, res, parsed);
          if (!principal) return;

          if (!['SUPER_ADMIN', 'SECURITY_ADMIN'].includes(principal.role)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Forbidden: Admin authorization required to update policies' }));
            return true;
          }

          const updated = sovraDb.updateModerationPolicyConfig(parsed.policies || parsed, principal.did);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, policies: updated }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Policy update failed' }));
        }
        return true;
      }
    }

    // 5. Legacy Endpoints with Body-level Ballot ID (/api/jury/defense, /api/jury/vote, /api/jury/resolve)
    if (url.pathname === '/api/jury/defense' && req.method === 'POST') {
      const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
      if (!bodyOk) return true;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const principal = enforceAuth(req, res, parsed);
        if (!principal) return;

        const caseId = String(parsed.ballotId || parsed.caseId || '');
        const defenseNote = String(parsed.defenseNote || parsed.defense || '').trim();
        const result = sovraDb.submitAuthorDefense(caseId, principal.did, defenseNote);
        if (!result.ok) {
          const statusCode = result.error?.includes('author') ? 403 : (result.error?.includes('not found') ? 404 : 400);
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
      return true;
    }

    if (url.pathname === '/api/jury/vote' && req.method === 'POST') {
      const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
      if (!bodyOk) return true;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const principal = enforceAuth(req, res, parsed);
        if (!principal) return;

        const caseId = String(parsed.ballotId || parsed.caseId || '');
        let choice = String(parsed.vote || parsed.choice || '').trim().toUpperCase();
        if (choice === 'SAFE_DEFENSE' || choice === 'SAFE' || choice === 'NOT_PROVEN') choice = 'VIOLATION_NOT_PROVEN';
        else if (['HATE_SPEECH', 'ILLEGAL', 'TERRORISM', 'MISINFORMATION', 'PROVEN'].includes(choice)) choice = 'VIOLATION_PROVEN';
        else if (choice === 'INSUFFICIENT' || choice === 'NEED_MORE_INFO') choice = 'INSUFFICIENT_EVIDENCE';

        const result = sovraDb.castJuryVote(caseId, principal.did, choice as any, parsed.rationale);
        if (!result.ok) {
          const statusCode = result.error?.includes('Conflict of interest') ? 403 : (result.error?.includes('already voted') ? 409 : (result.error?.includes('not found') ? 404 : 400));
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
      return true;
    }

    if (url.pathname === '/api/jury/resolve' && req.method === 'POST') {
      const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
      if (!bodyOk) return true;
      try {
        const parsed = body ? JSON.parse(body) : {};
        const caseId = String(parsed.ballotId || parsed.caseId || '');
        const result = sovraDb.finalizeJuryCase(caseId, true);
        if (!result.ok) {
          const statusCode = result.error?.includes('not found') ? 404 : 400;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
      return true;
    }

    // 6. Parametric Case Endpoints (/api/moderation/cases/:id/...)
    const juryParamMatch = url.pathname.match(/^\/api\/(?:moderation\/)?(?:jury\/)?cases\/([^/]+)(?:\/(defense|vote|finalize|appeal(?:\/resolve)?))?$/);
    if (juryParamMatch) {
      const caseId = decodeURIComponent(juryParamMatch[1]);
      const subAction = juryParamMatch[2];

      // GET case details
      if (!subAction && req.method === 'GET') {
        const principal = resolvePrincipal(req);
        const juryCase = sovraDb.getJuryCaseById(caseId, principal?.did);
        if (!juryCase) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Case not found' }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, case: juryCase, ballot: juryCase }));
        return true;
      }

      // POST author defense
      if (subAction === 'defense' && req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const principal = enforceAuth(req, res, parsed);
          if (!principal) return;

          const defenseNote = String(parsed.defenseNote || parsed.defense || '').trim();
          if (!defenseNote) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'defenseNote is required' }));
            return true;
          }

          const result = sovraDb.submitAuthorDefense(caseId, principal.did, defenseNote);
          if (!result.ok) {
            const statusCode = result.error?.includes('author') ? 403 : (result.error?.includes('not found') ? 404 : 400);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return true;
      }

      // POST cast jury vote
      if (subAction === 'vote' && req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const principal = enforceAuth(req, res, parsed);
          if (!principal) return;

          let choice = String(parsed.choice || parsed.vote || '').trim().toUpperCase();
          if (choice === 'SAFE_DEFENSE' || choice === 'SAFE' || choice === 'NOT_PROVEN') choice = 'VIOLATION_NOT_PROVEN';
          else if (['HATE_SPEECH', 'ILLEGAL', 'TERRORISM', 'MISINFORMATION', 'PROVEN'].includes(choice)) choice = 'VIOLATION_PROVEN';
          else if (choice === 'INSUFFICIENT' || choice === 'NEED_MORE_INFO') choice = 'INSUFFICIENT_EVIDENCE';

          const result = sovraDb.castJuryVote(caseId, principal.did, choice as any, parsed.rationale);
          if (!result.ok) {
            const statusCode = result.error?.includes('Conflict of interest') ? 403 : (result.error?.includes('already voted') ? 409 : (result.error?.includes('not found') ? 404 : 400));
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return true;
      }

      // POST finalize case
      if (subAction === 'finalize' && req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const force = Boolean(parsed.force);
          const result = sovraDb.finalizeJuryCase(caseId, force);
          if (!result.ok) {
            const statusCode = result.error?.includes('not found') ? 404 : 400;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, case: result.case, ballot: result.case }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return true;
      }

      // POST appeal
      if (subAction === 'appeal' && req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const principal = enforceAuth(req, res, parsed);
          if (!principal) return;

          const appealReason = String(parsed.appealReason || parsed.reason || '').trim();
          if (!appealReason) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'appealReason is required' }));
            return true;
          }

          const result = sovraDb.submitJuryAppeal(caseId, principal.did, appealReason);
          if (!result.ok) {
            const statusCode = result.error?.includes('Only the author') ? 403 : (result.error?.includes('not found') ? 404 : 400);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return true;
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, appeal: result.appeal, case: result.case }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return true;
      }

      // POST resolve appeal
      if (subAction === 'appeal/resolve' && req.method === 'POST') {
        const { body, ok: bodyOk } = await readBoundedBody(req, res, 64 * 1024);
        if (!bodyOk) return true;
        try {
          const parsed = body ? JSON.parse(body) : {};
          const principal = enforceAuth(req, res, parsed);
          if (!principal) return;

          if (!['SUPER_ADMIN', 'SECURITY_ADMIN', 'MODERATOR'].includes(principal.role)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Forbidden: Independent moderator role required to resolve appeals' }));
            return true;
          }

          const appealId = String(parsed.appealId || '');
          const decision = String(parsed.decision || 'DENIED').toUpperCase() as 'GRANTED' | 'DENIED';
          const resolutionNote = String(parsed.resolutionNote || '');

          const result = sovraDb.resolveJuryAppeal(caseId, appealId, principal.did, decision, resolutionNote);
          if (!result.ok) {
            const statusCode = result.error?.includes('Original juror') ? 403 : (result.error?.includes('not found') ? 404 : 400);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, appeal: result.appeal, case: result.case }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message }));
        }
        return true;
      }
    }


  return false;
}
