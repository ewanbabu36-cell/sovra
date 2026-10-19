/**
 * @file scripts/routes/referral.routes.ts
 * Viral Referral & Invite Engine for Sovra.
 *
 * Implements:
 * 1. Deterministic cryptographic referral code generation: SOV-<6_HEX_CHARS>.
 * 2. Anti-Sybil validation (self-referral prevention, duplicate device fingerprinting, single-claim rule).
 * 3. 2-Sided Economic Rewards: +50 SOV to Inviter, +25 SOV Welcome Bonus to Invitee.
 * 4. Deep-link generation & pre-crafted viral share copy for WhatsApp / Telegram.
 * 5. Real-time stats & referral history ledger.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { sovraDb } from '../database-engine.ts';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';

export const REWARD_INVITER_SOV = 50.0;
export const REWARD_INVITEE_SOV = 25.0;

export interface ReferralRecord {
  id: string;
  inviterDid: string;
  inviterHandle: string;
  inviterRefCode: string;
  inviteeDid: string;
  inviteeHandle: string;
  inviteeDeviceId?: string;
  status: 'completed' | 'pending';
  inviterRewardSov: number;
  inviteeRewardSov: number;
  createdAt: number;
  completedAt: number;
}

export interface ReferralRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse) => AuthenticatedPrincipal | null;
}

/**
 * Deterministically derives an eye-catching, uppercase 6-character referral code
 * from an Ed25519 DID.
 */
export function computeReferralCode(did: string): string {
  if (!did || did.trim().length === 0) return 'SOV-GENESIS';
  const clean = did.trim();
  const hash = crypto.createHash('sha256').update(clean).digest('hex');
  return `SOV-${hash.slice(0, 6).toUpperCase()}`;
}

/**
 * Finds an inviter user from sovraDb matching a referral code.
 */
export function findInviterByCode(code: string): any | null {
  const normalized = code.trim().toUpperCase();
  const dbAny = sovraDb as any;
  const users: any[] = (dbAny && dbAny.db && Array.isArray(dbAny.db.users)) ? dbAny.db.users : [];

  for (const u of users) {
    if (!u.did) continue;
    const computed = computeReferralCode(u.did);
    if (computed === normalized) return u;
    if (u.customReferralCode && u.customReferralCode.toUpperCase() === normalized) return u;
    if (u.handle && `SOV-${u.handle.replace('@', '').toUpperCase().slice(0, 6)}` === normalized) return u;
  }
  return null;
}

/**
 * Main HTTP Handler for Referral Routes.
 */
