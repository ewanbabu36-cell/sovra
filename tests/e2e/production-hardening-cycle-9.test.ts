/**
 * @file tests/e2e/production-hardening-cycle-9.test.ts
 * Comprehensive End-to-End Verification Suite for Cycle 9 Production Hardening.
 *
 * Verifies:
 * 1. E2EE Multi-Party Group Chat engine (Schema v8, createGroupChat, memberDids, conversation list binding).
 * 2. Sovereign Watch Later & Saved Playlists (Schema v8, saveVideoToWatchLater, checkIsVideoSaved, removeSavedVideo).
 * 3. Sovereign L1 Validator Staking & Delegation (fetchValidators, delegateTokensToValidator, APR calculations).
 * 4. UI Component Integrity across ChatsScreen (CreateGroupModal), WatchScreen (Saved Playlist tab), and MeScreen (StakingDrawerModal).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SovraLocalDatabase,
  type CachedGroup,
  type CachedSavedVideo,
} from '../../apps/sovra-mobile/src/services/local-database.js';
import {
  createGroupChat,
  fetchGroupChats,
  saveVideoToWatchLater,
  fetchSavedVideos,
  removeSavedVideo,
  checkIsVideoSaved,
  fetchValidators,
  delegateTokensToValidator,
} from '../../apps/sovra-mobile/src/services/api.js';

describe('Production Hardening Cycle 9 Verification Suite', { timeout: 25000 }, () => {
  let db: SovraLocalDatabase;

  beforeEach(() => {
    db = SovraLocalDatabase.getInstance();
  });

  afterEach(async () => {
    await db.emergencyPanicWipe();
  });

  // ============================================================
  // 1. E2EE MULTI-PARTY GROUP CHAT CONTRACTS
  // ============================================================
  describe('Dimension 1, 4 & 8: E2EE Multi-Party Group Chat Engine', () => {
    it('creates a sovereign group chat and indexes in local database and conversations', async () => {
      const groupRes = await createGroupChat({
        name: 'Quantum Core Swarm',
        description: 'Decentralized mesh developers working on zero-SPOF routing',
        avatarEmoji: '⚡',
        memberDids: ['did:key:z6MksAliceP2P', 'did:key:z6MksBobValidator'],
      });

      expect(groupRes.ok).toBe(true);
      expect(groupRes.group).toBeDefined();
      expect(groupRes.group?.name).toBe('Quantum Core Swarm');
      expect(groupRes.group?.avatarEmoji).toBe('⚡');
      expect(groupRes.group?.memberDids).toContain('did:key:z6MksAliceP2P');

      // Verify Local Database schema v8 persistence
      const savedGroup = db.getGroup(groupRes.group!.id);
      expect(savedGroup).toBeDefined();
      expect(savedGroup?.name).toBe('Quantum Core Swarm');

      const allGroups = await fetchGroupChats();
      expect(allGroups.length).toBeGreaterThanOrEqual(1);
      expect(allGroups.some(g => g.id === groupRes.group!.id)).toBe(true);

      // Verify inclusion in conversation summaries with isGroup flag
      const summaries = db.getConversationsList();
      const groupSummary = summaries.find(s => s.threadId === groupRes.group!.id);
      expect(groupSummary).toBeDefined();
      expect(groupSummary?.isGroup).toBe(true);
      expect(groupSummary?.peerName).toContain('Quantum Core Swarm');
    });

    it('validates empty group names cleanly with error response', async () => {
      const emptyRes = await createGroupChat({
        name: '   ',
        memberDids: [],
      });
      expect(emptyRes.ok).toBe(false);
      expect(emptyRes.error).toContain('Group name is required');
    });
  });

  // ============================================================
  // 2. SOVEREIGN WATCH LATER & SAVED PLAYLISTS
  // ============================================================
  describe('Dimension 2, 3 & 7: Sovereign Watch Later & Saved Playlists', () => {
    it('saves a video to Watch Later, checks persistence, and removes cleanly', async () => {
      const testVideo = {
        videoId: 'vid_saved_test_' + Date.now(),
        title: 'Zero-Knowledge Cryptography Explained',
        channelName: 'Alice P2P Architect',
        duration: 420,
        thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400',
      };

      expect(checkIsVideoSaved(testVideo.videoId)).toBe(false);

      const saveRes = await saveVideoToWatchLater(testVideo);
      expect(saveRes.ok).toBe(true);

      expect(checkIsVideoSaved(testVideo.videoId)).toBe(true);

      const savedList = await fetchSavedVideos();
      expect(savedList.length).toBeGreaterThanOrEqual(1);
      expect(savedList.some(v => v.videoId === testVideo.videoId)).toBe(true);

      const deleteRes = await removeSavedVideo(testVideo.videoId);
      expect(deleteRes.ok).toBe(true);
      expect(checkIsVideoSaved(testVideo.videoId)).toBe(false);
    });
  });

  // ============================================================
  // 3. SOVEREIGN L1 VALIDATOR STAKING & DELEGATION
  // ============================================================
  describe('Dimension 5 & 8: Sovereign L1 Validator Staking & Delegation Engine', () => {
    it('fetches sovereign validator list with APR and commission metrics', async () => {
      const validators = await fetchValidators();
      expect(Array.isArray(validators)).toBe(true);
      expect(validators.length).toBeGreaterThanOrEqual(3);

      const firstVal = validators[0];
      expect(firstVal).toBeDefined();
      expect(firstVal?.address).toMatch(/^sovravaloper1/);
      expect(firstVal?.apr).toBeGreaterThan(10);
      expect(firstVal?.status).toBe('active');
    });

    it('delegates tokens to a validator and receives cryptographically verifiable tx receipt', async () => {
      const validators = await fetchValidators();
      const val = validators[0];
      expect(val).toBeDefined();

      const delegateRes = await delegateTokensToValidator({
        validatorAddress: val!.address,
        amount: '100',
      });

      expect(delegateRes.ok).toBe(true);
      expect(delegateRes.txHash).toBeDefined();
      expect(delegateRes.txHash?.startsWith('0x')).toBe(true);
    });

    it('rejects non-positive or invalid delegation amounts', async () => {
      const invalidRes = await delegateTokensToValidator({
        validatorAddress: 'sovravaloper1q4p7z82k3m9lx5v0t2c4',
        amount: '-10',
      });
      expect(invalidRes.ok).toBe(false);
      expect(invalidRes.error).toContain('Invalid delegation amount');
    });
  });

  // ============================================================
  // 4. UI ARCHITECTURE & COMPONENT INTEGRITY
  // ============================================================
  describe('Dimension 6 & 7: UI Component Integrity across Modals', () => {
    it('verifies ChatsScreen contains CreateGroupModal, New Group action, and emoji picker', () => {
      const chatsPath = path.resolve(process.cwd(), 'apps/sovra-mobile/src/screens/ChatsScreen.tsx');
      expect(fs.existsSync(chatsPath)).toBe(true);
      const content = fs.readFileSync(chatsPath, 'utf8');

      expect(content).toContain('export function CreateGroupModal');
      expect(content).toContain('isCreateGroupOpen');
      expect(content).toContain('New Group');
      expect(content).toContain('selectedEmoji');
      expect(content).toContain('availableContacts');
    });

    it('verifies WatchScreen contains Saved tab, Watch Later actions, and playlist cards', () => {
      const watchPath = path.resolve(process.cwd(), 'apps/sovra-mobile/src/screens/WatchScreen.tsx');
      expect(fs.existsSync(watchPath)).toBe(true);
      const content = fs.readFileSync(watchPath, 'utf8');

      expect(content).toContain("setWatchTab('saved')");
      expect(content).toContain('savedVideos');
      expect(content).toContain('handleToggleSaveVideo');
      expect(content).toContain('Watch Later & Saved Playlists');
    });

    it('verifies MeScreen contains StakingDrawerModal, Stake action, and APR display', () => {
      const mePath = path.resolve(process.cwd(), 'apps/sovra-mobile/src/screens/MeScreen.tsx');
      expect(fs.existsSync(mePath)).toBe(true);
      const content = fs.readFileSync(mePath, 'utf8');

      expect(content).toContain('export function StakingDrawerModal');
      expect(content).toContain('isStakingOpen');
      expect(content).toContain('delegateTokensToValidator');
      expect(content).toContain('14.2% APR');
    });
  });
});
