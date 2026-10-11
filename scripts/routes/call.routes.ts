/**
 * @file scripts/routes/call.routes.ts
 * WebRTC E2EE Call Signaling & ICE Relay Route Controller.
 *
 * Implements type-safe call offers, answers, candidate exchanges,
 * polling, blind push wakeups, ICE restarts, and call telemetry metrics.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import type { BlindPushRelayServer } from '../../packages/messaging/dist/index.js';

export interface CallRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  blindPushRelay: BlindPushRelayServer;
  getIceServers: (userDid?: string) => any[];
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
}

export async function handleCallSignalingRoutes(ctx: CallRouteContext): Promise<boolean> {
  const { req, res, url, blindPushRelay, getIceServers, readBoundedBody, resolvePrincipal, enforceAuth } = ctx;

  // 1. ICE Servers configuration with Privacy Relay Mode (IP Leakage Shielding)
  if ((url.pathname === '/api/call/ice-servers' || url.pathname === '/api/webrtc/ice-servers') && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const privacyParam = url.searchParams.get('privacy') || req.headers['x-sovra-privacy-mode'];
    const privacyRelay = privacyParam === 'relay' || privacyParam === 'shielded';
    let iceServers = getIceServers(principal?.did);

    if (privacyRelay) {
      // Filter out pure STUN servers to prevent exposing caller's local LAN & public ISP IP to untrusted peers
      iceServers = iceServers.filter((s: any) => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
        return urls.some((u: string) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      iceServers,
      iceTransportPolicy: privacyRelay ? 'relay' : 'all',
      privacyRelay,
      shielded: privacyRelay,
    }));
    return true;
  }

  // 2. Call Offer
  if (url.pathname === '/api/call/offer' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const recipientDid = String(parsed.recipientDid || '');
      const offerSdp = String(parsed.offerSdp || parsed.sdp || parsed.sdpOffer || '');
      const callType = parsed.callType === 'video' ? 'video' : 'audio';
      const privacyRelay = Boolean(parsed.privacyRelay || parsed.shieldedRelay || url.searchParams.get('privacy') === 'relay');

      if (!recipientDid || !offerSdp) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'recipientDid and offerSdp are required' }));
        return true;
      }

      try {
        const session = sovraDb.createCallOffer(principal.did, recipientDid, offerSdp, callType);
        if (privacyRelay) {
          (session as any).privacyRelay = true;
          sovraDb.save();
        }

        // Notify recipient
        const senderUser = sovraDb.findUserByDid(principal.did);
        sovraDb.addNotification({
          recipientDid,
          senderDid: principal.did,
          type: 'call',
          title: `Incoming ${callType.toUpperCase()} Call`,
          body: `${senderUser?.displayName || senderUser?.handle || 'A peer'} is calling you...`,
          link: '/app',
          data: { callId: session.callId, callType },
        });

        // Blind Push Gateway: Wake mobile receiver device in background
        try {
          const recipientBlindChannel = crypto.createHash('sha256').update(recipientDid).digest('hex');
          blindPushRelay.dispatchBlindSignal({
            blindChannelId: recipientBlindChannel,
            opaqueWakeupHint: crypto.randomBytes(16).toString('hex'),
            priority: 'high',
            timestamp: Date.now(),
          });
        } catch (_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, session, sessionId: session.callId }));
      } catch (callErr: any) {
        const msg = callErr?.message || 'Call initiation failed';
        if (callErr?.code === 'BUSY') {
          res.writeHead(486, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg, code: 'BUSY' }));
        } else if (msg.includes('Forbidden') || msg.includes('Block relationship')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        } else if (msg.includes('engaged in an active call')) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg, code: 'ALREADY_IN_CALL' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 3. Incoming Call check
  if (url.pathname === '/api/call/incoming' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }
    const userDid = principal.did;
    const allCalls = sovraDb.getState().call_sessions || [];
    const now = Date.now();
    const incoming = allCalls.find(c =>
      c.recipientDid === userDid &&
      (c.status === 'offering' || c.status === 'ringing') &&
      now - c.createdAt < 45000 &&
      !sovraDb.isBlocked(c.callerDid, userDid) &&
      !sovraDb.isBlocked(userDid, c.callerDid)
    );
    if (!incoming) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, incomingCall: null }));
      return true;
    }
    const callerUser = sovraDb.findUserByDid(incoming.callerDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      incomingCall: {
        callId: incoming.callId,
        callerDid: incoming.callerDid,
        callerName: callerUser?.displayName || callerUser?.name || incoming.callerName || 'Peer',
        callerHandle: callerUser?.handle || '@peer',
        callerAvatar: callerUser?.avatar || incoming.callerAvatar || '📞',
        callerAvatarBg: callerUser?.avatarBg || '#6366f1',
        callerAvatarDataUrl: callerUser?.avatarDataUrl,
        callType: incoming.callType || 'audio',
        sdpOffer: incoming.sdpOffer,
        createdAt: incoming.createdAt,
      }
    }));
    return true;
  }

  // 4. Poll Call
  if (url.pathname === '/api/call/poll' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }
    const callId = url.searchParams.get('callId') || '';
    if (!callId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'callId required' }));
      return true;
    }
    const allCalls = sovraDb.getState().call_sessions || [];
    const anyCall = allCalls.find(c => c.callId === callId);
    if (anyCall && anyCall.callerDid !== principal.did && anyCall.recipientDid !== principal.did) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized access to call session' }));
      return true;
    }
    const session = sovraDb.pollCall(callId, principal.did);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session }));
    return true;
  }

  // 5. Answer Call
  if (url.pathname === '/api/call/answer' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || '');
      const answerSdp = String(parsed.answerSdp || parsed.sdp || '');
      if (!callId || !answerSdp) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId and answerSdp are required' }));
        return true;
      }

      const allCalls = sovraDb.getState().call_sessions || [];
      const existingCall = allCalls.find(c => c.callId === callId);
      if (!existingCall) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
        return true;
      }

      if (existingCall.recipientDid !== principal.did) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Only the designated recipient can answer the call' }));
        return true;
      }

      if (existingCall.status !== 'offering' && existingCall.status !== 'ringing') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Conflict: Call is in '${existingCall.status}' state and cannot be answered` }));
        return true;
      }

      try {
        const session = sovraDb.answerCall(callId, principal.did, answerSdp);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Call session not found or answer rejected' }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, session }));
      } catch (ansErr: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: ansErr?.message || 'Answer failed' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 6. ICE Candidate
  if (url.pathname === '/api/call/candidate' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || '');
      const candidate = parsed.candidate;
      if (!callId || !candidate) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId and candidate are required' }));
        return true;
      }

      const allCalls = sovraDb.getState().call_sessions || [];
      const existingCall = allCalls.find(c => c.callId === callId);
      if (!existingCall) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
        return true;
      }

      if (existingCall.callerDid !== principal.did && existingCall.recipientDid !== principal.did) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized candidate submission' }));
        return true;
      }

      if (existingCall.status === 'ended' || existingCall.status === 'rejected') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Conflict: Call has already ended' }));
        return true;
      }

      const isPrivacyRelay = Boolean((existingCall as any).privacyRelay || parsed.privacyRelay);
      if (isPrivacyRelay && candidate) {
        const candStr = typeof candidate === 'string' ? candidate : String(candidate.candidate || '');
        // When Privacy Relay is active, strip 'typ host' (internal LAN IP) and 'typ srflx' (public ISP IP)
        // Relay only TURN candidates to prevent geographic & network IP leaks to untrusted peers
        if (candStr.includes('typ host') || candStr.includes('typ srflx')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            session: existingCall,
            masked: true,
            privacyRelay: true,
            message: 'Privacy Relay active: host/srflx IP candidate masked',
          }));
          return true;
        }
      }

      try {
        const session = sovraDb.addIceCandidate(callId, principal.did, candidate);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: !!session, session }));
      } catch (candErr: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: candErr?.message || 'Candidate error' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7. End Call
  if (url.pathname === '/api/call/end' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || parsed.sessionId || '');
      const reason = parsed.reason ? String(parsed.reason) : undefined;
      if (!callId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId is required' }));
        return true;
      }

      const allCalls = sovraDb.getState().call_sessions || [];
      const existingCall = allCalls.find(c => c.callId === callId);
      if (!existingCall) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
        return true;
      }

      if (existingCall.callerDid !== principal.did && existingCall.recipientDid !== principal.did) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized call termination' }));
        return true;
      }

      const session = sovraDb.endCall(callId, principal.did, reason);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, session }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 8. Restart ICE
  if (url.pathname === '/api/call/restart-ice' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || '');
      if (!callId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId is required' }));
        return true;
      }

      const allCalls = sovraDb.getState().call_sessions || [];
      const existingCall = allCalls.find(c => c.callId === callId);
      if (!existingCall) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
        return true;
      }

      if (existingCall.callerDid !== principal.did && existingCall.recipientDid !== principal.did) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized ICE restart' }));
        return true;
      }

      existingCall.status = 'reconnecting';
      existingCall.updatedAt = Date.now();
      sovraDb.recordCallMetric({
        callId,
        eventType: 'ice_restarted',
        callerDid: existingCall.callerDid,
        recipientDid: existingCall.recipientDid,
      });
      sovraDb.save();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'reconnecting' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 9. Call Telemetry Metrics
  if (url.pathname === '/api/call/metrics' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }

    const callId = url.searchParams.get('callId') || undefined;
    const isAdmin = principal.role === 'SUPER_ADMIN' || principal.role === 'SECURITY_ADMIN' || principal.did.startsWith('did:sovra:admin');
    const metrics = sovraDb.getCallMetrics({
      callId,
      userDid: isAdmin ? undefined : principal.did,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, metrics, count: metrics.length }));
    return true;
  }

  return false;
}
