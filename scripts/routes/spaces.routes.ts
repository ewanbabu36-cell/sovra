/**
 * @file scripts/routes/spaces.routes.ts
 * Decentralized Multi-Peer Audio Spaces ("Sovra Spaces") Route Controller.
 *
 * Implements real-time spatial audio room creation, listener/speaker state transitions,
 * hand-raising queue, host moderation controls, and peer reaction multiplexing.
 */

import http from 'node:http';

export interface SovraSpaceParticipant {
  did: string;
  name: string;
  avatar?: string;
  isMuted?: boolean;
}

export interface SovraSpaceHandRaise {
  did: string;
  name: string;
  avatar?: string;
  requestedAt: number;
}

export interface SovraSpaceReaction {
  emoji: string;
  fromDid: string;
  timestamp: number;
}

export interface SovraSpace {
  spaceId: string;
  topic: string;
  hostDid: string;
  hostName: string;
  hostAvatar?: string;
  createdAt: number;
  status: 'live' | 'ended';
  speakers: SovraSpaceParticipant[];
  listeners: SovraSpaceParticipant[];
  raisedHands: SovraSpaceHandRaise[];
  reactions: SovraSpaceReaction[];
}

export interface SpacesRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal?: (req: http.IncomingMessage) => { did: string; handle?: string; role?: string } | null;
}

// In-memory active spaces registry
const activeSpaces = new Map<string, SovraSpace>();

// Initialize default seed space
const defaultSeedSpaceId = 'space-genesis-mesh';
activeSpaces.set(defaultSeedSpaceId, {
  spaceId: defaultSeedSpaceId,
  topic: '⚡ Sovereign Creators & WebRTC Mesh Stage',
  hostDid: 'did:sovra:carol_audio_engineer',
  hostName: 'Carol (Sound Designer)',
  hostAvatar: '🎧',
  createdAt: Date.now() - 3600000,
  status: 'live',
  speakers: [
    { did: 'did:sovra:carol_audio_engineer', name: 'Carol (Sound Designer)', avatar: '🎧', isMuted: false },
    { did: 'did:sovra:alice_master_key', name: 'Alice (Core Lab)', avatar: '👩‍💻', isMuted: false },
  ],
  listeners: [
    { did: 'did:sovra:bob_field_node', name: 'Bob (Mesh Node)', avatar: '🌐' },
    { did: 'did:sovra:dave_seeder_edge', name: 'Dave (BitSwap Seeder)', avatar: '⚡' },
  ],
  raisedHands: [
    { did: 'did:sovra:bob_field_node', name: 'Bob (Mesh Node)', avatar: '🌐', requestedAt: Date.now() - 120000 }
  ],
  reactions: [
    { emoji: '🔥', fromDid: 'did:sovra:bob_field_node', timestamp: Date.now() - 30000 },
    { emoji: '💎', fromDid: 'did:sovra:dave_seeder_edge', timestamp: Date.now() - 15000 },
  ],
});

export function getActiveSpacesList(): SovraSpace[] {
  return Array.from(activeSpaces.values()).filter(s => s.status === 'live');
}

