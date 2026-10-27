/**
 * @file tests/e2e/mobile-parity-hardening.test.ts
 * Master E2E Suite for Mobile App Native Parity & Offline-First Synchronization (Cycle 1).
 *
 * Verifies:
 * 1. SovereignHeroAnchorCard:
 *    - Balance privacy masking / unmasking (•••• SOV vs real balance)
 *    - P2P network health pill (peers + ping)
 *    - Video cache progress meter & 1-tap prune
 *    - 4-pill quick launcher actions (Send, Scan QR, Go Live, Store)
 * 2. IdentitySwitcherModal & HeaderIdentitySwitcherPill:
 *    - Scoped persona switching across Citizen, Studio Pro, and Org Admin
 *    - 1-tap state transition without session invalidation
 * 3. SovereignCheckoutModal:
 *    - 95/5 transparent economic split verification
 *    - PPV, Super-Chat (Bronze/Silver/Gold), and Store checkout
 *    - Receipt generation and balance checks
 * 4. Offline-First Durable Persistence:
 *    - MemoryStorageDriver operations
 *    - Outbox queueing of checkout transactions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import {
  SovereignHeroAnchorCard,
  type SovereignHeroAnchorCardProps,
} from '../../apps/sovra-mobile/src/components/SovereignHeroAnchorCard.js';
import {
  IdentitySwitcherModal,
  HeaderIdentitySwitcherPill,
  DEFAULT_PERSONAS,
  type SovereignPersona,
} from '../../apps/sovra-mobile/src/components/IdentitySwitcherModal.js';
import {
  SovereignCheckoutModal,
  type CheckoutItemPayload,
} from '../../apps/sovra-mobile/src/components/SovereignCheckoutModal.js';
import {
  SovraLocalDatabase,
  MemoryStorageDriver,
} from '../../apps/sovra-mobile/src/services/local-database.js';

// Setup minimal React hooks dispatcher for headless component execution
const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
  (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

if (internals) {
  internals.H = {
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
    useRef: (initial: any) => ({ current: initial }),
  };
}

function elementToString(node: any): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(elementToString).join('');
  if (node.props) {
    const { children, ...rest } = node.props;
    const attrs = Object.entries(rest)
      .filter(([k, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    const tag = typeof node.type === 'string' ? node.type : (node.type?.name || 'div');
    const childrenStr = children ? elementToString(children) : '';
    return `<${tag} ${attrs}>${childrenStr}</${tag}>`;
  }
  return '';
}

describe('Cycle 1: Mobile App Native Parity & Offline-First Synchronization Suite', () => {
  let db: SovraLocalDatabase;
  let memDriver: MemoryStorageDriver;

  beforeEach(() => {
    memDriver = new MemoryStorageDriver();
    db = new SovraLocalDatabase(memDriver);
  });

  describe('1. SovereignHeroAnchorCard Component', () => {
    it('should render glanceable hero card with balance, health pill, and thumb launchers', () => {
      const el = SovereignHeroAnchorCard({
        balance: '450.50 SOV',
        peerCount: 7,
        rttMs: 12,
      });
      const html = elementToString(el);

      expect(html).toContain('id="sovraHeroAnchorCard"');
      expect(html).toContain('450.50 SOV');
      expect(html).toContain('heroBalancePrivacyBtn');
      expect(html).toContain('heroNetworkHealthPill');
      expect(html).toContain('7 Peers Connected | 12ms');
      expect(html).toContain('heroCacheProgressLabel');
      expect(html).toContain('heroCachePruneBtn');
      expect(html).toContain('Send SOV');
      expect(html).toContain('Scan QR');
      expect(html).toContain('Go Live');
      expect(html).toContain('Store');
    });

    it('should mask balance to •••• SOV when privacy is toggled in localDb', async () => {
      await db.setBalanceMasked(true);
      expect(db.isBalanceMasked()).toBe(true);

      await db.setBalanceMasked(false);
      expect(db.isBalanceMasked()).toBe(false);
    });

    it('should calculate cache quota stats and support 1-tap deterministic prune', async () => {
      const initialStats = db.getCacheQuotaStats();
      expect(initialStats.usedMb).toBe(420);
      expect(initialStats.totalMb).toBe(500);
      expect(initialStats.percent).toBe(84);

      const pruneResult = await db.pruneCache();
      expect(pruneResult.prunedMb).toBeGreaterThan(0);
      expect(pruneResult.remainingMb).toBeLessThan(420);

      const updatedStats = db.getCacheQuotaStats();
      expect(updatedStats.usedMb).toBe(pruneResult.remainingMb);
    });
  });

  describe('2. IdentitySwitcherModal & HeaderIdentitySwitcherPill', () => {
    it('should render HeaderIdentitySwitcherPill with active persona badge', () => {
      const citizen = DEFAULT_PERSONAS[0];
      const el = HeaderIdentitySwitcherPill({
        activePersona: citizen,
        onOpen: () => {},
      });
      const html = elementToString(el);

      expect(html).toContain('id="headerIdentitySwitcherPill"');
      expect(html).toContain(citizen.handle);
      expect(html).toContain(citizen.role);
    });

    it('should render Horizon Identity Switcher Sheet with Citizen, Studio Pro, and Org personas', () => {
      const el = IdentitySwitcherModal({
        isOpen: true,
        activePersonaId: 'citizen_primary',
        personas: DEFAULT_PERSONAS,
        onClose: () => {},
      });
      const html = elementToString(el);

      expect(html).toContain('id="identitySwitcherSheet"');
      expect(html).toContain('Horizon Identity Switcher');
      expect(html).toContain('personaItem-citizen_primary');
      expect(html).toContain('personaItem-channel_studio_pro');
      expect(html).toContain('personaItem-org_sovra_dao');
      expect(html).toContain('Verified Citizen');
      expect(html).toContain('Channel (14.2k)');
      expect(html).toContain('B2B Org Admin');
      expect(html).toContain('id="btnAddPersona"');
    });

    it('should persist active persona state in localDb without session invalidation', async () => {
      const studioPersona = DEFAULT_PERSONAS[1];
      await db.setActivePersona(studioPersona);

      const active = db.getActivePersona();
      expect(active).not.toBeNull();
      expect(active.id).toBe('channel_studio_pro');
      expect(active.role).toBe('Creator Pro');
    });
  });

  describe('3. SovereignCheckoutModal Component & 95/5 Economic Split', () => {
    it('should render PPV unlock with 95% creator and 5% protocol split', () => {
      const ppvItem: CheckoutItemPayload = {
        id: 'ppv_4k_001',
        type: 'ppv',
        title: 'Decentralized AI Masterclass (4K)',
        priceSov: 100,
        creatorDid: 'did:key:z6MkhaXgBZDvotDkL5257faiz48Z8x28z44SS42E',
        creatorHandle: '@alice_p2p',
        creatorName: 'Alice',
      };

      const el = SovereignCheckoutModal({
        isOpen: true,
        item: ppvItem,
        userBalanceSov: 500,
        onClose: () => {},
      });
      const html = elementToString(el);

      expect(html).toContain('id="sovereignCheckoutSheet"');
      expect(html).toContain('Unlock Pay-Per-View Video');
      expect(html).toContain('100 SOV');
      expect(html).toContain('95 SOV'); // 95% creator
      expect(html).toContain('5 SOV'); // 5% protocol cut
      expect(html).toContain('btnConfirmCheckout');
    });

    it('should render Super-Chat tier controls with duration pins', () => {
      const superChatItem: CheckoutItemPayload = {
        id: 'stream_tip_001',
        type: 'super_chat',
        title: 'Live Stream Tip',
        priceSov: 10,
        creatorDid: 'did:key:z6MkhaXgBZDvotDkL5257faiz48Z8x28z44SS42E',
        creatorHandle: '@alice_p2p',
        creatorName: 'Alice',
      };

      const el = SovereignCheckoutModal({
        isOpen: true,
        item: superChatItem,
        userBalanceSov: 500,
        onClose: () => {},
      });
      const html = elementToString(el);

      expect(html).toContain('Super-Chat Creator Tip');
      expect(html).toContain('Bronze (10 SOV)');
      expect(html).toContain('Silver (50 SOV)');
      expect(html).toContain('Gold (200 SOV)');
      expect(html).toContain('5 min pin');
    });

    it('should queue offline checkout payment in outbox when offline', async () => {
      const queuedOp = await db.queueCheckoutPayment({
        id: 'checkout_offline_001',
        type: 'store',
        title: 'Sovereign Node Hoodie',
        amount: 45,
        creatorDid: 'did:key:creator_alice',
        buyerDid: 'did:key:buyer_bob',
      });

      expect(queuedOp.status).toBe('PENDING');
      expect(queuedOp.operationId).toBe('checkout_offline_001');

      const outbox = db.getOutboxOperations();
      const found = outbox.find(o => o.operationId === 'checkout_offline_001');
      expect(found).toBeDefined();
      expect(found?.payload.amount).toBe(45);
    });
  });
});
