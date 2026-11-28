/**
 * @file scripts/routes/push.routes.ts
 * Zero-Knowledge & Zero-Cloud Blind Push Gateway Route Controller.
 *
 * Implements:
 * 1. Persistent disk-backed VAPID keys & push registrations (respecting SOVRA_STORAGE_DIR).
 * 2. Configurable UnifiedPush / custom self-hosted HTTP endpoints (zero hardcoded ntfy.sh).
 * 3. Built-in zero-cloud Server-Sent Events (/api/push/stream) blind wakeup channel.
 * 4. Token expiration, /api/push/unregister, HTTP 404/410 dead-token pruning, and bounded retries.
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BlindPushRelayServer } from '../../packages/messaging/dist/index.js';

export interface PushRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  blindPushRelay: BlindPushRelayServer;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
}

const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const PUSH_MAX_RETRIES = 2;
const PUSH_RETRY_BASE_MS = 150;

function resolvePushStorageDir(): string {
  const dir = process.env.SOVRA_STORAGE_DIR
    ? path.resolve(process.env.SOVRA_STORAGE_DIR)
    : path.join(process.cwd(), '.sovra-storage-dev');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateVapidJwt(audience: string, subject: string, privateKeyPem: string): string {
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const defaultSub = process.env.SOVRA_VAPID_SUBJECT || 'mailto:postmaster@localhost';
  const payload = base64url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject || defaultSub,
  })));
  const unsignedToken = `${header}.${payload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(unsignedToken);
  sign.end();
  const signature = sign.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${unsignedToken}.${base64url(signature)}`;
}

let cachedVapidDir: string | null = null;
let activeVapidKeys: { publicKey: string; privateKeyPem: string } | null = null;

export function getOrCreateVapidKeys(): { publicKey: string; privateKeyPem: string } {
  const envPub = process.env.VAPID_PUBLIC_KEY || process.env.SOVRA_VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY || process.env.SOVRA_VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    activeVapidKeys = { publicKey: envPub, privateKeyPem: envPriv };
    return activeVapidKeys;
  }

  const storageDir = resolvePushStorageDir();
  if (activeVapidKeys && cachedVapidDir === storageDir) {
    return activeVapidKeys;
  }

  const keyFile = path.join(storageDir, 'vapid-keys.json');
  if (fs.existsSync(keyFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (parsed?.publicKey && parsed?.privateKeyPem) {
        activeVapidKeys = { publicKey: parsed.publicKey, privateKeyPem: parsed.privateKeyPem };
        cachedVapidDir = storageDir;
        return activeVapidKeys;
      }
    } catch {}
  }

  const ec = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const pubDer = crypto.createPublicKey(ec.publicKey).export({ type: 'spki', format: 'der' });
  const rawPub = pubDer.subarray(pubDer.length - 65);
  activeVapidKeys = {
    publicKey: base64url(rawPub),
    privateKeyPem: ec.privateKey,
  };
  cachedVapidDir = storageDir;
  try {
    fs.writeFileSync(keyFile, JSON.stringify(activeVapidKeys, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {}
  return activeVapidKeys;
}

export interface NativePushEntry {
  userDid: string;
  token?: string;
  endpointUrl?: string;
  provider: 'unifiedpush' | 'sse' | 'ntfy' | 'fcm' | 'apns' | 'webpush';
  platform: 'android' | 'ios' | 'web';
  topic: string;
  blindChannelId?: string;
  updatedAt: number;
  expiresAt: number;
}

interface PersistedPushStore {
  byDid: Record<string, string[]>;
  byChannel: Record<string, string[]>;
  native: Record<string, NativePushEntry>;
}

const pushTokensByDid = new Map<string, Map<string, number>>();
const pushTokensByChannel = new Map<string, Map<string, number>>();
export const nativePushRegistry = new Map<string, NativePushEntry>();
let loadedStoreDir: string | null = null;

function ensureStoreLoaded(): string {
  const dir = resolvePushStorageDir();
  if (loadedStoreDir === dir) return dir;

  pushTokensByDid.clear();
  pushTokensByChannel.clear();
  nativePushRegistry.clear();
  sseReplayBuffer.clear();
  seenWakeupHints.clear();
  sseNextEventId = 1;
  loadedStoreDir = dir;

  const regFile = path.join(dir, 'push-registrations.json');
  if (fs.existsSync(regFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(regFile, 'utf8')) as Partial<PersistedPushStore> & {
        webSubscriptions?: Array<{ did?: string; blindChannelId?: string; endpoint: string; expiresAt: number }>;
      };
      const now = Date.now();
      for (const item of parsed.webSubscriptions ?? []) {
        if (!item?.endpoint || (item.expiresAt && item.expiresAt <= now)) continue;
        if (item.did) {
          let m = pushTokensByDid.get(item.did);
          if (!m) { m = new Map(); pushTokensByDid.set(item.did, m); }
          m.set(item.endpoint, item.expiresAt || now + DEFAULT_TOKEN_TTL_MS);
        }
        if (item.blindChannelId) {
          let m = pushTokensByChannel.get(item.blindChannelId);
          if (!m) { m = new Map(); pushTokensByChannel.set(item.blindChannelId, m); }
          m.set(item.endpoint, item.expiresAt || now + DEFAULT_TOKEN_TTL_MS);
        }
      }
      if (parsed.native) {
        for (const [did, entry] of Object.entries(parsed.native)) {
          if (entry && (!entry.expiresAt || entry.expiresAt > now)) {
            nativePushRegistry.set(did, entry);
          }
        }
      }
    } catch {}
  }

  const sseFile = path.join(dir, 'sse-wakeup-buffer.json');
  if (fs.existsSync(sseFile)) {
    try {
      const sseParsed = JSON.parse(fs.readFileSync(sseFile, 'utf8')) as {
        nextEventId?: number;
        channels?: Record<string, BufferedSseWakeup[]>;
      };
      const now = Date.now();
      let maxSeenId = 0;
      if (sseParsed?.channels && typeof sseParsed.channels === 'object') {
        for (const [ch, list] of Object.entries(sseParsed.channels)) {
          if (!Array.isArray(list)) continue;
          const fresh = list
            .filter(item => item && typeof item.id === 'number' && now - item.createdAt <= SSE_REPLAY_TTL_MS)
            .slice(-MAX_SSE_REPLAY_PER_CHANNEL);
          if (fresh.length > 0) {
            sseReplayBuffer.set(ch, fresh);
            for (const item of fresh) {
              if (item.id > maxSeenId) maxSeenId = item.id;
              if (item.opaqueWakeupHint) {
                seenWakeupHints.set(`${item.blindChannelId}:${item.opaqueWakeupHint}`, item.createdAt);
              }
            }
          }
        }
      }
      const storedNext = Number(sseParsed?.nextEventId) || 1;
      sseNextEventId = Math.max(1, storedNext, maxSeenId + 1);
    } catch {}
  }
  return dir;
}

function persistPushStore(): void {
  const dir = loadedStoreDir || resolvePushStorageDir();
  const regFile = path.join(dir, 'push-registrations.json');
  const now = Date.now();

  const webSubsMap = new Map<string, { did?: string; blindChannelId?: string; endpoint: string; expiresAt: number }>();
  for (const [did, map] of pushTokensByDid.entries()) {
    for (const [endpoint, exp] of map.entries()) {
      if (exp <= now) { map.delete(endpoint); continue; }
      const existing = webSubsMap.get(endpoint) || { endpoint, expiresAt: exp };
      existing.did = did;
      webSubsMap.set(endpoint, existing);
    }
  }
  for (const [ch, map] of pushTokensByChannel.entries()) {
    for (const [endpoint, exp] of map.entries()) {
      if (exp <= now) { map.delete(endpoint); continue; }
      const existing = webSubsMap.get(endpoint) || { endpoint, expiresAt: exp };
      existing.blindChannelId = ch;
      webSubsMap.set(endpoint, existing);
    }
  }

  const nativeObj: Record<string, NativePushEntry> = {};
  for (const [did, entry] of nativePushRegistry.entries()) {
    if (entry.expiresAt > now) {
      nativeObj[did] = entry;
    } else {
      nativePushRegistry.delete(did);
    }
  }

  try {
    fs.writeFileSync(
      regFile,
      JSON.stringify({ webSubscriptions: Array.from(webSubsMap.values()), native: nativeObj }, null, 2),
      'utf8',
    );
  } catch {}
}

export function resetPushStoreCacheForTests(): void {
  loadedStoreDir = null;
  cachedVapidDir = null;
  activeVapidKeys = null;
  sseNextEventId = 1;
  sseReplayBuffer.clear();
  seenWakeupHints.clear();
}

// =========================================================================
// Zero-Cloud Built-In SSE Blind Wakeup Subscribers + Durable Replay Buffer
// =========================================================================
interface SseSubscriber {
  res: http.ServerResponse;
  blindChannelId?: string;
  did?: string;
}
interface BufferedSseWakeup {
  id: number;
  blindChannelId: string;
  did?: string;
  opaqueWakeupHint: string;
  payload: string;
  createdAt: number;
}
const MAX_SSE_REPLAY_PER_CHANNEL = 100;
const SSE_REPLAY_TTL_MS = 3600_000;
let sseNextEventId = 1;
const sseReplayBuffer = new Map<string, BufferedSseWakeup[]>();
const seenWakeupHints = new Map<string, number>();
const sseSubscribers = new Set<SseSubscriber>();

function pruneReplayBuffer(now = Date.now()): void {
  for (const [key, list] of sseReplayBuffer.entries()) {
    const fresh = list.filter(item => now - item.createdAt <= SSE_REPLAY_TTL_MS).slice(-MAX_SSE_REPLAY_PER_CHANNEL);
    if (fresh.length === 0) sseReplayBuffer.delete(key);
    else sseReplayBuffer.set(key, fresh);
  }
  for (const [hint, ts] of seenWakeupHints.entries()) {
    if (now - ts > SSE_REPLAY_TTL_MS) seenWakeupHints.delete(hint);
  }
}

function persistSseReplayBuffer(): void {
  const dir = loadedStoreDir || resolvePushStorageDir();
  const sseFile = path.join(dir, 'sse-wakeup-buffer.json');
  pruneReplayBuffer(Date.now());
  const channels: Record<string, BufferedSseWakeup[]> = {};
  for (const [ch, list] of sseReplayBuffer.entries()) {
    if (list.length > 0) channels[ch] = list;
  }
  try {
    fs.writeFileSync(
      sseFile,
      JSON.stringify({ nextEventId: sseNextEventId, channels }, null, 2),
      'utf8',
    );
  } catch {}
}

export function emitSseWakeup(blindChannelId: string, did: string | undefined, data: Record<string, any>): number {
  ensureStoreLoaded();
  const now = Date.now();
  pruneReplayBuffer(now);
  const opaqueWakeupHint = String(data.opaqueWakeupHint || crypto.randomBytes(16).toString('hex'));
  const dedupKey = `${blindChannelId}:${opaqueWakeupHint}`;
  const isDup = seenWakeupHints.has(dedupKey);
  seenWakeupHints.set(dedupKey, now);

  const eventId = sseNextEventId++;
  const payload = JSON.stringify({
    id: eventId,
    event: 'wakeup',
    blindChannelId,
    opaqueWakeupHint,
    priority: data.priority || 'high',
    timestamp: now,
    duplicateHint: isDup,
    ...data,
  });

  if (!isDup) {
    const entry: BufferedSseWakeup = { id: eventId, blindChannelId, ...(did ? { did } : {}), opaqueWakeupHint, payload, createdAt: now };
    const chList = sseReplayBuffer.get(blindChannelId) ?? [];
    chList.push(entry);
    sseReplayBuffer.set(blindChannelId, chList.slice(-MAX_SSE_REPLAY_PER_CHANNEL));
  }
  persistSseReplayBuffer();

  let delivered = 0;
  for (const sub of Array.from(sseSubscribers)) {
    const matchChannel = sub.blindChannelId && sub.blindChannelId === blindChannelId;
    const matchDid = sub.did && did && sub.did === did;
    const matchDidViaBlind = sub.did && crypto.createHash('sha256').update(sub.did).digest('hex') === blindChannelId;
    if (matchChannel || matchDid || matchDidViaBlind) {
      try {
        sub.res.write(`id: ${eventId}\nevent: wakeup\ndata: ${payload}\n\n`);
        delivered++;
      } catch {
        sseSubscribers.delete(sub);
      }
    }
  }
  return delivered;
}

function httpPostSingleShot(
  targetUrl: string,
  headers: Record<string, string | number>,
  bodyData: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; status?: number; retryAfterSec?: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.request(parsedUrl, {
        method: 'POST',
        headers,
        timeout: timeoutMs,
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => { resBody += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          const retryAfterHdr = Number(res.headers['retry-after']);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            ...(Number.isFinite(retryAfterHdr) && retryAfterHdr > 0 ? { retryAfterSec: retryAfterHdr } : {}),
            ...(status >= 400 ? { error: resBody || `HTTP ${status}` } : {}),
          });
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timeout' }); });
      req.write(bodyData);
      req.end();
    } catch (err: any) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

async function postWithBoundedRetry(
  targetUrl: string,
  buildHeaders: () => Record<string, string | number>,
  bodyData: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; status?: number; gone?: boolean; error?: string }> {
  let lastRes: { ok: boolean; status?: number; retryAfterSec?: number; error?: string } = { ok: false, error: 'Not attempted' };
  for (let attempt = 0; attempt <= PUSH_MAX_RETRIES; attempt++) {
    lastRes = await httpPostSingleShot(targetUrl, buildHeaders(), bodyData, timeoutMs);
    if (lastRes.ok) {
      return { ok: true, ...(lastRes.status !== undefined ? { status: lastRes.status } : {}) };
    }
    if (lastRes.status === 404 || lastRes.status === 410) {
      return { ok: false, status: lastRes.status, gone: true, error: lastRes.error };
    }
    if (lastRes.status !== undefined && lastRes.status !== 429 && lastRes.status < 500) {
      return { ok: false, status: lastRes.status, error: lastRes.error };
    }
    if (attempt < PUSH_MAX_RETRIES) {
      const backoffMs = lastRes.retryAfterSec
        ? Math.min(2000, lastRes.retryAfterSec * 1000)
        : PUSH_RETRY_BASE_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  return {
    ok: false,
    ...(lastRes.status !== undefined ? { status: lastRes.status } : {}),
    error: lastRes.error || 'Push delivery failed after bounded retries',
  };
}

export async function sendWebPush(
  endpoint: string,
  payload: any,
  options?: { subject?: string }
): Promise<{ ok: boolean; status?: number; gone?: boolean; error?: string }> {
  const keys = getOrCreateVapidKeys();
  if (!keys.privateKeyPem) {
    return { ok: false, error: 'VAPID private key unavailable; mock WebPush delivery disabled' };
  }
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const defaultSub = process.env.SOVRA_VAPID_SUBJECT || 'mailto:postmaster@localhost';
  const bodyData = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const res = await postWithBoundedRetry(
    endpoint,
    () => {
      const jwt = generateVapidJwt(audience, options?.subject || defaultSub, keys.privateKeyPem);
      return {
        'Authorization': `vapid t=${jwt}, k=${keys.publicKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        TTL: '86400',
        Urgency: 'high',
      };
    },
    bodyData,
    5000,
  );
  if (res.gone) {
    removePushEndpoint(endpoint);
  }
  return res;
}

export function recordPushSubscription(
  deviceDid?: string,
  blindChannelId?: string,
  pushToken?: string,
  ttlMs = DEFAULT_TOKEN_TTL_MS,
) {
  if (!pushToken) return;
  ensureStoreLoaded();
  const expiresAt = Date.now() + Math.max(1000, ttlMs);
  if (deviceDid && deviceDid !== 'did:sovra:anonymous') {
    let m = pushTokensByDid.get(deviceDid);
    if (!m) {
      m = new Map();
      pushTokensByDid.set(deviceDid, m);
    }
    m.set(pushToken, expiresAt);
  }
  if (blindChannelId) {
    let m = pushTokensByChannel.get(blindChannelId);
    if (!m) {
      m = new Map();
      pushTokensByChannel.set(blindChannelId, m);
    }
    m.set(pushToken, expiresAt);
  }
  persistPushStore();
}

export function removePushEndpoint(endpointOrToken: string, userDid?: string): boolean {
  ensureStoreLoaded();
  let removed = false;
  for (const [did, map] of pushTokensByDid.entries()) {
    if (userDid && did !== userDid) continue;
    if (map.delete(endpointOrToken)) removed = true;
    if (map.size === 0) pushTokensByDid.delete(did);
  }
  for (const [ch, map] of pushTokensByChannel.entries()) {
    if (map.delete(endpointOrToken)) removed = true;
    if (map.size === 0) pushTokensByChannel.delete(ch);
  }
  if (userDid && nativePushRegistry.delete(userDid)) {
    removed = true;
  } else {
    for (const [did, entry] of nativePushRegistry.entries()) {
      if (entry.token === endpointOrToken || entry.endpointUrl === endpointOrToken) {
        nativePushRegistry.delete(did);
        removed = true;
      }
    }
  }
  if (removed) persistPushStore();
  return removed;
}

export function getPushTokensForDid(did: string): string[] {
  ensureStoreLoaded();
  const now = Date.now();
  const set = new Set<string>();
  const byDid = pushTokensByDid.get(did);
  if (byDid) {
    for (const [tok, exp] of byDid.entries()) {
      if (exp > now) set.add(tok);
      else byDid.delete(tok);
    }
  }
  const blindChannel = crypto.createHash('sha256').update(did).digest('hex');
  const byChannel = pushTokensByChannel.get(blindChannel);
  if (byChannel) {
    for (const [tok, exp] of byChannel.entries()) {
      if (exp > now) set.add(tok);
      else byChannel.delete(tok);
    }
  }
  return Array.from(set);
}

export async function dispatchCallWebPush(recipientDid: string, callData: {
  callId: string;
  callType: string;
  callerDid: string;
  callerName: string;
}): Promise<number> {
  const blindChannelId = crypto.createHash('sha256').update(recipientDid).digest('hex');
  let dispatched = emitSseWakeup(blindChannelId, recipientDid, {
    type: 'call',
    callId: callData.callId,
    callType: callData.callType,
    callerDid: callData.callerDid,
    callerName: callData.callerName,
  });

  const tokens = getPushTokensForDid(recipientDid);
  for (const token of tokens) {
    if (token && token.startsWith('http')) {
      const res = await sendWebPush(token, {
        type: 'call',
        title: `📞 Incoming ${callData.callType === 'video' ? 'Video' : 'Voice'} Call`,
        body: `${callData.callerName} is calling you on Sovra E2EE`,
        callId: callData.callId,
        callType: callData.callType,
        callerDid: callData.callerDid,
        callerName: callData.callerName,
        timestamp: Date.now(),
      });
      if (res.ok) dispatched++;
    }
  }
  return dispatched;
}

export async function dispatchTipWebPush(recipientDid: string, tipData: {
  amountSov: number;
  senderName: string;
  txHash?: string;
}): Promise<number> {
  const blindChannelId = crypto.createHash('sha256').update(recipientDid).digest('hex');
  let dispatched = emitSseWakeup(blindChannelId, recipientDid, {
    type: 'tip',
    amountSov: tipData.amountSov,
    senderName: tipData.senderName,
  });

  const tokens = getPushTokensForDid(recipientDid);
  for (const token of tokens) {
    if (token && token.startsWith('http')) {
      const res = await sendWebPush(token, {
        type: 'tip',
        title: `💎 Received +${tipData.amountSov} SOV Micro-Tip!`,
        body: `${tipData.senderName} sent you a 95% creator tip`,
        amountSov: tipData.amountSov,
        senderName: tipData.senderName,
        timestamp: Date.now(),
      });
      if (res.ok) dispatched++;
    }
  }
  return dispatched;
}

export async function sendNativePushNotification(payload: {
  userDid: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  skipSse?: boolean;
}): Promise<{ ok: boolean; provider?: string; error?: string }> {
  ensureStoreLoaded();
  const entry = nativePushRegistry.get(payload.userDid);
  const now = Date.now();
  if (entry && entry.expiresAt <= now) {
    nativePushRegistry.delete(payload.userDid);
    persistPushStore();
  }
  const activeEntry = nativePushRegistry.get(payload.userDid);
  const blindChannelId = activeEntry?.blindChannelId || crypto.createHash('sha256').update(payload.userDid || 'sovra').digest('hex');
  const topic = activeEntry?.topic || ('sovra_' + blindChannelId.slice(0, 16));
  const provider = activeEntry?.provider || 'sse';

  // Always emit over connected zero-cloud local SSE streams unless caller already emitted
  const sseCount = payload.skipSse
    ? 0
    : emitSseWakeup(blindChannelId, payload.userDid, {
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        ...(payload.data?.opaqueWakeupHint ? { opaqueWakeupHint: String(payload.data.opaqueWakeupHint) } : {}),
      });

  if (provider === 'sse' && sseCount > 0) {
    return { ok: true, provider: 'sse' };
  }

  if (provider === 'unifiedpush' || provider === 'ntfy') {
    const rawBase =
      activeEntry?.endpointUrl ||
      (activeEntry?.token && activeEntry.token.startsWith('http') ? activeEntry.token : '') ||
      process.env.SOVRA_UNIFIEDPUSH_ENDPOINT ||
      process.env.SOVRA_NTFY_URL ||
      '';

    if (!rawBase) {
      if (sseCount > 0) return { ok: true, provider: 'sse' };
      return {
        ok: false,
        provider,
        error: 'No self-hosted UnifiedPush/ntfy endpoint URL configured and no active SSE stream connected (hardcoded public ntfy.sh disabled)',
      };
    }

    const baseClean = rawBase.trim().replace(/\/+$/, '');
    const targetUrl = provider === 'unifiedpush' && activeEntry?.endpointUrl
      ? baseClean
      : `${baseClean}/${encodeURIComponent(topic)}`;

    const postData = JSON.stringify({
      topic,
      title: payload.title,
      message: payload.body,
      priority: 5,
      tags: ['telephone_receiver', 'incoming_call'],
      data: payload.data || {},
    });

    const delivery = await postWithBoundedRetry(
      targetUrl,
      () => ({
        Title: payload.title,
        Priority: 'urgent',
        Tags: 'telephone_receiver,call',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      }),
      postData,
      4000,
    );

    if (delivery.gone) {
      nativePushRegistry.delete(payload.userDid);
      persistPushStore();
    }
    return { ok: delivery.ok, provider, ...(delivery.error ? { error: delivery.error } : {}) };
  }

  if (sseCount > 0) {
    return { ok: true, provider: 'sse' };
  }

  return {
    ok: false,
    provider,
    error: `Native push provider '${provider}' is not configured with a live delivery client; mock delivery disabled`,
  };
}

export async function handlePushRoutes(ctx: PushRouteContext): Promise<boolean> {
  const { req, res, url, blindPushRelay, readBoundedBody } = ctx;
  ensureStoreLoaded();

  // Zero-Cloud Real-Time Blind Wakeup SSE Stream
  if (url.pathname === '/api/push/stream' && req.method === 'GET') {
    const blindChannelId = url.searchParams.get('blindChannelId') || undefined;
    const did = url.searchParams.get('did') || undefined;
    if (!blindChannelId && !did) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing blindChannelId or did query parameter' }));
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const sub: SseSubscriber = {
      res,
      ...(blindChannelId ? { blindChannelId } : {}),
      ...(did ? { did } : {}),
    };
    sseSubscribers.add(sub);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, zeroCloudStream: true, blindChannelId, did, lastEventId: sseNextEventId - 1 })}\n\n`);

    const lastEventRaw = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId');
    if (lastEventRaw !== undefined) {
      const afterId = Number(lastEventRaw) || 0;
      const now = Date.now();
      pruneReplayBuffer(now);
      const targetChannel =
        blindChannelId || (did ? crypto.createHash('sha256').update(did).digest('hex') : '');
      const seenIds = new Set<number>();
      const collected: BufferedSseWakeup[] = [];
      for (const list of sseReplayBuffer.values()) {
        for (const item of list) {
          if (item.id <= afterId || seenIds.has(item.id)) continue;
          const matchesCh = Boolean(targetChannel && item.blindChannelId === targetChannel);
          const matchesDid = Boolean(did && (item.did === did || item.blindChannelId === did));
          if (matchesCh || matchesDid) {
            seenIds.add(item.id);
            collected.push(item);
          }
        }
      }
      collected.sort((a, b) => a.id - b.id);
      for (const item of collected) {
        res.write(`id: ${item.id}\nevent: wakeup\ndata: ${item.payload}\n\n`);
      }
    }
    const heartbeat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); sseSubscribers.delete(sub); }
    }, 25_000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      sseSubscribers.delete(sub);
    });
    return true;
  }

  // Blind Push Gateway: Register Device
  if (url.pathname === '/api/push/register' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      const pushToken = String(parsed.pushToken || parsed.subscription?.endpoint || '').trim();
      const deviceDid = String(parsed.deviceDid || parsed.userDid || 'did:sovra:anonymous');
      const blindChannelId = String(
        parsed.blindChannelId ||
        (deviceDid !== 'did:sovra:anonymous' ? crypto.createHash('sha256').update(deviceDid).digest('hex') : ''),
      );
      if (!parsed.deviceId || !pushToken || !blindChannelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing deviceId, pushToken, or blindChannelId' }));
        return true;
      }
      const ttlMs = Number(parsed.ttlMs) > 0 ? Number(parsed.ttlMs) : DEFAULT_TOKEN_TTL_MS;
      const now = Date.now();
      const platform = parsed.platform === 'ios' ? 'ios' : (parsed.platform === 'web' ? 'web' : 'android');
      blindPushRelay.registerDevice({
        deviceId: String(parsed.deviceId),
        deviceDid,
        platform,
        pushToken,
        blindChannelId,
        updatedAt: now,
        expiresAt: now + ttlMs,
      });
      if (deviceDid && deviceDid !== 'did:sovra:anonymous') {
        const didBlindChannel = crypto.createHash('sha256').update(deviceDid).digest('hex');
        if (didBlindChannel !== blindChannelId) {
          blindPushRelay.registerDevice({
            deviceId: String(parsed.deviceId) + '_did',
            deviceDid,
            platform,
            pushToken,
            blindChannelId: didBlindChannel,
            updatedAt: now,
            expiresAt: now + ttlMs,
          });
        }
      }
      recordPushSubscription(deviceDid, blindChannelId, pushToken, ttlMs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, registered: true, totalDevices: blindPushRelay.getRegisteredDeviceCount() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push registration failed' }));
    }
    return true;
  }

  // Unregister / Prune Device Push Token
  if ((url.pathname === '/api/push/unregister' && req.method === 'POST') ||
      (url.pathname === '/api/push/register' && req.method === 'DELETE')) {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      if (parsed.deviceId) {
        blindPushRelay.unregisterDevice(String(parsed.deviceId));
        blindPushRelay.unregisterDevice(String(parsed.deviceId) + '_did');
      }
      const tok = String(parsed.pushToken || parsed.endpoint || parsed.token || '');
      const did = parsed.userDid || parsed.deviceDid || parsed.did;
      const removed = tok ? removePushEndpoint(tok, did ? String(did) : undefined) : (did ? nativePushRegistry.delete(String(did)) : false);
      if (removed) persistPushStore();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, unregistered: Boolean(parsed.deviceId || removed), totalDevices: blindPushRelay.getRegisteredDeviceCount() }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push unregistration failed' }));
    }
    return true;
  }

  // Native / UnifiedPush / SSE Token Registration
  if (url.pathname === '/api/push/register-native' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      const userDid = String(parsed.userDid || parsed.did || 'did:sovra:anonymous');
      const token = String(parsed.token || parsed.pushToken || '');
      const endpointUrl = parsed.endpointUrl ? String(parsed.endpointUrl).trim() : undefined;
      if (endpointUrl && !endpointUrl.startsWith('http://') && !endpointUrl.startsWith('https://')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'endpointUrl must use http:// or https://' }));
        return true;
      }
      const allowed = ['unifiedpush', 'sse', 'ntfy', 'fcm', 'apns', 'webpush'] as const;
      const provider = allowed.includes(parsed.provider) ? parsed.provider : 'unifiedpush';
      const platform = (parsed.platform === 'ios' || parsed.platform === 'web' ? parsed.platform : 'android');
      const blindChannelId = parsed.blindChannelId || crypto.createHash('sha256').update(userDid).digest('hex');
      const topic = parsed.topic || ('sovra_' + blindChannelId.slice(0, 16));
      const ttlMs = Number(parsed.ttlMs) > 0 ? Number(parsed.ttlMs) : DEFAULT_TOKEN_TTL_MS;
      const now = Date.now();

      nativePushRegistry.set(userDid, {
        userDid,
        token,
        ...(endpointUrl ? { endpointUrl } : {}),
        provider,
        platform,
        topic,
        blindChannelId,
        updatedAt: now,
        expiresAt: now + ttlMs,
      });
      persistPushStore();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, registeredNative: true, userDid, provider, topic, blindChannelId }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Native push registration failed' }));
    }
    return true;
  }

  // Native / UnifiedPush / SSE Dispatcher for Incoming Calls & Urgent Messages
  if (url.pathname === '/api/push/dispatch-native' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      const userDid = String(parsed.recipientDid || parsed.userDid || '');
      const title = String(parsed.title || '📞 Sovra Incoming Call');
      const body = String(parsed.body || 'Encrypted sovereign call incoming...');

      const result = await sendNativePushNotification({
        userDid,
        title,
        body,
        data: parsed.data || {},
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: result.ok, provider: result.provider, error: result.error }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Native push dispatch failed' }));
    }
    return true;
  }

  // WebPush Subscription Hook (1-Click PWA Registration)
  if ((url.pathname === '/api/push/subscribe' || url.pathname === '/api/push/sub') && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      const deviceDid = parsed.did || parsed.deviceDid || 'did:sovra:anonymous';
      const endpoint = parsed.endpoint || parsed.subscription?.endpoint || parsed.pushToken;
      const blindChannelId = parsed.blindChannelId || crypto.createHash('sha256').update(String(deviceDid)).digest('hex');
      const deviceId = parsed.deviceId || ('web-' + crypto.createHash('sha256').update(String(endpoint || deviceDid)).digest('hex').slice(0, 12));

      if (endpoint) {
        const now = Date.now();
        blindPushRelay.registerDevice({
          deviceId,
          deviceDid,
          platform: 'web',
          pushToken: endpoint,
          blindChannelId,
          updatedAt: now,
          expiresAt: now + DEFAULT_TOKEN_TTL_MS,
        });
        recordPushSubscription(deviceDid, blindChannelId, endpoint);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, subscribed: true, did: deviceDid, totalDevices: blindPushRelay.getRegisteredDeviceCount() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push subscription failed' }));
    }
    return true;
  }

  // Blind Push Gateway: Dispatch Opaque Wakeup Ping
  if (url.pathname === '/api/push/dispatch' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      if (!parsed.blindChannelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing blindChannelId' }));
        return true;
      }
      const hint = String(parsed.opaqueWakeupHint || crypto.randomBytes(16).toString('hex'));
      const priority = parsed.priority === 'normal' ? 'normal' : 'high';
      const sseDispatched = emitSseWakeup(String(parsed.blindChannelId), parsed.recipientDid, {
        opaqueWakeupHint: hint,
        priority,
      });

      const dispatchRes = await blindPushRelay.dispatchBlindSignal({
        blindChannelId: String(parsed.blindChannelId),
        opaqueWakeupHint: hint,
        priority,
        timestamp: Date.now(),
      });

      let directOk = 0;
      if (parsed.pushToken && String(parsed.pushToken).startsWith('http')) {
        const wpRes = await sendWebPush(String(parsed.pushToken), {
          title: parsed.title || 'Sovra Network Wakeup',
          body: parsed.body || 'New cryptographic peer activity',
          data: { channelId: parsed.blindChannelId, timestamp: Date.now() },
        });
        if (wpRes.ok) directOk = 1;
      }
      const relayCount = dispatchRes.ok ? dispatchRes.value.filter(r => r.success).length : 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: dispatchRes.ok || sseDispatched > 0 || directOk > 0,
        dispatchedCount: relayCount + sseDispatched + directOk,
        sseDispatched,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Push dispatch failed' }));
    }
    return true;
  }

  // Dedicated Zero-Knowledge Blind Push Dispatcher
  if (url.pathname === '/api/push/blind-dispatch' && req.method === 'POST') {
    try {
      const { body: reqBody, ok: bodyOk } = await readBoundedBody(req, res);
      if (!bodyOk) return true;
      const parsed = reqBody ? JSON.parse(reqBody) : {};
      let blindChannelId = parsed.blindChannelId;
      if (!blindChannelId && parsed.recipientDid) {
        blindChannelId = crypto.createHash('sha256').update(String(parsed.recipientDid)).digest('hex');
      }
      if (!blindChannelId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing blindChannelId or recipientDid' }));
        return true;
      }

      const opaqueWakeupHint = String(parsed.opaqueWakeupHint || crypto.randomBytes(16).toString('hex'));
      const priority = parsed.priority === 'normal' ? 'normal' : 'high';
      const sseDispatched = emitSseWakeup(String(blindChannelId), parsed.recipientDid, {
        type: 'blind_wakeup',
        opaqueWakeupHint,
        priority,
      });

      const dispatchRes = await blindPushRelay.dispatchBlindSignal({
        blindChannelId: String(blindChannelId),
        opaqueWakeupHint,
        priority,
        timestamp: Date.now(),
      });

      let webPushCount = 0;
      const didTokens = parsed.recipientDid ? getPushTokensForDid(parsed.recipientDid) : [];
      const chanMap = pushTokensByChannel.get(blindChannelId);
      const channelTokens = chanMap ? Array.from(chanMap.keys()) : [];
      const uniqueTokens = Array.from(new Set([...didTokens, ...channelTokens]));

      for (const token of uniqueTokens) {
        if (token && token.startsWith('http')) {
          const wp = await sendWebPush(token, {
            type: 'blind_wakeup',
            title: '⚡ Sovra Wakeup',
            body: 'Encrypted message received in background',
            data: { blindChannelId, opaqueWakeupHint, timestamp: Date.now() },
          });
          if (wp.ok) webPushCount++;
        }
      }

      const nativeRes = await sendNativePushNotification({
        userDid: parsed.recipientDid || blindChannelId,
        title: 'Sovra Wakeup',
        body: 'Encrypted sovereign payload pending',
        data: { blindChannelId, opaqueWakeupHint },
        skipSse: true,
      }).catch(() => ({ ok: false }));

      const relayMatches = dispatchRes.ok ? dispatchRes.value.filter(r => r.success).length : 0;
      const totalDispatched = relayMatches + webPushCount + sseDispatched + (nativeRes.ok ? 1 : 0);
      const anySucceeded = totalDispatched > 0 || dispatchRes.ok;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: anySucceeded,
        blindChannelId,
        dispatchedCount: totalDispatched,
        relayMatches,
        webPushDispatched: webPushCount,
        sseDispatched,
        ...(dispatchRes.ok ? {} : { error: dispatchRes.error?.message }),
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Blind push dispatch failed' }));
    }
    return true;
  }

  // Blind Push Gateway: Status
  if (url.pathname === '/api/push/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      activeDevices: blindPushRelay.getRegisteredDeviceCount(),
      sseSubscribers: sseSubscribers.size,
      nativeRegistrations: nativePushRegistry.size,
    }));
    return true;
  }

  // WebPush VAPID Public Key for Client PushManager Subscriptions
  if (url.pathname === '/api/push/vapid-key' && req.method === 'GET') {
    const keys = getOrCreateVapidKeys();
    const vapidKey = process.env.VAPID_PUBLIC_KEY || process.env.SOVRA_VAPID_PUBLIC_KEY || keys.publicKey;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, publicKey: vapidKey }));
    return true;
  }

  return false;
}
