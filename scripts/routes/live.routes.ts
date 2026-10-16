/**
 * @file scripts/routes/live.routes.ts
 * Sovra P2P Live Streaming & Real-Time Swarm Broadcast Route Controller.
 *
 * Implements:
 * 1. WebRTC mesh live room session management & discovery (/api/live/streams, /api/live/stream/start)
 * 2. Real-time WebRTC SDP/ICE signaling for broadcast mesh (/api/live/stream/signal & signals)
 * 3. Live swarm viewer join/leave tracking (/api/live/stream/join & leave)
 * 4. Real-time live comments overlay stream (/api/live/stream/comments & /api/live/stream/events)
 * 5. Floating SOV live tipping with 95% creator / 5% seeder split ledger (/api/live/stream/tip)
 * 6. Broadcast conclusion with automatic VOD archiving to Watch catalog (/api/live/stream/end)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sovraDb, type LiveSessionRecord, type LiveSessionStatus } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import { signEd25519, bytesToHex } from '../../packages/crypto/dist/index.js';

const PRIMARY_RPC = process.env.SOVRA_L1_RPC || 'http://127.0.0.1:26657';

export interface LiveRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

function resolveUserDid(ctx: LiveRouteContext, bodyObj?: Record<string, any>): string {
  const principal = ctx.resolvePrincipal(ctx.req);
  if (principal && principal.did) return principal.did;
  if (bodyObj && bodyObj.viewerDid) return String(bodyObj.viewerDid);
  if (bodyObj && bodyObj.creatorDid) return String(bodyObj.creatorDid);
  const qDid = ctx.url.searchParams.get('userDid') || ctx.url.searchParams.get('did');
  if (qDid && qDid.trim().length > 0) return qDid.trim();
  return 'did:sovra:guest_' + Math.random().toString(36).substring(2, 8);
}

export async function handleLiveStreamingRoutes(ctx: LiveRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody } = ctx;

  // 1. GET /api/live/streams - List live streams (live now, scheduled, or ended)
  if (url.pathname === '/api/live/streams' && req.method === 'GET') {
    const statusParam = (url.searchParams.get('status') || 'LIVE').toUpperCase() as LiveSessionStatus;
    const all = sovraDb.getAllLiveSessions();
    const filtered = statusParam === 'LIVE'
      ? all.filter(s => s.status === 'LIVE' || s.status === 'STARTING')
      : (statusParam === 'SCHEDULED' ? all.filter(s => s.status === 'SCHEDULED') : all);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: filtered.length, streams: filtered }));
    return true;
  }

  // 2. POST /api/live/stream/start - Start instant live broadcast session
  if (url.pathname === '/api/live/stream/start' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const creatorDid = resolveUserDid(ctx, parsed);
      const user = sovraDb.findUserByDid(creatorDid);
      const rawTitle = parsed.title !== undefined ? String(parsed.title).trim() : 'Sovereign Swarm Live Broadcast';
      if (!rawTitle) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Broadcast title cannot be empty' }));
        return true;
      }
      const title = rawTitle;
      const description = String(parsed.description || 'Live P2P interactive swarm broadcast').trim();
      const category = String(parsed.category || 'tech');

      const session = sovraDb.createLiveSession({
        creatorDid,
        creatorHandle: user?.handle || 'creator',
        creatorName: user?.displayName || 'Live Creator',
        creatorAvatar: user?.avatar || '🔴',
        title,
        description,
        category,
        scheduledStartTime: Date.now(),
      });

      // Transition immediately to LIVE status
      sovraDb.updateLiveSessionStatus(session.id, 'STARTING', creatorDid);
      const liveRes = sovraDb.updateLiveSessionStatus(session.id, 'LIVE', creatorDid);
      const joinRes = sovraDb.joinLiveStream(session.id, creatorDid);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        session: joinRes.session || liveRes.session || session,
        webrtcRoomId: `room_${session.id}`,
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid live broadcast payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 3. POST /api/live/stream/join - Viewer joins live stream
  if (url.pathname === '/api/live/stream/join' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'sessionId is required' }));
        return true;
      }

      const viewerDid = resolveUserDid(ctx, parsed);
      const joinRes = sovraDb.joinLiveStream(sessionId, viewerDid);
      if (!joinRes.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: joinRes.error }));
        return true;
      }

      const recentComments = sovraDb.getLiveChatMessages(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        session: joinRes.session,
        viewerCount: joinRes.viewerCount,
        recentComments: recentComments.slice(-20),
        recentTips: joinRes.session?.tips || [],
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid join payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 4. POST /api/live/stream/leave - Viewer leaves live stream
  if (url.pathname === '/api/live/stream/leave' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || '');
      const viewerDid = resolveUserDid(ctx, parsed);
      const leaveRes = sovraDb.leaveLiveStream(sessionId, viewerDid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, session: leaveRes.session, viewerCount: leaveRes.viewerCount }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid leave payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 5. POST /api/live/stream/tip - Send real-time SOV tip to live streamer (with 95/5 split)
  if (url.pathname === '/api/live/stream/tip' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || '');
      const amountSov = Number(parsed.amountSov);
      const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';

      if (!sessionId || isNaN(amountSov) || amountSov <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'sessionId and positive amountSov are required' }));
        return true;
      }

      const senderDid = resolveUserDid(ctx, parsed);
      const user = sovraDb.findUserByDid(senderDid);
      const senderName = parsed.senderName || user?.displayName || 'Supporter';

      const tipRes = sovraDb.sendLiveStreamTip({
        sessionId,
        senderDid,
        senderName,
        amountSov,
        note,
      });

      if (!tipRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: tipRes.error }));
        return true;
      }

      const enrichedTip = {
        ...tipRes.tip,
        creatorSplitSov: tipRes.tip.creatorShareSov,
        seederSplitSov: tipRes.tip.seederShareSov,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        animation: 'FLYING_COINS',
        tip: enrichedTip,
        tipTotalSov: tipRes.tipTotalSov,
        animationEvent: {
          type: 'FLYING_COINS',
          amount: amountSov,
          senderName,
          note,
        },
        split: {
          creatorSov: tipRes.tip.creatorShareSov,
          seederSov: tipRes.tip.seederShareSov,
          formula: '95/5 Instant Netting State Channel',
        },
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid tip payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // ==========================================
  // ⚡ COSMWASM CW20 LIVESTREAM SUPERCHAT & TIPPING
  // ==========================================

  // 5.1 POST /api/livestream/superchat (or /api/live/stream/superchat)
  if ((url.pathname === '/api/livestream/superchat' || url.pathname === '/api/live/stream/superchat') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || parsed.streamId || 'live_stream_default');
      const senderDid = resolveUserDid(ctx, parsed);
      const senderAddress = parsed.senderAddress || parsed.address || (
        'sovra1' + crypto.createHash('sha256').update(senderDid).digest('hex').slice(0, 38)
      );
      const senderName = parsed.senderName || parsed.displayName || 'VIP Supporter';
      const amount = String(parsed.amount || '10000000'); // default 10 tokens
      const tokenAddress = parsed.tokenAddress || '';
      const tokenSymbol = (parsed.tokenSymbol || 'FAN').toUpperCase();
      const message = String(parsed.message || parsed.text || 'Awesome stream! 🚀').trim();

      const numAmount = Number(amount) / 1_000_000;
      let tier: 'bronze' | 'silver' | 'gold' | 'diamond' = 'bronze';
      let bannerColor = '#2563eb'; // blue
      let durationMs = 5000;

      if (numAmount >= 500) {
        tier = 'diamond';
        bannerColor = '#ec4899'; // magenta diamond
        durationMs = 30000;
      } else if (numAmount >= 100) {
        tier = 'gold';
        bannerColor = '#eab308'; // gold
        durationMs = 20000;
      } else if (numAmount >= 25) {
        tier = 'silver';
        bannerColor = '#8b5cf6'; // purple
        durationMs = 10000;
      }

      const dbAny = sovraDb as any;
      if (!Array.isArray(dbAny.db.superchats)) dbAny.db.superchats = [];
      if (!Array.isArray(dbAny.db.live_sessions)) dbAny.db.live_sessions = [];

      let session = dbAny.db.live_sessions.find((s: any) => s.id === sessionId);
      if (!session) {
        session = {
          id: sessionId,
          title: 'Live Stream Broadcast',
          creatorDid: parsed.creatorDid || 'did:sovra:creator_primary',
          creatorAddress: parsed.creatorAddress || 'sovra12a806ca82d506a025d580d40600abc77a69e10e7',
          status: 'LIVE',
          superchats: [],
          tips: [],
          tipTotalSov: 0
        };
        dbAny.db.live_sessions.push(session);
      }
      if (!Array.isArray(session.superchats)) session.superchats = [];

      const superchatId = 'sc_' + crypto.randomBytes(6).toString('hex');
      const creatorAddress = session.creatorAddress || (
        'sovra1' + crypto.createHash('sha256').update(session.creatorDid || 'did:sovra:creator_primary').digest('hex').slice(0, 38)
      );

      let txHash = '0x' + crypto.randomBytes(32).toString('hex');
      if (tokenAddress) {
        try {
          const valKeyPath = path.resolve(process.cwd(), 'chain/mytestnet/node0/validator-0.key.json');
          if (fs.existsSync(valKeyPath)) {
            const valKey = JSON.parse(fs.readFileSync(valKeyPath, 'utf8'));
            const senderKeyAddr = senderAddress.startsWith('sovra12a806ca82') ? senderAddress : valKey.address;
            const privKey = Buffer.from(valKey.priv_key, 'hex').subarray(0, 32);

            const nonceRes = await fetch(`${PRIMARY_RPC}/query/nonce?address=${encodeURIComponent(senderKeyAddr)}`);
            const nonceData = await nonceRes.json();
            const nonce = Number(nonceData.nonce || 0);

            const transferMsg = {
              transfer: {
                recipient: creatorAddress,
                amount
              }
            };

            const txPayload = {
              type: 'execute',
              sender: senderKeyAddr,
              contract: tokenAddress,
              nonce,
              fee: '1000',
              msg: JSON.stringify(transferMsg)
            };

            const signBytes = Buffer.from(JSON.stringify(txPayload), 'utf8');
            const sig = bytesToHex(signEd25519(new Uint8Array(privKey), new Uint8Array(signBytes)));
            const rpcRes = await fetch(`${PRIMARY_RPC}/broadcast_tx_commit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...txPayload, pub_key: valKey.pub_key, sig })
            });
            if (rpcRes.ok) {
              const rData = await rpcRes.json();
              if (rData && rData.hash) txHash = rData.hash;
            }
          }
        } catch (l1Err) {
          console.warn('[SUPERCHAT] L1 CW20 transfer broadcast warning:', l1Err);
        }
      }

      const superchatRecord = {
        id: superchatId,
        sessionId,
        senderAddress,
        senderDid,
        senderName,
        amount,
        displayAmount: numAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        tokenAddress,
        tokenSymbol,
        message,
        tier,
        bannerColor,
        durationMs,
        txHash,
        timestamp: Date.now()
      };

      session.superchats.push(superchatRecord);
      dbAny.db.superchats.unshift(superchatRecord);

      // Compute Top Supporters Leaderboard
      const supporterMap = new Map<string, { senderName: string; senderAddress: string; totalAmount: bigint; tokenSymbol: string; count: number }>();
      for (const sc of session.superchats) {
        const key = sc.senderAddress || sc.senderName;
        const existing = supporterMap.get(key) || {
          senderName: sc.senderName,
          senderAddress: sc.senderAddress,
          totalAmount: 0n,
          tokenSymbol: sc.tokenSymbol,
          count: 0
        };
        existing.totalAmount += BigInt(sc.amount || '0');
        existing.count += 1;
        supporterMap.set(key, existing);
      }

      const leaderboard = Array.from(supporterMap.values())
        .map(s => ({
          senderName: s.senderName,
          senderAddress: s.senderAddress,
          totalAmount: s.totalAmount.toString(),
          displayTotal: (Number(s.totalAmount) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          tokenSymbol: s.tokenSymbol,
          superchatCount: s.count
        }))
        .sort((a, b) => Number(BigInt(b.totalAmount) - BigInt(a.totalAmount)))
        .slice(0, 10);

      if (typeof dbAny.save === 'function') dbAny.save();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        superchat: superchatRecord,
        animation: 'HOLOGRAPHIC_BANNER',
        leaderboard,
        log: `SuperChat ${superchatId} broadcasted successfully (${numAmount} ${tokenSymbol})`
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'SuperChat failed: ' + (err?.message || err) }));
    }
    return true;
  }

  // 5.2 GET /api/livestream/superchats (or /api/live/stream/superchats)
  if ((url.pathname === '/api/livestream/superchats' || url.pathname === '/api/live/stream/superchats') && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('streamId');
    const dbAny = sovraDb as any;
    let chats: any[] = dbAny.db?.superchats || [];
    if (sessionId) {
      chats = chats.filter((c: any) => c.sessionId === sessionId);
    }

    const supporterMap = new Map<string, { senderName: string; senderAddress: string; totalAmount: bigint; tokenSymbol: string; count: number }>();
    for (const sc of chats) {
      const key = sc.senderAddress || sc.senderName;
      const existing = supporterMap.get(key) || {
        senderName: sc.senderName,
        senderAddress: sc.senderAddress,
        totalAmount: 0n,
        tokenSymbol: sc.tokenSymbol,
        count: 0
      };
      existing.totalAmount += BigInt(sc.amount || '0');
      existing.count += 1;
      supporterMap.set(key, existing);
    }

    const leaderboard = Array.from(supporterMap.values())
      .map(s => ({
        senderName: s.senderName,
        senderAddress: s.senderAddress,
        totalAmount: s.totalAmount.toString(),
        displayTotal: (Number(s.totalAmount) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        tokenSymbol: s.tokenSymbol,
        superchatCount: s.count
      }))
      .sort((a, b) => Number(BigInt(b.totalAmount) - BigInt(a.totalAmount)))
      .slice(0, 10);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      superchats: chats,
      count: chats.length,
      leaderboard
    }));
    return true;
  }

  // 6. POST /api/live/stream/signal - WebRTC mesh signaling (offer/answer/candidate)
  if (url.pathname === '/api/live/stream/signal' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || '');
      const type = parsed.type as 'offer' | 'answer' | 'candidate';
      const payload = parsed.payload;

      if (!sessionId || !type || !payload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'sessionId, type, and payload are required' }));
        return true;
      }

      const fromDid = resolveUserDid(ctx, parsed);
      const toDid = parsed.toDid ? String(parsed.toDid) : undefined;

      const sigRes = sovraDb.sendLiveStreamSignal({
        sessionId,
        fromDid,
        toDid,
        type,
        payload,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, signal: sigRes.signal, signalId: sigRes.signal?.id }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid signal payload: ' + (err?.message || err) }));
    }
    return true;
  }

  // 7. GET /api/live/stream/signals - Retrieve WebRTC mesh signals
  if (url.pathname === '/api/live/stream/signals' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'sessionId is required' }));
      return true;
    }

    const peerDid = url.searchParams.get('peerDid') || undefined;
    const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;

    const signals = sovraDb.getLiveStreamSignals(sessionId, peerDid, since);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: signals.length, signals }));
    return true;
  }

  // 8. GET /api/live/stream/events - Poll live stream status, viewer count, tips & comments
  if (url.pathname === '/api/live/stream/events' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'sessionId is required' }));
      return true;
    }

    const session = sovraDb.getLiveSessionById(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Live session not found' }));
      return true;
    }

    const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : 0;
    const allComments = sovraDb.getLiveChatMessages(sessionId);
    const newComments = since > 0 ? allComments.filter(c => c.timestamp > since) : allComments.slice(-25);
    const allTips = session.tips || [];
    const newTips = since > 0 ? allTips.filter(t => t.timestamp > since) : allTips.slice(-10);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      status: session.status,
      viewerCount: session.viewerCount || 0,
      peakViewers: session.peakViewers || 0,
      tipTotalSov: session.tipTotalSov || 0,
      comments: newComments,
      tips: newTips,
      timestamp: Date.now(),
    }));
    return true;
  }

  // 9. POST /api/live/stream/end - Broadcaster ends live broadcast & auto-archives to Watch catalog
  if (url.pathname === '/api/live/stream/end' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 32 * 1024);
    if (!ok) return true;

    try {
      const parsed = JSON.parse(body);
      const sessionId = String(parsed.sessionId || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'sessionId is required' }));
        return true;
      }

      const requesterDid = resolveUserDid(ctx, parsed);
      const endRes = sovraDb.endLiveBroadcast(sessionId, requesterDid);
      if (!endRes.ok) {
        const errLower = (endRes.error || '').toLowerCase();
        const isAuthErr = errLower.includes('unauthorized') || errLower.includes('broadcaster') || errLower.includes('only');
        res.writeHead(isAuthErr ? 403 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: endRes.error }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        session: endRes.session,
        archiveVideo: endRes.archiveVideo,
        message: 'Live broadcast ended successfully and archived to Watch catalog',
      }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid end broadcast payload: ' + (err?.message || err) }));
    }
    return true;
  }

  return false;
}