export async function handleSpacesRoutes(ctx: SpacesRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody, resolvePrincipal } = ctx;

  if (!url.pathname.startsWith('/api/spaces/')) {
    return false;
  }

  // 1. GET /api/spaces/active
  if (url.pathname === '/api/spaces/active' && req.method === 'GET') {
    const list = getActiveSpacesList();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, spaces: list, count: list.length }));
    return true;
  }

  // 2. POST /api/spaces/create
  if (url.pathname === '/api/spaces/create' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const hostDid = parsed.hostDid || resolvePrincipal?.(req)?.did || 'did:sovra:anonymous_host';
      const hostName = parsed.hostName || 'Sovereign Host';
      const topic = parsed.topic || 'Sovereign Decentralized Audio Stage';
      const spaceId = 'space-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

      const newSpace: SovraSpace = {
        spaceId,
        topic,
        hostDid,
        hostName,
        hostAvatar: parsed.hostAvatar || '🎙️',
        createdAt: Date.now(),
        status: 'live',
        speakers: [{ did: hostDid, name: hostName, avatar: parsed.hostAvatar || '🎙️', isMuted: false }],
        listeners: [],
        raisedHands: [],
        reactions: [],
      };

      activeSpaces.set(spaceId, newSpace);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space: newSpace }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid space creation payload' }));
    }
    return true;
  }

  // 3. POST /api/spaces/join
  if (url.pathname === '/api/spaces/join' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const space = activeSpaces.get(parsed.spaceId);
      if (!space || space.status !== 'live') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Space not found or ended' }));
        return true;
      }

      const participantDid = parsed.did || resolvePrincipal?.(req)?.did || 'did:sovra:guest_' + Date.now();
      const participantName = parsed.name || 'Sovereign Peer';
      const avatar = parsed.avatar || '🎧';

      const isAlreadySpeaker = space.speakers.some(s => s.did === participantDid);
      const isAlreadyListener = space.listeners.some(l => l.did === participantDid);

      if (!isAlreadySpeaker && !isAlreadyListener) {
        if (parsed.role === 'speaker' && participantDid === space.hostDid) {
          space.speakers.push({ did: participantDid, name: participantName, avatar, isMuted: false });
        } else {
          space.listeners.push({ did: participantDid, name: participantName, avatar });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to join space' }));
    }
    return true;
  }

  // 4. POST /api/spaces/hand-raise
  if (url.pathname === '/api/spaces/hand-raise' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const space = activeSpaces.get(parsed.spaceId);
      if (!space || space.status !== 'live') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Space not found or ended' }));
        return true;
      }

      const participantDid = parsed.did || resolvePrincipal?.(req)?.did;
      if (!participantDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'User DID required' }));
        return true;
      }

      const isSpeaker = space.speakers.some(s => s.did === participantDid);
      if (isSpeaker) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Already a speaker', space }));
        return true;
      }

      const alreadyRaised = space.raisedHands.some(h => h.did === participantDid);
      if (!alreadyRaised) {
        space.raisedHands.push({
          did: participantDid,
          name: parsed.name || 'Sovereign Peer',
          avatar: parsed.avatar || '✋',
          requestedAt: Date.now(),
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space, raised: true }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Hand-raise failed' }));
    }
    return true;
  }

  // 5. POST /api/spaces/speak-grant
  if (url.pathname === '/api/spaces/speak-grant' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const space = activeSpaces.get(parsed.spaceId);
      if (!space || space.status !== 'live') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Space not found or ended' }));
        return true;
      }

      const targetDid = parsed.targetDid;
      const grant = Boolean(parsed.grant);

      // Remove from raised hands
      space.raisedHands = space.raisedHands.filter(h => h.did !== targetDid);

      if (grant) {
        // Move to speakers
        const listener = space.listeners.find(l => l.did === targetDid);
        space.listeners = space.listeners.filter(l => l.did !== targetDid);
        if (!space.speakers.some(s => s.did === targetDid)) {
          space.speakers.push({
            did: targetDid,
            name: listener?.name || parsed.targetName || 'Sovereign Speaker',
            avatar: listener?.avatar || '🎙️',
            isMuted: false,
          });
        }
      } else {
        // Demote back to listeners
        const speaker = space.speakers.find(s => s.did === targetDid);
        space.speakers = space.speakers.filter(s => s.did !== targetDid);
        if (speaker && !space.listeners.some(l => l.did === targetDid)) {
          space.listeners.push({
            did: targetDid,
            name: speaker.name,
            avatar: speaker.avatar || '🎧',
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, space, granted: grant }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Speak grant failed' }));
    }
    return true;
  }

  // 6. POST /api/spaces/reaction
  if (url.pathname === '/api/spaces/reaction' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const space = activeSpaces.get(parsed.spaceId);
      if (!space || space.status !== 'live') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Space not found or ended' }));
        return true;
      }

      const reaction: SovraSpaceReaction = {
        emoji: parsed.emoji || '🔥',
        fromDid: parsed.did || resolvePrincipal?.(req)?.did || 'did:sovra:anonymous',
        timestamp: Date.now(),
      };

      space.reactions.push(reaction);
      if (space.reactions.length > 50) space.reactions.shift();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reaction }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Reaction failed' }));
    }
    return true;
  }

  // 7. POST /api/spaces/end
  if (url.pathname === '/api/spaces/end' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const space = activeSpaces.get(parsed.spaceId);
      if (!space) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Space not found' }));
        return true;
      }

      space.status = 'ended';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, spaceId: space.spaceId, status: 'ended' }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to end space' }));
    }
    return true;
  }

  return false;
}
