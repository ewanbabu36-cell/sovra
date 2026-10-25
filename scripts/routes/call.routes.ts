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
import { dispatchCallWebPush } from './push.routes.ts';
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
  broadcastChatEvent?: (recipientDid: string, payload: any, eventType?: string) => void;
}

interface RelayedAudioChunk {
  seq: number;
  callId: string;
  senderDid: string;
  pcmBase64: string;
  sampleRate: number;
  ts: number;
}

const callAudioChunkStore = new Map<string, RelayedAudioChunk[]>();
let callAudioSeqCounter = 0;

interface CallSseClient {
  res: http.ServerResponse;
  userDid: string;
}

const callSseClients = new Map<string, Set<CallSseClient>>();
const callHeartbeatMap = new Map<string, { callerLastSeen: number; calleeLastSeen: number; lastChecked: number }>();

export function broadcastCallSse(callId: string, eventName: string, data: any): void {
  const clients = callSseClients.get(callId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function recordCallHeartbeat(callId: string, userDid: string, role?: 'caller' | 'callee'): void {
  const now = Date.now();
  let entry = callHeartbeatMap.get(callId);
  if (!entry) {
    entry = { callerLastSeen: now, calleeLastSeen: now, lastChecked: now };
    callHeartbeatMap.set(callId, entry);
  }
  if (role === 'caller') {
    entry.callerLastSeen = now;
  } else if (role === 'callee') {
    entry.calleeLastSeen = now;
  } else {
    entry.callerLastSeen = now;
  }
}

export function checkAndPruneCallHeartbeats(): void {
  const now = Date.now();
  const allCalls = sovraDb.getState().call_sessions || [];
  for (const session of allCalls) {
    if (
      session.status === 'offering' ||
      session.status === 'ringing' ||
      session.status === 'answered' ||
      session.status === 'connected'
    ) {
      const hb = callHeartbeatMap.get(session.callId);
      const callerAge = hb ? now - hb.callerLastSeen : now - session.createdAt;
      const calleeAge = hb ? now - hb.calleeLastSeen : now - session.createdAt;
      const isConnected = session.status === 'connected' || session.status === 'answered';
      const timeoutThreshold = isConnected ? 12000 : 15000;

      if (callerAge > timeoutThreshold && calleeAge > timeoutThreshold) {
        try {
          sovraDb.endCall(session.callId, session.callerDid, 'ended_timeout');
          broadcastCallSse(session.callId, 'call_timeout', {
            callId: session.callId,
            reason: 'ended_timeout',
            message: 'Call timed out due to heartbeat inactivity (>12s)',
          });
          callHeartbeatMap.delete(session.callId);
          callAudioChunkStore.delete(session.callId);
        } catch {}
      }
    }
  }
}

export async function handleCallSignalingRoutes(ctx: CallRouteContext): Promise<boolean> {
  const { req, res, url, blindPushRelay, getIceServers, readBoundedBody, resolvePrincipal, enforceAuth, broadcastChatEvent } = ctx;

  // 1. ICE Servers configuration with Privacy Relay Mode (IP Leakage Shielding)
  if ((url.pathname === '/api/call/ice-servers' || url.pathname === '/api/webrtc/ice-servers' || url.pathname === '/api/rtc/ice-servers') && req.method === 'GET') {
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
      const privacyRelay = Boolean(url.searchParams.get('privacy') === 'relay' || req.headers['x-sovra-privacy-mode'] === 'relay');

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

        if (broadcastChatEvent) {
          try {
            broadcastChatEvent(recipientDid, {
              type: 'call_invite',
              signalType: 'call_invite',
              callId: session.callId,
              callerDid: principal.did,
              callerName: senderUser?.displayName || senderUser?.handle || 'Peer',
              callerAvatar: senderUser?.avatar || '📞',
              callerAvatarBg: (senderUser as any)?.avatarBg || '#10b981',
              recipientDid,
              callType,
            }, 'call_signal');
          } catch (_) {}
        }

        // Blind Push Gateway: Wake mobile receiver device in background
        try {
          const recipientBlindChannel = crypto.createHash('sha256').update(recipientDid).digest('hex');
          blindPushRelay.dispatchBlindSignal({
            blindChannelId: recipientBlindChannel,
            opaqueWakeupHint: crypto.randomBytes(16).toString('hex'),
            priority: 'high',
            timestamp: Date.now(),
          });
          void dispatchCallWebPush(recipientDid, {
            callId: session.callId,
            callType,
            callerDid: principal.did,
            callerName: senderUser?.displayName || senderUser?.handle || 'Peer',
          });
        } catch (_) {}

        recordCallHeartbeat(session.callId, principal.did, 'caller');
        broadcastCallSse(session.callId, 'call_offer', {
          callId: session.callId,
          callerDid: principal.did,
          recipientDid,
          callType,
          sdpOffer: session.sdpOffer,
        });

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

  // 3.5 Real-Time Call Signaling Stream (Server-Sent Events)
  if ((url.pathname === '/api/call/stream' || url.pathname === '/api/webrtc/stream') && req.method === 'GET') {
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
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized access to call stream' }));
      return true;
    }

    recordCallHeartbeat(callId, principal.did, anyCall?.callerDid === principal.did ? 'caller' : 'callee');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`: sse connected\nevent: ready\ndata: ${JSON.stringify({ ok: true, callId, status: anyCall?.status || 'active' })}\n\n`);

    if (!callSseClients.has(callId)) {
      callSseClients.set(callId, new Set());
    }
    const clientObj: CallSseClient = { res, userDid: principal.did };
    callSseClients.get(callId)!.add(clientObj);

    req.on('close', () => {
      const set = callSseClients.get(callId);
      if (set) {
        set.delete(clientObj);
        if (set.size === 0) callSseClients.delete(callId);
      }
    });

    return true;
  }

  // 3.6 Call Heartbeat Beacon & Timeout Pruner
  if ((url.pathname === '/api/call/heartbeat' || url.pathname === '/api/webrtc/heartbeat') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = body ? JSON.parse(body) : {};
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || url.searchParams.get('callId') || '');
      if (!callId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId required' }));
        return true;
      }

      const allCalls = sovraDb.getState().call_sessions || [];
      const session = allCalls.find(c => c.callId === callId);
      const role = session?.callerDid === principal.did ? 'caller' : 'callee';
      recordCallHeartbeat(callId, principal.did, role);
      checkAndPruneCallHeartbeats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, callId, status: session?.status || 'unknown' }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
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

    recordCallHeartbeat(callId, principal.did, anyCall?.callerDid === principal.did ? 'caller' : 'callee');
    checkAndPruneCallHeartbeats();

    const session = sovraDb.pollCall(callId, principal.did);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Call session not found' }));
      return true;
    }
    const afterAudioSeq = Number(url.searchParams.get('afterAudioSeq') || 0);
    const storedChunks = callAudioChunkStore.get(callId) || [];
    const audioChunks = storedChunks.filter(
      c => c.senderDid !== principal.did && c.seq > afterAudioSeq && Date.now() - c.ts < 8000
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session, audioChunks }));
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
        if (broadcastChatEvent) {
          try {
            broadcastChatEvent(existingCall.callerDid, {
              type: 'call_accept',
              signalType: 'call_accept',
              callId,
              answerSdp,
              status: 'answered',
            }, 'call_signal');
          } catch (_) {}
        }
        recordCallHeartbeat(callId, principal.did, 'callee');
        broadcastCallSse(callId, 'call_answer', {
          callId,
          answerSdp,
          status: 'answered',
        });
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

      const isPrivacyRelay = Boolean(url.searchParams.get('privacy') === 'relay' || req.headers['x-sovra-privacy-mode'] === 'relay');
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
        if (broadcastChatEvent && existingCall) {
          try {
            const targetDid = existingCall.callerDid === principal.did ? existingCall.recipientDid : existingCall.callerDid;
            broadcastChatEvent(targetDid, {
              type: 'ice_candidate',
              signalType: 'ice_candidate',
              callId,
              senderDid: principal.did,
              candidate,
            }, 'call_signal');
          } catch (_) {}
        }
        recordCallHeartbeat(callId, principal.did, existingCall?.callerDid === principal.did ? 'caller' : 'callee');
        broadcastCallSse(callId, 'ice_candidate', {
          callId,
          senderDid: principal.did,
          candidate,
        });
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

      const wasConnected = Boolean(existingCall.status === 'connected' || existingCall.status === 'answered' || (existingCall as any).answeredAt);
      const isDeclined = reason === 'declined' || reason === 'rejected';
      const sigType = isDeclined ? 'call_reject' : 'call_hangup';

      const session = sovraDb.endCall(callId, principal.did, reason);
      callAudioChunkStore.delete(callId);
      broadcastCallSse(callId, 'call_ended', {
        callId,
        reason,
        status: 'ended',
      });
      callHeartbeatMap.delete(callId);
      callSseClients.delete(callId);

      // WhatsApp-Grade: Auto-insert Missed Call / Call Summary bubble in chat log
      try {
        const callerUser = sovraDb.findUserByDid(existingCall.callerDid);
        const isVideo = existingCall.callType === 'video';
        let bubbleText = '';
        if (wasConnected) {
          const startTime = (existingCall as any).answeredAt || existingCall.createdAt;
          const durSec = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
          const mins = Math.floor(durSec / 60);
          const secs = durSec % 60;
          const durFormatted = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
          bubbleText = isVideo ? `📹 Video Call ended • ${durFormatted}` : `📞 Voice Call ended • ${durFormatted}`;
        } else if (isDeclined) {
          bubbleText = isVideo ? '📹 Declined Video Call' : '📞 Declined Voice Call';
        } else {
          bubbleText = isVideo ? '📹 Missed Video Call' : '📞 Missed Voice Call';
        }

        sovraDb.appendMessage({
          senderDid: existingCall.callerDid,
          recipientDid: existingCall.recipientDid,
          senderName: callerUser?.displayName || callerUser?.handle || 'Peer',
          text: bubbleText,
          status: 'delivered',
          isE2EE: true,
          caption: wasConnected ? 'Call completed' : (isDeclined ? 'Declined call' : 'Missed call'),
        });
      } catch (bubbleErr) {
        console.warn('[Call] Failed to append call log bubble to chat:', bubbleErr);
      }

      if (broadcastChatEvent) {
        try {
          const targetDid = existingCall.callerDid === principal.did ? existingCall.recipientDid : existingCall.callerDid;
          broadcastChatEvent(targetDid, {
            type: sigType,
            signalType: sigType,
            callId,
            reason: reason || 'peer_hung_up',
          }, 'call_signal');
        } catch (_) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, session }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7b. Live E2EE Audio Relay Chunk (CGNAT / Symmetric NAT Fallback Stream)
  if (url.pathname === '/api/call/audio' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 256 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || '');
      const pcmBase64 = String(parsed.pcmBase64 || '');
      const sampleRate = Number(parsed.sampleRate || 8000);
      if (!callId || !pcmBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'callId and pcmBase64 are required' }));
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
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized audio relay submission' }));
        return true;
      }

      if (existingCall.status === 'ended' || existingCall.status === 'rejected') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Conflict: Call has already ended' }));
        return true;
      }

      existingCall.updatedAt = Date.now();
      const chunk: RelayedAudioChunk = {
        seq: ++callAudioSeqCounter,
        callId,
        senderDid: principal.did,
        pcmBase64,
        sampleRate,
        ts: Date.now(),
      };

      let list = callAudioChunkStore.get(callId);
      if (!list) {
        list = [];
        callAudioChunkStore.set(callId, list);
      }
      list.push(chunk);
      if (list.length > 25) {
        list.splice(0, list.length - 25);
      }

      if (broadcastChatEvent) {
        try {
          const targetDid = existingCall.callerDid === principal.did ? existingCall.recipientDid : existingCall.callerDid;
          broadcastChatEvent(targetDid, chunk, 'call_audio');
        } catch (_) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, seq: chunk.seq }));
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

  // 8b. Switch Call Mode (Audio <-> Video)
  if (url.pathname === '/api/call/switch-mode' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const callId = String(parsed.callId || '');
      const mode = parsed.mode === 'video' ? 'video' : 'audio';
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
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Unauthorized mode switch' }));
        return true;
      }

      existingCall.callType = mode;
      existingCall.updatedAt = Date.now();
      sovraDb.recordCallMetric({
        callId,
        eventType: 'call_mode_switched',
        callerDid: existingCall.callerDid,
        recipientDid: existingCall.recipientDid,
      });
      sovraDb.save();

      if (broadcastChatEvent) {
        try {
          const targetDid = existingCall.callerDid === principal.did ? existingCall.recipientDid : existingCall.callerDid;
          broadcastChatEvent(targetDid, {
            type: 'mode_switch',
            signalType: 'mode_switch',
            callId,
            mode,
            senderDid: principal.did,
          }, 'call_signal');
        } catch (_) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode, callId }));
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
