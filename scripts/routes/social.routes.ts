/**
 * @file scripts/routes/social.routes.ts
 * Sovereign Social Graph, Channels, Pages, Groups, and Friends Route Controller.
 *
 * Implements type-safe follow/unfollow, blocking, muting, bilateral friend handshakes,
 * YouTube-style channels, Facebook/LinkedIn-style pages, and democratic groups.
 */

import http from 'node:http';
import { sovraDb, toPublicUserDTO, type FriendRelationshipRecord, type UserRecord } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface SocialRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  binding?: any;
  masterKey?: any;
  workstationPrivKey?: any;
  node?: any;
  socialGraph?: any;
  localFeed?: any;
  dynamicSocialStore?: any;
  saveDynamicSocialState?: (state?: any) => void;
  resolvePrincipal: (req: http.IncomingMessage, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  userFollowThrottle?: Map<string, number[]>;
  createSignedFollowEvent?: any;
  createSignedBlockEvent?: any;
  createSignedMuteEvent?: any;
  createSignedReactionEvent?: any;
  broadcastChatEvent?: (recipientDid: string, payload: any, eventType?: string) => void;
}

const defaultUserFollowThrottle = new Map<string, number[]>();

export async function handleSocialRoutes(ctx: SocialRouteContext): Promise<boolean> {
  const {
    req,
    res,
    url,
    binding,
    masterKey,
    workstationPrivKey,
    node,
    socialGraph,
    localFeed,
    dynamicSocialStore,
    saveDynamicSocialState,
    resolvePrincipal,
    enforceAuth,
    readBoundedBody,
    createSignedFollowEvent,
    createSignedBlockEvent,
    createSignedMuteEvent,
    createSignedReactionEvent,
    broadcastChatEvent,
  } = ctx;

  const userFollowThrottle = ctx.userFollowThrottle || defaultUserFollowThrottle;

  // ==========================================
  // 1. SOCIAL GRAPH & FOLLOW / UNFOLLOW
  // ==========================================

  if (url.pathname === '/api/social/graph' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const devicePub = binding?.devicePublicKeyHex || masterKey?.did || '';
    const state = socialGraph?.getState ? socialGraph.getState(devicePub) : { following: [], followers: [], blocks: [], mutes: [] };
    const isOwner = principal && (principal.role === 'SUPER_ADMIN' || principal.did === devicePub);
    const safeState = {
      following: state.following ? Array.from(state.following) : [],
      followers: state.followers ? Array.from(state.followers) : [],
      blocks: isOwner && state.blocks ? Array.from(state.blocks) : [],
      mutes: isOwner && state.mutes ? Array.from(state.mutes) : [],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(safeState));
    return true;
  }

  if (url.pathname === '/api/social/follow' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const now = Date.now();
      const callerActions = (userFollowThrottle.get(principal.did) || []).filter(t => now - t < 60000);
      if (callerActions.length >= 30) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Social graph action rate limit exceeded: maximum 30 follow/unfollow operations per minute' }));
        return true;
      }
      callerActions.push(now);
      userFollowThrottle.set(principal.did, callerActions);

      const target = String(parsed.targetDid || parsed.targetPubkey || '');
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'targetDid or targetPubkey is required' }));
        return true;
      }

      if (target === principal.did) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot follow yourself' }));
        return true;
      }

      const isUnfollow = Boolean(parsed.isUnfollow);
      if (!isUnfollow && sovraDb.isBlocked(principal.did, target)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot follow: user is blocked or has blocked you' }));
        return true;
      }

      let isFollowing = false;
      if (isUnfollow) {
        sovraDb.unfollowUser(principal.did, target);
        isFollowing = false;
      } else {
        sovraDb.followUser(principal.did, target);
        isFollowing = true;
      }

      let eventId: string | undefined;
      try {
        if (createSignedFollowEvent && binding && workstationPrivKey && socialGraph) {
          const ev = createSignedFollowEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            target,
            isUnfollow,
          );
          eventId = ev.id;
          const pRes = await socialGraph.processEvent(ev);
          if (pRes.ok && node?.pubsub) {
            await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          }
        }
      } catch (_) {}

      const stats = sovraDb.getFollowStats(principal.did);
      const targetStats = sovraDb.getFollowStats(target);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        eventId,
        isFollowing,
        followerCount: targetStats.followersCount,
        followingCount: stats.followingCount,
        myFollowStats: stats,
        targetFollowStats: targetStats,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/unfollow' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const target = String(parsed.targetDid || parsed.targetPubkey || '');
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'targetDid or targetPubkey is required' }));
        return true;
      }

      sovraDb.unfollowUser(principal.did, target);

      try {
        if (createSignedFollowEvent && binding && workstationPrivKey && socialGraph) {
          const ev = createSignedFollowEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            target,
            true,
          );
          const pRes = await socialGraph.processEvent(ev);
          if (pRes.ok && node?.pubsub) {
            await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          }
        }
      } catch (_) {}

      const stats = sovraDb.getFollowStats(principal.did);
      const targetStats = sovraDb.getFollowStats(target);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        isFollowing: false,
        followerCount: targetStats.followersCount,
        followingCount: stats.followingCount,
        myFollowStats: stats,
        targetFollowStats: targetStats,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/followers' && req.method === 'GET') {
    const targetDid = url.searchParams.get('did') || resolvePrincipal(req)?.did;
    if (!targetDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'did parameter required' }));
      return true;
    }
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined;
    const principal = resolvePrincipal(req);
    const viewerDid = principal?.did;
    const followers = sovraDb.getFollowers(targetDid, limit, offset)
      .filter(u => !viewerDid || !sovraDb.isBlocked(u.did, viewerDid))
      .map(u => toPublicUserDTO(u));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, followers, count: followers.length }));
    return true;
  }

  if (url.pathname === '/api/social/following' && req.method === 'GET') {
    const targetDid = url.searchParams.get('did') || resolvePrincipal(req)?.did;
    if (!targetDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'did parameter required' }));
      return true;
    }
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined;
    const principal = resolvePrincipal(req);
    const viewerDid = principal?.did;
    const following = sovraDb.getFollowing(targetDid, limit, offset)
      .filter(u => !viewerDid || !sovraDb.isBlocked(u.did, viewerDid))
      .map(u => toPublicUserDTO(u));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, following, count: following.length }));
    return true;
  }

  if (url.pathname === '/api/social/relationship' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const targetDid = url.searchParams.get('targetDid') || url.searchParams.get('did');
    if (!principal || !targetDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Authentication and targetDid required' }));
      return true;
    }
    const isSelf = principal.did === targetDid;
    const isBlocked = sovraDb.hasBlocked(principal.did, targetDid);
    const hasBlockedMe = sovraDb.hasBlocked(targetDid, principal.did);
    const isFollowing = sovraDb.isFollowing(principal.did, targetDid);
    const isFollowedBy = sovraDb.isFollowing(targetDid, principal.did);
    const rels = sovraDb.getFriendRelationships(principal.did);
    const friendRel = rels.find(r => r.fromDid === targetDid || r.toDid === targetDid);
    let friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' | 'blocked' = 'none';
    if (friendRel) {
      if (friendRel.status === 'accepted') {
        friendshipStatus = 'accepted';
      } else if (friendRel.status === 'blocked') {
        friendshipStatus = 'blocked';
      } else if (friendRel.fromDid === principal.did) {
        friendshipStatus = 'pending_sent';
      } else {
        friendshipStatus = 'pending_received';
      }
    }

    const targetUser = sovraDb.findUserByDid(targetDid);
    const canMessage = !isBlocked && !hasBlockedMe && (
      !targetUser?.privacySettings?.canMessageMe ||
      targetUser.privacySettings.canMessageMe === 'public' ||
      (targetUser.privacySettings.canMessageMe === 'friends' && friendshipStatus === 'accepted')
    );
    const canSendFriendRequest = !isSelf && !isBlocked && !hasBlockedMe && friendshipStatus === 'none' && (
      !targetUser?.privacySettings?.canSendFriendRequests ||
      targetUser.privacySettings.canSendFriendRequests === 'public' ||
      (targetUser.privacySettings.canSendFriendRequests === 'friends_of_friends' && sovraDb.getMutualFriends(principal.did, targetDid).length > 0)
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      isSelf,
      isFollowing,
      isFollowedBy,
      areFriends: friendshipStatus === 'accepted',
      friendshipStatus,
      friendRequestId: friendRel?.id,
      isBlocked,
      hasBlockedMe,
      canMessage,
      canSendFriendRequest,
    }));
    return true;
  }

  // ==========================================
  // 2. MODERATION, BLOCKS, MUTES & REACTIONS
  // ==========================================

  if (url.pathname === '/api/social/block' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      let targetDid = String(parsed.targetDid || '');
      if (!targetDid && parsed.targetPubkey) {
        const matchedUser = sovraDb.getAllUsers().find(u => u.publicKey === parsed.targetPubkey);
        targetDid = matchedUser?.did || String(parsed.targetPubkey);
      }
      if (!targetDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'targetDid or targetPubkey required' }));
        return true;
      }

      if (targetDid === principal.did) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot block yourself' }));
        return true;
      }

      const isUnblock = Boolean(parsed.isUnblock);
      if (isUnblock) {
        sovraDb.unblockUser(principal.did, targetDid);
      } else {
        sovraDb.blockUser(principal.did, targetDid, parsed.reason ? String(parsed.reason) : 'Blocked by user');
      }

      let eventId: string | undefined;
      try {
        if (createSignedBlockEvent && binding && workstationPrivKey && socialGraph) {
          const targetKey = parsed.targetPubkey || targetDid;
          const ev = createSignedBlockEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            targetKey,
            isUnblock,
            parsed.reason ? String(parsed.reason) : 'Blocked by user',
          );
          eventId = ev.id;
          const pRes = await socialGraph.processEvent(ev);
          if (pRes.ok && node?.pubsub) {
            await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          }
        }
      } catch (_) {}

      const isNowBlocked = sovraDb.hasBlocked(principal.did, targetDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, eventId, isBlocked: isNowBlocked }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/unblock' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      let targetDid = String(parsed.targetDid || '');
      if (!targetDid && parsed.targetPubkey) {
        const matchedUser = sovraDb.getAllUsers().find(u => u.publicKey === parsed.targetPubkey);
        targetDid = matchedUser?.did || String(parsed.targetPubkey);
      }
      if (!targetDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'targetDid or targetPubkey required' }));
        return true;
      }

      sovraDb.unblockUser(principal.did, targetDid);

      try {
        if (createSignedBlockEvent && binding && workstationPrivKey && socialGraph) {
          const targetKey = parsed.targetPubkey || targetDid;
          const ev = createSignedBlockEvent(
            binding.devicePublicKeyHex,
            workstationPrivKey,
            targetKey,
            true,
            'Unblocked by user',
          );
          const pRes = await socialGraph.processEvent(ev);
          if (pRes.ok && node?.pubsub) {
            await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
          }
        }
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, isBlocked: false }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/blocked' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Authentication required' }));
      return true;
    }
    const blocked = sovraDb.getBlockedUsers(principal.did).map(toPublicUserDTO);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, blocked, count: blocked.length }));
    return true;
  }

  if (url.pathname === '/api/social/mute' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const target = String(parsed.targetPubkey || parsed.targetDid);
      if (createSignedMuteEvent && binding && workstationPrivKey && socialGraph) {
        const ev = createSignedMuteEvent(
          binding.devicePublicKeyHex,
          workstationPrivKey,
          target,
          Boolean(parsed.isUnmute),
          parsed.durationSeconds ? Number(parsed.durationSeconds) : 3600,
        );
        const pRes = await socialGraph.processEvent(ev);
        if (!pRes.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
          return true;
        }
        if (node?.pubsub) {
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, eventId: ev.id, isMuted: socialGraph.isMuted(binding.devicePublicKeyHex, target) }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, isMuted: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/react' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      if (createSignedReactionEvent && binding && workstationPrivKey && socialGraph) {
        const ev = createSignedReactionEvent(
          binding.devicePublicKeyHex,
          workstationPrivKey,
          String(parsed.targetEventId),
          String(parsed.emoji ?? '❤️'),
          Boolean(parsed.isRetraction),
        );
        const pRes = await socialGraph.processEvent(ev);
        if (!pRes.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: pRes.error.message }));
          return true;
        }
        if (node?.pubsub) {
          await node.pubsub.publish('sovra/social/graph/v1', new TextEncoder().encode(JSON.stringify(ev)));
        }
        const reactions = socialGraph.getReactions(parsed.targetEventId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, eventId: ev.id, reactionsCount: reactions.length }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return true;
  }

  if (url.pathname === '/api/social/feed' && req.method === 'GET') {
    const feedItems = localFeed?.getChronologicalFeed ? localFeed.getChronologicalFeed(masterKey?.did, 50) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, posts: feedItems }));
    return true;
  }

  // ==========================================
  // 3. CHANNELS & PAGES
  // ==========================================

  if (url.pathname === '/api/social/channels' && req.method === 'GET') {
    const channels = dynamicSocialStore?.channels || sovraDb.getAllChannels();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channels }));
    return true;
  }

  if (url.pathname === '/api/social/channels/check-handle' && req.method === 'GET') {
    const rawHandle = url.searchParams.get('handle') || '';
    const rawNorm = rawHandle.toLowerCase().replace(/^@+/, '').trim();
    const cleanHandle = '@' + rawNorm;
    if (!rawNorm) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, available: false, handle: cleanHandle, error: 'Handle cannot be empty' }));
      return true;
    }
    const matchHandle = (h: any) => {
      if (!h) return false;
      return String(h).toLowerCase().replace(/^@+/, '').trim() === rawNorm;
    };
    const channelsList = dynamicSocialStore?.channels || sovraDb.getAllChannels();
    const inSocial = channelsList.some((c: any) => matchHandle(c.handle));
    const inDb = ((sovraDb.db?.channels || []).some((c: any) => matchHandle(c.handle)));
    const inVideos = ((sovraDb.db?.videos || []).some((v: any) => matchHandle(v.channelHandle)));
    const isProtocolReserved = ['sovralab', 'sovra', 'admin', 'system', 'official'].includes(rawNorm);
    const exists = inSocial || inDb || inVideos || isProtocolReserved;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, available: !exists, handle: cleanHandle }));
    return true;
  }

  if (url.pathname === '/api/social/channels/get' && req.method === 'GET') {
    const channelId = url.searchParams.get('id') || '';
    const handle = (url.searchParams.get('handle') || '').toLowerCase().replace(/^@/, '');
    const principal = resolvePrincipal(req);
    const userDid = principal?.did || '';

    const channelsList = dynamicSocialStore?.channels || sovraDb.getAllChannels();
    let ch = channelsList.find((c: any) =>
      (channelId && c.id === channelId) ||
      (handle && (c.handle || '').toLowerCase().replace(/^@/, '') === handle)
    );

    if (!ch) {
      const allVideos = sovraDb.getAllVideos();
      const matchingVideo = allVideos.find((v: any) =>
        (handle && (v.channelHandle || '').toLowerCase().replace(/^@/, '') === handle) ||
        (channelId && (v.channelId === channelId || v.authorDid === channelId))
      );
      if (matchingVideo) {
        ch = {
          id: matchingVideo.channelId || `chan_${matchingVideo.channelHandle?.replace(/^@/, '') || 'creator'}`,
          name: matchingVideo.channelName || matchingVideo.channelHandle || 'Sovereign Channel',
          handle: matchingVideo.channelHandle || `@${handle || 'creator'}`,
          desc: 'Verified Sovereign Broadcast Studio & Video Node',
          avatar: matchingVideo.channelAvatar || '📺',
          bg: '#6366f1',
          bannerUrl: '',
          subscribers: 1200,
          subscriberCount: 1200,
          videosCount: allVideos.filter((v: any) => v.channelHandle === matchingVideo.channelHandle).length,
          verified: true,
          ownerDid: matchingVideo.authorDid || matchingVideo.channelId || userDid,
        };
      }
    }

    if (!ch) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Channel not found' }));
      return true;
    }

    const channelVideos = sovraDb.getAllVideos().filter((v: any) =>
      v.channelId === ch.id || (v.channelHandle && v.channelHandle.toLowerCase() === (ch.handle || '').toLowerCase())
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      channel: ch,
      videos: channelVideos,
      isSubscribed: false,
    }));
    return true;
  }

  if ((url.pathname === '/api/social/channels' || url.pathname === '/api/channel/create') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const rawHandle = parsed.handle || (parsed.name ? 'ch_' + parsed.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'ch_' + Date.now());
      const cleanHandle = String(rawHandle).trim().replace(/^@+/, '');
      if (!cleanHandle || cleanHandle.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Valid channel handle required (min 2 characters)' }));
        return true;
      }
      const handle = '@' + cleanHandle.toLowerCase();
      const reqName = String(parsed.name || '').trim();
      if (!reqName || reqName.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Valid channel name required (min 2 characters)' }));
        return true;
      }

      const channelsList = dynamicSocialStore?.channels || sovraDb.getAllChannels();
      const existing = channelsList.find((c: any) => c.handle && c.handle.toLowerCase() === handle);
      if (existing) {
        if (existing.ownerDid && existing.ownerDid !== principal.did) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'A channel with this handle already exists' }));
          return true;
        }
        existing.name = reqName;
        existing.desc = String(parsed.desc || existing.desc);
        if (parsed.channelType) existing.channelType = String(parsed.channelType);
        if (parsed.bannerUrl || parsed.banner) existing.bannerUrl = String(parsed.bannerUrl || parsed.banner);
        if (parsed.category) existing.category = String(parsed.category);
        if (parsed.avatar) existing.avatar = String(parsed.avatar);
        if (parsed.bg || parsed.avatarBg) existing.bg = String(parsed.bg || parsed.avatarBg);
        if (parsed.verified !== undefined) existing.verified = Boolean(parsed.verified);
        if (!existing.ownerDid) existing.ownerDid = principal.did;
        if (saveDynamicSocialState && dynamicSocialStore) saveDynamicSocialState(dynamicSocialStore);
        sovraDb.upsertChannel(existing);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channel: existing, message: 'Channel updated successfully' }));
        return true;
      }

      const newChan = {
        id: 'chan_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: reqName,
        handle,
        desc: String(parsed.desc || `Official channel for ${reqName}`),
        avatar: String(parsed.avatar || '📺'),
        bg: String(parsed.bg || '#6366f1'),
        subscribers: 1,
        subscriberCount: 1,
        verified: true,
        channelType: String(parsed.channelType || 'PUBLIC_BROADCAST'),
        ownerDid: principal.did,
        bannerUrl: String(parsed.bannerUrl || parsed.banner || ''),
        category: String(parsed.category || 'Tech'),
        createdAt: new Date().toISOString(),
      };
      if (dynamicSocialStore) {
        dynamicSocialStore.channels.unshift(newChan);
        if (saveDynamicSocialState) saveDynamicSocialState(dynamicSocialStore);
      }
      sovraDb.upsertChannel(newChan);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channel: newChan, message: 'Channel created successfully' }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/channels/subscribe' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const channelsList = dynamicSocialStore?.channels || sovraDb.getAllChannels();
      const ch = channelsList.find((c: any) => c.id === parsed.channelId);
      if (ch) {
        const isSubscribed = Boolean(parsed.isSubscribed);
        ch.subscribers = Math.max(0, (ch.subscribers || 0) + (isSubscribed ? 1 : -1));
        ch.subscriberCount = ch.subscribers;
        if (saveDynamicSocialState && dynamicSocialStore) saveDynamicSocialState(dynamicSocialStore);
        sovraDb.upsertChannel(ch);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, subscribers: ch.subscribers, isSubscribed }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Channel not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/channels/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const channelId = String(parsed.channelId || parsed.id || '');
      const delRes = sovraDb.deleteChannel(channelId, principal.did);
      if (!delRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error || 'Failed to delete channel' }));
        return true;
      }
      if (dynamicSocialStore) {
        dynamicSocialStore.channels = sovraDb.getAllChannels();
        if (saveDynamicSocialState) saveDynamicSocialState(dynamicSocialStore);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, channelId }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/pages' && req.method === 'GET') {
    const pages = dynamicSocialStore?.pages || sovraDb.getAllPages();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pages }));
    return true;
  }

  if (url.pathname === '/api/social/pages' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const reqName = String(parsed.name || '').trim();
      if (!reqName || reqName.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Valid page name required (min 2 characters)' }));
        return true;
      }
      const rawHandle = parsed.handle || 'pg_' + reqName.replace(/[^a-zA-Z0-9_]/g, '_');
      const handle = '@' + String(rawHandle).trim().replace(/^@+/, '').toLowerCase();

      const newPage = {
        id: 'pg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: reqName,
        handle,
        category: String(parsed.category || 'Technology'),
        desc: String(parsed.desc || `Official page for ${reqName}`),
        avatar: String(parsed.avatar || '🏢'),
        bg: String(parsed.bg || '#10b981'),
        followers: 1,
        verified: Boolean(parsed.verified ?? true),
        ownerDid: principal.did,
        bannerUrl: String(parsed.bannerUrl || parsed.banner || ''),
        createdAt: new Date().toISOString(),
      };
      if (dynamicSocialStore) {
        dynamicSocialStore.pages.unshift(newPage);
        if (saveDynamicSocialState) saveDynamicSocialState(dynamicSocialStore);
      }
      sovraDb.upsertPage(newPage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, page: newPage, message: 'Page created successfully' }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/pages/follow' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const pagesList = dynamicSocialStore?.pages || sovraDb.getAllPages();
      const pg = pagesList.find((p: any) => p.id === parsed.pageId);
      if (pg) {
        const isFollow = Boolean(parsed.isFollow);
        pg.followers = Math.max(0, (pg.followers || 0) + (isFollow ? 1 : -1));
        if (saveDynamicSocialState && dynamicSocialStore) saveDynamicSocialState(dynamicSocialStore);
        sovraDb.upsertPage(pg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, followers: pg.followers, isFollow }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Page not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/pages/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const pageId = String(parsed.pageId || parsed.id || '');
      const delRes = sovraDb.deletePage(pageId, principal.did);
      if (!delRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error || 'Failed to delete page' }));
        return true;
      }
      if (dynamicSocialStore) {
        dynamicSocialStore.pages = sovraDb.getAllPages();
        if (saveDynamicSocialState) saveDynamicSocialState(dynamicSocialStore);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pageId }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // ==========================================
  // 4. GROUPS
  // ==========================================

  if (url.pathname === '/api/social/groups' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, groups: sovraDb.getAllGroups() }));
    return true;
  }

  if ((url.pathname === '/api/social/groups' || url.pathname === '/api/group/create') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const name = String(parsed.name || '').trim();
      if (!name || name.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Group name must be at least 2 characters' }));
        return true;
      }

      const createRes = sovraDb.createGroup(parsed, principal.did);
      if (!createRes.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: createRes.error }));
        return true;
      }

      if (dynamicSocialStore) dynamicSocialStore.groups = sovraDb.getAllGroups();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, group: createRes.group, id: createRes.group?.id }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || parsed.id || '');
      if (!groupId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Group ID required' }));
        return true;
      }
      const delRes = sovraDb.deleteGroup(groupId, principal.did);
      if (!delRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error || 'Failed to delete group' }));
        return true;
      }
      if (dynamicSocialStore) dynamicSocialStore.groups = sovraDb.getAllGroups();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, groupId }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/join' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || '');
      const grp = sovraDb.getGroupById(groupId);
      if (!grp) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Group not found' }));
        return true;
      }

      if (grp.privacy === 'private' && grp.membershipApprovalRequired) {
        const reqRes = sovraDb.requestJoinSpace(grp.id, 'group', principal.did, principal.handle, principal.name || 'Peer');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'requested', request: reqRes.request }));
        return true;
      }

      const addRes = sovraDb.addSpaceMember({
        spaceId: grp.id,
        spaceType: 'group',
        userDid: principal.did,
        handle: principal.handle,
        name: principal.name || 'Member',
        role: 'MEMBER',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'joined', member: addRes.member }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/leave' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || '');
      const grp = sovraDb.getGroupById(groupId);
      if (!grp) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Group not found' }));
        return true;
      }
      sovraDb.leaveGroup(groupId, principal.did);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'left' }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/members' && req.method === 'GET') {
    const groupId = url.searchParams.get('groupId') || '';
    const members = sovraDb.getSpaceMembers(groupId, 'group');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, members }));
    return true;
  }

  if (url.pathname === '/api/social/groups/rules' && req.method === 'GET') {
    const groupId = url.searchParams.get('groupId') || '';
    const rules = sovraDb.getSpaceRules(groupId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rules }));
    return true;
  }

  if (url.pathname === '/api/social/groups/rules' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || '');
      const ruleRes = sovraDb.createSpaceRule(groupId, parsed.title, parsed.description, principal.did);
      if (!ruleRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: ruleRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rule: ruleRes.rule }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/rules/delete' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || '');
      const ruleId = String(parsed.ruleId || '');
      const delRes = sovraDb.deleteSpaceRule(groupId, ruleId, principal.did);
      if (!delRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ruleId }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/social/groups/settings' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const groupId = String(parsed.groupId || '');
      const upRes = sovraDb.updateGroup(groupId, parsed, principal.did);
      if (!upRes.ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: upRes.error }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, group: upRes.group }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // ==========================================
  // 5. FRIENDS (BILATERAL HANDSHAKES)
  // ==========================================

  if (url.pathname === '/api/friends/request' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const fromDid = principal.did;
      const toDid = String(parsed.toDid || parsed.targetDid || '');
      if (!toDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'toDid or targetDid is required' }));
        return true;
      }
      if (fromDid === toDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot send friend request to yourself' }));
        return true;
      }
      if (sovraDb.isBlocked(fromDid, toDid)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot send friend request: user is blocked or has blocked you' }));
        return true;
      }

      const targetUser = sovraDb.findUserByDid(toDid);
      if (targetUser?.privacySettings) {
        const perm = targetUser.privacySettings.canSendFriendRequests;
        if (perm === 'none') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'User does not accept friend requests' }));
          return true;
        }
        if (perm === 'friends_of_friends') {
          const mutuals = sovraDb.getMutualFriends(fromDid, toDid);
          if (mutuals.length === 0) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'User only accepts friend requests from friends of friends' }));
            return true;
          }
        }
      }

      const rel = sovraDb.sendFriendRequest(fromDid, toDid);
      const senderUser = sovraDb.findUserByDid(fromDid);

      sovraDb.addNotification({
        recipientDid: toDid,
        senderDid: fromDid,
        type: 'friend_request',
        title: 'New Friend Request',
        body: `${senderUser?.displayName || senderUser?.handle || 'A peer'} sent you a friend request`,
        link: '/app',
        data: { relId: rel.id, fromDid },
      });

      if (broadcastChatEvent) {
        broadcastChatEvent(toDid, { type: 'friend_request', rel, fromDid }, 'notification');
      }

      try {
        if (node?.pubsub) {
          await node.pubsub.publish('sovra/social/friends', new TextEncoder().encode(JSON.stringify({ type: 'friend_request', rel })));
        }
      } catch {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, relationship: rel }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/friends/respond' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      let rel: FriendRelationshipRecord | null = null;
      const status = parsed.status === 'accept' ? 'accepted' : (parsed.status === 'reject' ? 'rejected' : parsed.status);

      if (parsed.requestId) {
        rel = sovraDb.respondFriendRequestById(String(parsed.requestId), status, principal.did);
      } else if (parsed.fromDid) {
        rel = sovraDb.respondFriendRequest(String(parsed.fromDid), principal.did, status);
      }

      if (!rel) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Request not found or not addressed to you' }));
        return true;
      }

      const targetDid = rel.fromDid === principal.did ? rel.toDid : rel.fromDid;
      if (status === 'accepted') {
        const senderUser = sovraDb.findUserByDid(principal.did);
        sovraDb.addNotification({
          recipientDid: targetDid,
          senderDid: principal.did,
          type: 'friend_accept',
          title: 'Friend Request Accepted',
          body: `${senderUser?.displayName || senderUser?.handle || 'A peer'} accepted your friend request`,
          link: '/app',
          data: { friendDid: principal.did },
        });
      }

      try {
        const myNotifs = sovraDb.getNotifications(principal.did)?.notifications || [];
        const reqNotif = myNotifs.find(n => n.type === 'friend_request' && (!n.isRead && !(n as any).read) &&
          ((n.data && n.data.relId === rel?.id) || (n.data && n.data.fromDid === targetDid) || n.senderDid === targetDid));
        if (reqNotif) {
          sovraDb.markNotificationRead(reqNotif.id, principal.did);
        }
      } catch {}

      if (broadcastChatEvent) {
        broadcastChatEvent(targetDid, { type: status === 'accepted' ? 'friend_accept' : 'friend_respond', rel, fromDid: principal.did }, 'notification');
      }

      try {
        if (node?.pubsub) {
          await node.pubsub.publish('sovra/social/friends', new TextEncoder().encode(JSON.stringify({ type: 'friend_respond', rel })));
        }
      } catch {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, relationship: rel }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/friends/remove' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      if (parsed.targetDid) {
        sovraDb.removeFriendship(principal.did, String(parsed.targetDid));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'targetDid required' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/friends/list' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    let userDid = principal?.did;
    if (!userDid) {
      const queryDid = url.searchParams.get('userDid') || '';
      const localHostUser = sovraDb.findUserByDid(masterKey?.did);
      if (queryDid && sovraDb.findUserByDid(queryDid)) {
        userDid = queryDid;
      } else if (localHostUser?.did) {
        userDid = localHostUser.did;
      } else if (masterKey?.did) {
        userDid = masterKey.did;
      }
    }
    if (!userDid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required to view friends list' }));
      return true;
    }
    const allRels = sovraDb.getFriendRelationships(userDid);
    const allUsers = sovraDb.getAllUsers();
    const allPeers = sovraDb.getAllPeers(userDid);

    const userMap = new Map<string, UserRecord>();
    for (const u of allUsers) {
      userMap.set(u.did, u);
    }

    const incoming = allRels
      .filter(r => r.toDid === userDid && r.status === 'pending')
      .map(r => {
        const fromUser = userMap.get(r.fromDid);
        const peer = allPeers.find(p => p.did === r.fromDid);
        return {
          id: r.id,
          fromDid: r.fromDid,
          toDid: r.toDid,
          createdAt: r.createdAt,
          user: {
            did: r.fromDid,
            name: fromUser ? fromUser.displayName : (peer ? peer.name : 'Sovereign Peer'),
            handle: fromUser ? fromUser.handle : (peer ? peer.handle : '@peer'),
            avatar: fromUser ? fromUser.avatar : (peer ? peer.avatar : 'P'),
            avatarDataUrl: fromUser?.avatarDataUrl || peer?.avatarDataUrl,
            avatarBg: fromUser ? fromUser.avatarBg : (peer ? peer.avatarBg : '#6366f1'),
            device: fromUser ? fromUser.deviceType : (peer ? (peer as any).device : 'Mesh Device'),
          },
        };
      });

    const outgoing = allRels
      .filter(r => r.fromDid === userDid && r.status === 'pending')
      .map(r => {
        const toUser = userMap.get(r.toDid);
        const peer = allPeers.find(p => p.did === r.toDid);
        return {
          id: r.id,
          fromDid: r.fromDid,
          toDid: r.toDid,
          createdAt: r.createdAt,
          user: {
            did: r.toDid,
            name: toUser ? toUser.displayName : (peer ? peer.name : 'Sovereign Peer'),
            handle: toUser ? toUser.handle : (peer ? peer.handle : '@peer'),
            avatar: toUser ? toUser.avatar : (peer ? peer.avatar : 'P'),
            avatarDataUrl: toUser?.avatarDataUrl || peer?.avatarDataUrl,
            avatarBg: toUser ? toUser.avatarBg : (peer ? peer.avatarBg : '#6366f1'),
            device: toUser ? toUser.deviceType : (peer ? (peer as any).device : 'Mesh Device'),
          },
        };
      });

    const friends = allRels
      .filter(r => r.status === 'accepted')
      .map(r => {
        const otherDid = r.fromDid === userDid ? r.toDid : r.fromDid;
        const otherUser = userMap.get(otherDid);
        const peer = allPeers.find(p => p.did === otherDid);
        return {
          id: r.id,
          did: otherDid,
          name: otherUser ? otherUser.displayName : (peer ? peer.name : 'Sovereign Friend'),
          handle: otherUser ? otherUser.handle : (peer ? peer.handle : '@friend'),
          avatar: otherUser ? otherUser.avatar : (peer ? peer.avatar : 'F'),
          avatarDataUrl: otherUser?.avatarDataUrl || peer?.avatarDataUrl,
          avatarBg: otherUser ? otherUser.avatarBg : (peer ? peer.avatarBg : '#10b981'),
          device: otherUser ? otherUser.deviceType : (peer ? (peer as any).device : 'Mesh Peer'),
          isOnline: peer ? peer.isOnline : true,
          lastSeen: peer ? peer.lastSeen : 'Online',
        };
      });

    const combinedSuggestionsMap = new Map<string, any>();
    for (const p of allPeers) {
      if (p.did !== userDid) combinedSuggestionsMap.set(p.did, p);
    }
    for (const u of allUsers) {
      if (u.did !== userDid && !combinedSuggestionsMap.has(u.did)) {
        combinedSuggestionsMap.set(u.did, {
          did: u.did,
          name: u.displayName || (u as any).name,
          handle: u.handle,
          avatar: u.avatar || 'P',
          avatarDataUrl: u.avatarDataUrl,
          avatarBg: u.avatarBg || '#6366f1',
          role: `${u.deviceType || 'Mesh'} Peer`,
          device: u.deviceType || 'Desktop',
          isOnline: true,
          lastSeen: 'Online',
        });
      }
    }
    const suggestions = Array.from(combinedSuggestionsMap.values()).map(p => {
      let status: 'none' | 'pending_sent' | 'pending_received' | 'friends' = 'none';
      let reqId: string | undefined;

      const rel = allRels.find(
        r => (r.fromDid === userDid && r.toDid === p.did) || (r.fromDid === p.did && r.toDid === userDid)
      );

      if (rel) {
        reqId = rel.id;
        if (rel.status === 'accepted') {
          status = 'friends';
        } else if (rel.status === 'pending') {
          status = rel.fromDid === userDid ? 'pending_sent' : 'pending_received';
        }
      }

      return {
        ...p,
        relationshipStatus: status,
        requestId: reqId,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      incoming,
      outgoing,
      friends,
      suggestions,
      counts: {
        pendingIncoming: incoming.length,
        friends: friends.length,
      },
    }));
    return true;
  }

  if (url.pathname === '/api/friends/mutual' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const userDid = principal ? principal.did : '';
    const targetDidParam = url.searchParams.get('targetDid') || '';
    const targetHandleParam = url.searchParams.get('targetHandle') || '';

    let targetDid = targetDidParam;
    if (!targetDid && targetHandleParam) {
      const cleanHandle = targetHandleParam.startsWith('@') ? targetHandleParam : '@' + targetHandleParam;
      const targetUser = sovraDb.findUserByHandle(cleanHandle);
      if (targetUser) targetDid = targetUser.did;
    }

    if (!userDid || !targetDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'userDid and targetDid required' }));
      return true;
    }

    const mutuals = sovraDb.getMutualFriends(userDid, targetDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mutuals, count: mutuals.length }));
    return true;
  }

  return false;
}
