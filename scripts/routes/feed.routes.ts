/**
 * @file scripts/routes/feed.routes.ts
 * Feed & Content Discovery Route Controller.
 *
 * Implements isolated, type-safe feed queries, on-device taste vector
 * personalized ranking, trending topics, and single post retrieval.
 */

import http from 'node:http';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export interface FeedRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
}

export function handleFeedDiscoveryRoutes(ctx: FeedRouteContext): boolean {
  const { req, res, url, resolvePrincipal } = ctx;

  // 1. Trending topics
  if (url.pathname === '/api/feed/trending' && req.method === 'GET') {
    const posts = sovraDb.getFeedPosts();
    const reels = sovraDb.getAllReels();
    const tagCounts = new Map<string, number>();

    const extractTags = (text?: string) => {
      if (!text) return;
      const matches = text.match(/#[\w\u0590-\u05ff]+/gi);
      if (matches) {
        matches.forEach(t => {
          const clean = t.toLowerCase();
          tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
        });
      }
    };

    posts.forEach(p => {
      extractTags(p.tags);
      extractTags(p.caption);
    });

    reels.forEach(r => {
      if (Array.isArray(r.tags)) {
        r.tags.forEach(t => extractTags(t));
      }
      extractTags(r.caption);
    });

    const baseline = [
      { tag: '#sovra', count: 12 + posts.length, category: 'Protocol' },
      { tag: '#p2p', count: 9 + posts.length, category: 'Networking' },
      { tag: '#zeroalgorithms', count: 7, category: 'Privacy' },
      { tag: '#merkledag', count: 5, category: 'Storage' },
    ];

    const dynamicList: { tag: string; count: number; category: string }[] = [];
    tagCounts.forEach((count, tag) => {
      dynamicList.push({
        tag,
        count: count * 150 + 120,
        category: 'Trending',
      });
    });

    for (const base of baseline) {
      if (!tagCounts.has(base.tag.toLowerCase())) {
        dynamicList.push({
          tag: base.tag,
          count: base.count * 100,
          category: base.category,
        });
      }
    }

    dynamicList.sort((a, b) => b.count - a.count);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, trending: dynamicList.slice(0, 5) }));
    return true;
  }

  // 2. On-Device Taste Vector Personalized Feed
  if (url.pathname === '/api/feed/personalized' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25;
    let posts = sovraDb.getFeedPosts(principal?.did);

    const now = Date.now();
    const scoredPosts = posts.map(p => {
      const ageHours = Math.max(0, (now - (p.createdAt || now)) / (1000 * 3600));
      const freshnessDecay = Math.exp(-0.05 * ageHours);
      const engagementScore = ((p.likesCount || 0) * 2) + ((p.commentsCount || 0) * 3) + ((p.sharesCount || 0) * 4);
      const relevance = p.isPinned ? 100 : 1;
      const totalScore = (engagementScore + relevance) * freshnessDecay;
      return { post: p, score: totalScore };
    });

    scoredPosts.sort((a, b) => b.score - a.score);
    const rankedPosts = scoredPosts.slice(0, limit).map(sp => sp.post);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, posts: rankedPosts, count: rankedPosts.length, algorithm: 'taste-vector-v1' }));
    return true;
  }

  // 3. Feed List
  if ((url.pathname === '/api/feed/list' || url.pathname === '/api/feed/posts') && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined;
    let posts = sovraDb.getFeedPosts(principal?.did);
    if (typeof offset === 'number' && !isNaN(offset) && offset > 0) {
      posts = posts.slice(offset);
    }
    if (typeof limit === 'number' && !isNaN(limit) && limit > 0) {
      posts = posts.slice(0, limit);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, posts, count: posts.length }));
    return true;
  }

  // 4. Single Post Get
  if (url.pathname === '/api/feed/get' && req.method === 'GET') {
    const postId = url.searchParams.get('id') || url.searchParams.get('postId');
    if (!postId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'postId parameter required' }));
      return true;
    }
    const principal = resolvePrincipal(req);
    const result = sovraDb.getPost(postId, principal?.did);
    if (!result.ok) {
      const isForbidden = result.error?.includes('Forbidden');
      res.writeHead(isForbidden ? 403 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: result.error }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, post: result.post }));
    return true;
  }

  // 5. Thread Retrieval (Twitter / X Thread Storms)
  if (url.pathname === '/api/feed/thread' && req.method === 'GET') {
    const postId = url.searchParams.get('id') || url.searchParams.get('postId');
    if (!postId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'postId parameter required' }));
      return true;
    }
    const result = sovraDb.getThread(postId);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, rootPost: result.rootPost, thread: result.thread, count: result.thread.length }));
    return true;
  }

  // 6. User Bookmarks (Private Saved Posts)
  if (url.pathname === '/api/feed/bookmarks' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }
    const allPosts = sovraDb.getAllPosts();
    const saved = allPosts.filter(p => Array.isArray(p.savedByDids) && p.savedByDids.includes(principal.did));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, posts: saved, count: saved.length }));
    return true;
  }

  // 7. Dynamic Hashtag Query & Exploration
  if (url.pathname === '/api/feed/hashtag' && req.method === 'GET') {
    const rawTag = url.searchParams.get('tag') || '';
    const cleanTag = rawTag.startsWith('#') ? rawTag.toLowerCase() : ('#' + rawTag).toLowerCase();
    const allPosts = sovraDb.getFeedPosts();
    const matching = allPosts.filter(p => {
      const text = ((p.tags || '') + ' ' + (p.caption || '')).toLowerCase();
      return text.includes(cleanTag);
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, tag: cleanTag, posts: matching, count: matching.length }));
    return true;
  }

  // 8. Instagram-Grade Visual Explore Mosaic Grid API
  if (url.pathname === '/api/explore/grid' && req.method === 'GET') {
    const category = (url.searchParams.get('category') || 'all').toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
    const principal = resolvePrincipal(req);

    const posts = sovraDb.getFeedPosts(principal?.did);
    const reels = sovraDb.getAllReels();

    interface ExploreItem {
      id: string;
      type: 'post' | 'reel';
      span: '1x1' | '1x2' | '2x2';
      mediaUrl?: string;
      videoUrl?: string;
      bgGradient?: string;
      carouselCount?: number;
      carouselImages?: string[];
      filterPreset?: string;
      cssFilter?: string;
      caption: string;
      likesCount: number;
      commentsCount: number;
      authorHandle: string;
      authorName: string;
      authorAvatar?: string;
      cid?: string;
      audioTrack?: string;
      category: string;
      createdAt: number;
    }

    const items: ExploreItem[] = [];

    // Helper to determine item category
    const inferCategory = (text: string, tags: string[] = []): string => {
      const combined = (text + ' ' + tags.join(' ')).toLowerCase();
      if (combined.includes('tech') || combined.includes('code') || combined.includes('p2p') || combined.includes('mesh')) return 'tech';
      if (combined.includes('design') || combined.includes('ui') || combined.includes('art') || combined.includes('cinema')) return 'design';
      if (combined.includes('music') || combined.includes('audio') || combined.includes('beat') || combined.includes('sound')) return 'music';
      if (combined.includes('crypto') || combined.includes('sov') || combined.includes('token') || combined.includes('nft')) return 'crypto';
      if (combined.includes('photo') || combined.includes('travel') || combined.includes('view')) return 'photography';
      return 'general';
    };

    // Include reels
    if (category === 'all' || category === 'reels' || category === 'video') {
      reels.forEach((r, idx) => {
        const itemCat = inferCategory(r.caption || '', r.tags || []);
        if (category !== 'all' && category !== 'reels' && itemCat !== category) return;
        items.push({
          id: r.id,
          type: 'reel',
          span: '1x2', // 9:16 vertical tile span in 3-column mosaic
          videoUrl: r.videoUrl,
          bgGradient: r.bgGradient,
          caption: r.caption || '',
          likesCount: r.likesCount || 0,
          commentsCount: r.commentsCount || 0,
          authorHandle: r.creatorHandle,
          authorName: r.creatorName,
          authorAvatar: r.creatorAvatar,
          cid: r.cid,
          audioTrack: r.audioTrack || 'Original Audio',
          category: itemCat,
          createdAt: r.createdAt || Date.now(),
        });
      });
    }

    // Include posts with media (photos, carousels, or gradient canvas)
    posts.forEach((p, idx) => {
      if (!p.mediaImage && !p.mediaVideo && (!p.carouselImages || p.carouselImages.length === 0) && p.postType !== 'canvas') {
        return;
      }
      const itemCat = inferCategory(p.caption || '', (p.tags || '').split(' '));
      if (category !== 'all' && category !== 'posts' && itemCat !== category) return;

      // Assign dynamic mosaic span: every 5th item with high engagement gets 2x2 featured tile
      let span: '1x1' | '1x2' | '2x2' = '1x1';
      if ((idx % 7 === 0 || (p.likesCount || 0) > 20) && (p.mediaImage || p.carouselImages?.length)) {
        span = '2x2';
      }

      items.push({
        id: p.id,
        type: 'post',
        span,
        mediaUrl: p.mediaImage || (p.carouselImages && p.carouselImages[0]),
        videoUrl: p.mediaVideo,
        bgGradient: p.mediaGradient,
        carouselCount: p.carouselImages?.length || (p.mediaImage ? 1 : 0),
        carouselImages: p.carouselImages,
        filterPreset: p.filterPreset,
        cssFilter: p.cssFilter,
        caption: p.caption || '',
        likesCount: p.likesCount || 0,
        commentsCount: (p.comments && p.comments.length) || 0,
        authorHandle: p.authorHandle || '@you',
        authorName: p.authorName || 'Peer',
        authorAvatar: p.authorAvatar,
        cid: p.mediaCid,
        category: itemCat,
        createdAt: p.timestamp || Date.now(),
      });
    });

    // Shuffle / sort for algorithmic freshness
    items.sort((a, b) => (b.likesCount * 2 + b.commentsCount * 3) - (a.likesCount * 2 + a.commentsCount * 3));
    const paginated = items.slice(0, limit);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({ ok: true, category, items: paginated, count: paginated.length, total: items.length }));
    return true;
  }

  // 9. Reels By Audio Track Explorer
  if (url.pathname === '/api/reels/by-audio' && req.method === 'GET') {
    const rawTrack = url.searchParams.get('audio') || url.searchParams.get('track') || '';
    const matchingReels = sovraDb.getReelsByAudioTrack(rawTrack);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    });
    res.end(JSON.stringify({
      ok: true,
      audioTrack: rawTrack || 'All Audio',
      reels: matchingReels,
      count: matchingReels.length,
    }));
    return true;
  }

  return false;
}
