import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeed,
  mnemonicToIdentity,
} from '../src/services/mnemonic.js';
import { secureKeyStore } from '../src/services/secure-keystore.js';
import { multiRelayManager } from '../src/services/multi-relay-manager.js';

describe('Step A: Mnemonic Seed Phrases & Multi-Relay Fallback Swarm', () => {
  beforeEach(() => {
    secureKeyStore.wipe();
  });

  describe('1. BIP-39 Mnemonic Seed Phrase Service', () => {
    it('generates a valid 12-word BIP-39 mnemonic with correct SHA-256 checksum', () => {
      const phrase = generateMnemonic(12);
      expect(typeof phrase).toBe('string');
      const words = phrase.split(' ');
      expect(words).toHaveLength(12);
      expect(validateMnemonic(phrase)).toBe(true);
    });

    it('generates a valid 24-word BIP-39 mnemonic', () => {
      const phrase = generateMnemonic(24);
      expect(phrase.split(' ')).toHaveLength(24);
      expect(validateMnemonic(phrase)).toBe(true);
    });

    it('rejects invalid or tampered mnemonics with invalid checksum', () => {
      expect(validateMnemonic('')).toBe(false);
      expect(validateMnemonic('not twelve words')).toBe(false);
      expect(validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false); // bad checksum
      expect(validateMnemonic('randominvalidword1 randominvalidword2 randomword3 randomword4 randomword5 randomword6 randomword7 randomword8 randomword9 randomword10 randomword11 randomword12')).toBe(false);
    });

    it('deterministically derives the exact same Ed25519 DID from the same 12 words', () => {
      const phrase = generateMnemonic(12);
      const ident1 = mnemonicToIdentity(phrase);
      const ident2 = mnemonicToIdentity(phrase);

      expect(ident1.did).toBe(ident2.did);
      expect(ident1.privateKey).toEqual(ident2.privateKey);
      expect(ident1.publicKey).toEqual(ident2.publicKey);
      expect(ident1.did.startsWith('did:key:z6Mk')).toBe(true);
    });

    it('produces different DIDs for different mnemonics', () => {
      const phrase1 = generateMnemonic(12);
      const phrase2 = generateMnemonic(12);

      const ident1 = mnemonicToIdentity(phrase1);
      const ident2 = mnemonicToIdentity(phrase2);

      expect(ident1.did).not.toBe(ident2.did);
    });
  });

  describe('2. SecureKeyStore Mnemonic Vault Integration', () => {
    it('automatically generates and saves 12-word mnemonic for fresh users', () => {
      const ident = secureKeyStore.getOrGenerateMeshIdentity();
      expect(ident.did).toBeDefined();
      expect(ident.mnemonic).toBeDefined();
      expect(ident.mnemonic?.split(' ')).toHaveLength(12);
      expect(validateMnemonic(ident.mnemonic!)).toBe(true);

      // Verify getMnemonic returns the exact same phrase
      const exported = secureKeyStore.getMnemonic();
      expect(exported).toBe(ident.mnemonic);
    });

    it('restores exact identity and private key from 12 recovery words on another device', () => {
      // User creates account on Device 1
      const dev1Ident = secureKeyStore.getOrGenerateMeshIdentity();
      const dev1Words = dev1Ident.mnemonic!;
      const dev1Did = dev1Ident.did;

      // Wipe device (simulate fresh installation on new phone)
      secureKeyStore.wipe();
      expect(secureKeyStore.getMnemonic()).toBeNull();

      // Restore on Device 2
      const restored = secureKeyStore.restoreFromMnemonic(dev1Words);
      expect(restored.did).toBe(dev1Did);
      expect(restored.mnemonic).toBe(dev1Words);
      expect(restored.privateKey).toEqual(dev1Ident.privateKey);
      expect(restored.publicKey).toEqual(dev1Ident.publicKey);
    });
  });

  describe('3. Multi-Relay Fallback Swarm Manager', () => {
    it('initializes with multiple bootstrap offshore & local relays', () => {
      const relays = multiRelayManager.getAllRelays();
      expect(relays.length).toBeGreaterThanOrEqual(4);

      const urls = relays.map(r => r.url);
      expect(urls.some(u => u.includes('trycloudflare') || u.includes('3001'))).toBe(true);
      expect(urls.some(u => u.includes('seed1.sovra.network'))).toBe(true);
      expect(urls.some(u => u.includes('seed2.sovra.network'))).toBe(true);
    });

    it('supports adding and persisting user-defined custom community relays (Nostr Parity)', async () => {
      const customUrl = 'https://my-community-node.org';
      const added = await multiRelayManager.addCustomRelay(customUrl, 'Community Node Paris');

      expect(added.url).toBe(customUrl);
      expect(added.name).toBe('Community Node Paris');
      expect(added.isCustom).toBe(true);

      const all = multiRelayManager.getAllRelays();
      expect(all.some(r => r.url === customUrl)).toBe(true);

      // Clean up
      multiRelayManager.removeCustomRelay(added.id);
      expect(multiRelayManager.getAllRelays().some(r => r.url === customUrl)).toBe(false);
    });

    it('successfully switches active relay and notifies listeners', () => {
      let notifiedActiveUrl = '';
      const unsubscribe = multiRelayManager.subscribe((_, active) => {
        notifiedActiveUrl = active.url;
      });

      const relays = multiRelayManager.getAllRelays();
      const targetRelay = relays[1]!;
      multiRelayManager.setActiveRelay(targetRelay.id);

      expect(multiRelayManager.getActiveBaseUrl()).toBe(targetRelay.url);
      expect(notifiedActiveUrl).toBe(targetRelay.url);

      // Restore back to first relay
      multiRelayManager.setActiveRelay(relays[0]!.id);
      unsubscribe();
    });
  });

  describe('4. Zero-Domain Autonomous P2P Bootstrap & Permanent Free STUN Infrastructure', () => {
    it('hardcodes permanent free Google and Cloudflare STUN servers in mobile client', () => {
      const stunServers = multiRelayManager.getStunServers();
      expect(stunServers.length).toBeGreaterThanOrEqual(3);

      const urls = stunServers.map(s => s.url);
      expect(urls.some(u => u.includes('stun.l.google.com:19302'))).toBe(true);
      expect(urls.some(u => u.includes('stun.cloudflare.com:3478'))).toBe(true);
      expect(urls.some(u => u.includes('mozilla'))).toBe(true);

      const providers = stunServers.map(s => s.provider);
      expect(providers).toContain('Google');
      expect(providers).toContain('Cloudflare');
    });

    it('hardcodes decentralized DHT bootstrap seeds without central domain dependency', () => {
      const dhtSeeds = multiRelayManager.getPublicDhtSeeds();
      expect(dhtSeeds.length).toBeGreaterThanOrEqual(2);

      const addrs = dhtSeeds.map(d => d.multiaddrOrIp);
      // Confirms direct IP endpoints exist
      expect(addrs.some(a => a.includes(':19302') || a.includes(':3478'))).toBe(true);
    });

    it('derives ready-to-use WebRTC ICE servers configuration for zero-cost P2P hole-punching', () => {
      const iceServers = multiRelayManager.getRtcIceServers();
      expect(Array.isArray(iceServers)).toBe(true);
      expect(iceServers.length).toBeGreaterThanOrEqual(3);

      for (const entry of iceServers) {
        expect(entry.urls).toBeDefined();
        const urlStr = Array.isArray(entry.urls) ? entry.urls.join(',') : entry.urls;
        expect(urlStr.startsWith('stun:')).toBe(true);
      }
    });

    it('confirms autonomous zero-domain swarm readiness', () => {
      expect(multiRelayManager.isAutonomousSwarmReady()).toBe(true);

      const status = multiRelayManager.getAutonomousMeshStatus();
      expect(status.isZeroDomainAutonomous).toBe(true);
      expect(status.stunCount).toBeGreaterThanOrEqual(3);
      expect(status.dhtSeedCount).toBeGreaterThanOrEqual(2);
      expect(status.stunProviders).toContain('Google');
      expect(status.stunProviders).toContain('Cloudflare');
    });
  });
});
