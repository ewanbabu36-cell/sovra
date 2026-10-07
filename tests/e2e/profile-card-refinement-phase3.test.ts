import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = 'http://localhost:3001';

describe('Phase 3: Profile Card Refinement Production E2E Suite', () => {
  let serverHtml: string = '';

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    serverHtml = await res.text();
  });

  describe('1. Compact Cryptographic Identity Chip', () => {
    it('renders DID as an elegant, truncated chip with inline copy icon and no separate button row', () => {
      // Must contain the compact DID chip
      expect(serverHtml).toContain('id="meProfileDidChip"');
      expect(serverHtml).toContain('class="profile-did-badge"');
      expect(serverHtml).toContain('id="meProfileDid"');
      expect(serverHtml).toContain('id="copyDidIcon"');

      // The chip should have onclick="copyProfileDid()"
      expect(serverHtml).toContain('onclick="copyProfileDid()"');

      // Check truncated DID format did:key:z6Mk...
      const didChipMatch = serverHtml.match(/id="meProfileDid"[^>]*>([^<]+)<\/span>/);
      expect(didChipMatch).toBeTruthy();
      const didText = didChipMatch![1].trim();
      expect(didText).toMatch(/^did:key:z6Mk\.\.\.[A-Za-z0-9]+$/);

      // Verify copyProfileDid triggers toast notification 'Copied to clipboard'
      expect(serverHtml).toContain("showAccountToast('Copied to clipboard')");
    });
  });

  describe('2. Consolidated Authoritative Verification Badges', () => {
    it('consolidates verification into a single authoritative badge next to display name', () => {
      // Must contain authoritative verified badge next to meProfileName
      expect(serverHtml).toContain('id="meProfileName"');
      expect(serverHtml).toContain('id="meVerifiedBadgeBtn"');
      expect(serverHtml).toContain('class="authoritative-verified-badge"');
      expect(serverHtml).toContain('id="meEd25519Badge"');
      expect(serverHtml).toContain('id="meVerifiedCheckmark"');

      // Clicking the badge invokes the identity inspection sheet
      expect(serverHtml).toContain('id="meVerifiedBadgeBtn" onclick="openSovereignIdCardModal()"');

      // Sovereign Peer label is removed from the visible name row (hidden from clutter)
      expect(serverHtml).toContain('id="meRoleBadge" style="display: none;"');

      // Profile name row does not contain redundant noisy text
      const nameRowMatch = serverHtml.match(/<div class="profile-name-row">([\s\S]*?)<\/div>/);
      expect(nameRowMatch).toBeTruthy();
      const nameRowContent = nameRowMatch![1];
      expect(nameRowContent).not.toContain('>NOISE_XX MESH LISTENING<');
    });
  });

  describe('3. Cryptographic Identity Inspection Sheet', () => {
    it('provides comprehensive cryptographic inspection sheet with Ed25519 key, signature validation, and multicodec specs', () => {
      // Modal dialog
      expect(serverHtml).toContain('id="sovereignIdCardModal"');
      expect(serverHtml).toContain('Cryptographic Identity Inspection');

      // Identity inspection elements
      expect(serverHtml).toContain('id="idCardDid"');
      expect(serverHtml).toContain('id="idCardPublicKey"');
      expect(serverHtml).toContain('id="idCardSigStatus"');
      expect(serverHtml).toContain('id="idCardPeerId"');
      expect(serverHtml).toContain('id="idCardQrContainer"');

      // Multicodec and Multibase cryptographic specs
      expect(serverHtml).toContain('0xed01 (ed25519-pub, 32 bytes)');
      expect(serverHtml).toContain("base58btc (prefix: 'z')");
      expect(serverHtml).toContain('Noise_XX + Yamux (libp2p TCP)');

      // JS function openSovereignIdCardModal populates public key and RFC 8032 signature validation
      expect(serverHtml).toContain('function openSovereignIdCardModal()');
      expect(serverHtml).toContain('✓ Valid RFC 8032 Ed25519 Signature');
    });
  });

  describe('4. Streamlined Social Statistics vs Node Telemetry', () => {
    it('keeps profile metric strip strictly social and decouples disk storage into Node Telemetry', () => {
      // Profile social stats row in profile header card
      const profileHeaderCardMatch = serverHtml.match(/<div class="profile-header-card">([\s\S]*?)<!-- Settings & Cryptographic Identity Cards/);
      expect(profileHeaderCardMatch).toBeTruthy();
      const profileHeaderCard = profileHeaderCardMatch![1];

      const statsRowMatch = profileHeaderCard.match(/<div class="profile-stats-row">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      expect(statsRowMatch).toBeTruthy();
      const statsRow = statsRowMatch![1];

      // Social stats: Feed Posts, Mutual Friends, Followers, Following
      expect(statsRow).toContain('Feed Posts');
      expect(statsRow).toContain('id="meFeedPostsCount"');
      expect(statsRow).toContain('Mutual Friends');
      expect(statsRow).toContain('id="meFriendsCount"');
      expect(statsRow).toContain('Followers');
      expect(statsRow).toContain('id="meFollowersCount"');
      expect(statsRow).toContain('Following');
      expect(statsRow).toContain('id="meFollowingCount"');

      // Disk storage is NOT in the social metric strip
      expect(statsRow).not.toContain('id="meStorageUsage"');
      expect(statsRow).not.toContain('id="meSeededBytes"');
      expect(statsRow).not.toContain('id="meBlocksCount"');

      // Disk storage is in Node Diagnostics & Telemetry card
      const diagnosticsCardMatch = serverHtml.match(/<div class="card profile-telemetry-card" id="nodeDiagnosticsCard">([\s\S]*?)<\/div>\s*<\/div>/);
      expect(diagnosticsCardMatch).toBeTruthy();
      const diagnosticsCard = diagnosticsCardMatch![1];

      expect(diagnosticsCard).toContain('id="meStorageUsage"');
      expect(diagnosticsCard).toContain('id="meSeededBytes"');
      expect(diagnosticsCard).toContain('id="meBlocksCount"');
      expect(diagnosticsCard).toContain('P2P Node Diagnostics &amp; Storage');
    });
  });
});