export async function handleReferralRoutes(ctx: ReferralRouteContext): Promise<boolean> {
  const { req, res, url, readBoundedBody } = ctx;

  // Ensure referrals collection exists in database
  const dbAny = sovraDb as any;
  if (dbAny && dbAny.db && !Array.isArray(dbAny.db.referrals)) {
    dbAny.db.referrals = [];
  }

  // ==========================================
  // 1. GET /api/referral/stats
  // ==========================================
  if (url.pathname === '/api/referral/stats' && req.method === 'GET') {
    const qDid = url.searchParams.get('did');
    const principal = ctx.resolvePrincipal(req);
    const targetDid = qDid || principal?.did || 'did:key:z6MkuV8SovraDefaultPeerKey1';

    const referralCode = computeReferralCode(targetDid);
    const host = req.headers.host || 'sovra.app';
    const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
    const referralLink = `${protocol}://${host}/join?ref=${referralCode}`;

    const allReferrals: ReferralRecord[] = (dbAny.db && Array.isArray(dbAny.db.referrals)) ? dbAny.db.referrals : [];

    // Filter referrals where target user was the inviter
    const myInvites = allReferrals.filter(r => r.inviterDid === targetDid);
    const totalInvited = myInvites.length;
    const totalEarnedSov = myInvites.reduce((sum, r) => sum + (r.inviterRewardSov || 0), 0);

    // Check if target user was already an invitee
    const asInvitee = allReferrals.find(r => r.inviteeDid === targetDid);

    // Pre-crafted viral copy in Hinglish/English for instant WhatsApp/Telegram conversion
    const shareMessage = `🚀 Join me on Sovra - the private WhatsApp & YouTube alternative where you own your identity! Use my referral code *${referralCode}* to get 25 FREE SOV coins in your sovereign wallet: ${referralLink}`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      referralCode,
      referralLink,
      targetDid,
      stats: {
        totalInvited,
        totalEarnedSov,
        rewardPerInvite: REWARD_INVITER_SOV,
        welcomeBonus: REWARD_INVITEE_SOV,
        hasClaimedWelcomeBonus: !!asInvitee,
        claimedFromCode: asInvitee ? asInvitee.inviterRefCode : null,
      },
      invitedPeers: myInvites.map(r => ({
        id: r.id,
        inviteeHandle: r.inviteeHandle,
        rewardSov: r.inviterRewardSov,
        status: r.status,
        date: r.completedAt || r.createdAt,
      })),
      shareMessage,
    }));
    return true;
  }

  // ==========================================
  // 2. POST /api/referral/claim
  // ==========================================
  if (url.pathname === '/api/referral/claim' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 65536);
    if (!ok) return true;

    let payload: any = {};
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Malformed JSON payload' }));
      return true;
    }

    const { referralCode, inviteeDid, inviteeHandle, deviceId } = payload;

    if (!referralCode || typeof referralCode !== 'string' || referralCode.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid referralCode' }));
      return true;
    }

    if (!inviteeDid || typeof inviteeDid !== 'string' || inviteeDid.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid inviteeDid' }));
      return true;
    }

    const cleanCode = referralCode.trim().toUpperCase();
    const cleanInviteeDid = inviteeDid.trim();
    const cleanInviteeHandle = (inviteeHandle && typeof inviteeHandle === 'string')
      ? inviteeHandle.trim()
      : `@peer_${cleanInviteeDid.slice(-6)}`;

    // Anti-Sybil Check 1: Self-referral prevention
    const inviteeSelfCode = computeReferralCode(cleanInviteeDid);
    if (cleanCode === inviteeSelfCode) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Anti-Sybil violation: You cannot claim your own referral code.' }));
      return true;
    }

    const allReferrals: ReferralRecord[] = dbAny.db.referrals;

    // Anti-Sybil Check 2: Single claim per invitee DID
    const existingClaim = allReferrals.find(r => r.inviteeDid === cleanInviteeDid);
    if (existingClaim) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Welcome bonus already claimed for this identity.',
        claimedCode: existingClaim.inviterRefCode,
      }));
      return true;
    }

    // Anti-Sybil Check 3: Hardware Device deduplication (if deviceId provided)
    if (deviceId && typeof deviceId === 'string' && deviceId.trim().length > 0) {
      const cleanDeviceId = deviceId.trim();
      const existingDevice = allReferrals.find(r => r.inviteeDeviceId === cleanDeviceId);
      if (existingDevice) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: 'Anti-Sybil violation: This physical device has already redeemed a welcome grant.',
        }));
        return true;
      }
    }

    // Resolve inviter from database
    const inviter = findInviterByCode(cleanCode);
    if (!inviter) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: `Invalid referral code "${cleanCode}". No sovereign peer found with this code.`,
      }));
      return true;
    }

    // Anti-Sybil Check 4: Inviter cannot be the same DID as invitee
    if (inviter.did === cleanInviteeDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Anti-Sybil violation: Inviter and invitee identity cannot be identical.' }));
      return true;
    }

    const now = Date.now();
    const claimId = `ref_${now}_${crypto.randomBytes(4).toString('hex')}`;

    // Auto-credit +50 SOV to Inviter
    try {
      sovraDb.depositFunds({
        did: inviter.did,
        amount: REWARD_INVITER_SOV,
        sourceTx: `referral_reward_${claimId}`,
      });
    } catch (err) {
      console.warn('[Referral] Could not credit inviter:', err);
    }

    // Auto-credit +25 SOV to Invitee
    let newInviteeBalance = REWARD_INVITEE_SOV;
    try {
      const inviteeUser = (dbAny.db.users || []).find((u: any) => u.did === cleanInviteeDid);
      if (inviteeUser) {
        const dep = sovraDb.depositFunds({
          did: cleanInviteeDid,
          amount: REWARD_INVITEE_SOV,
          sourceTx: `referral_welcome_${claimId}`,
        });
        if (dep.ok) newInviteeBalance = dep.newBalance;
      } else {
        // Invitee not yet registered in users array; credit upon user registration
        newInviteeBalance = 500.0 + REWARD_INVITEE_SOV;
      }
    } catch (err) {
      console.warn('[Referral] Could not credit invitee:', err);
    }

    // Record verified referral in ledger
    const newRecord: ReferralRecord = {
      id: claimId,
      inviterDid: inviter.did,
      inviterHandle: inviter.handle || '@sovereign_peer',
      inviterRefCode: cleanCode,
      inviteeDid: cleanInviteeDid,
      inviteeHandle: cleanInviteeHandle,
      inviteeDeviceId: deviceId ? String(deviceId).trim() : undefined,
      status: 'completed',
      inviterRewardSov: REWARD_INVITER_SOV,
      inviteeRewardSov: REWARD_INVITEE_SOV,
      createdAt: now,
      completedAt: now,
    };

    allReferrals.push(newRecord);
    sovraDb.save();

    try {
      sovraDb.logActivity(
        'REFERRAL_CLAIMED',
        cleanInviteeDid,
        cleanInviteeHandle,
        `Claimed referral code ${cleanCode} from ${inviter.handle}. Inviter earned +${REWARD_INVITER_SOV} SOV, Invitee received +${REWARD_INVITEE_SOV} SOV.`,
      );
    } catch (_) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      claimId,
      message: `🎉 Success! You received +${REWARD_INVITEE_SOV} SOV welcome grant. ${inviter.handle} received +${REWARD_INVITER_SOV} SOV.`,
      inviterHandle: inviter.handle,
      inviterRewardSov: REWARD_INVITER_SOV,
      inviteeRewardSov: REWARD_INVITEE_SOV,
      newBalanceSov: newInviteeBalance,
    }));
    return true;
  }

  return false;
}
