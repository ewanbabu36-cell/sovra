/**
 * @file tests/e2e/sovereign-social-parity.test.ts
 * SOVRA BIG-TECH PARITY SUITE (Instagram Stories, WhatsApp Voice Memos, Twitter/X Trending, Biometric Shield)
 *
 * Verifies:
 * 1. Instagram & WhatsApp Stories Parity:
 *    - #sovereignStoriesBar container with creator story rings and unread gradient borders
 *    - #sovereignStoryViewerModal multi-segment story viewer with progress segments, timers, replies, and dual-ID fallback
 *    - closeStory() and launchStoryViewer() integration with sovereignStoryViewerModal and storyModalOverlay
 * 2. WhatsApp Voice Memos Parity:
 *    - #chatVoiceMemoBtn with hold-to-record (pointerdown/pointerup) and tap-to-record triggers
 *    - #chatVoiceMemoRecorder drawer with blinking indicator, live waveform bars, timer, cancel, and send
 *    - Dual-ID resolution compatibility (chatVoiceMemoRecorder & voiceRecordingDrawer)
 * 3. Twitter/X Mesh Trending Topics Parity:
 *    - #meshTrendingTopics section inside #omniSearchModal
 *    - Gossip-ranked chips (#Web3, #P2P, #Sovra4K, #ZeroCensorship, #SovereignIdentity) with post counters
 *    - applyMeshTrendingTopic() integration with omniSearchInput and filterOmniSearch()
 * 4. Biometric App Shield Parity:
 *    - #biometricAppShield hardware-backed WebAuthn modal dialog
 *    - UI elements: #biometricShieldTitle, #biometricShieldDesc, #biometricVerifyBtn, #biometricShieldFeedback
 *    - JavaScript security gate: triggerBiometricShield(), verifyBiometricAppShield(), cancelBiometricAppShield()
 *    - Biometric protection on openFullPageWallet()
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('SOVRA Big-Tech Parity Suite: Stories, Voice Memos, Mesh Trending & Biometric Shield', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const serverContent = fs.readFileSync(devServerPath, 'utf8');

  describe('1. Instagram & WhatsApp Stories Parity', () => {
    it('renders #sovereignStoriesBar with creator story rings and unread gradient borders', () => {
      // Must contain stories bar container with sovereign id
      expect(serverContent).toContain('id="sovereignStoriesBar"');

      // Stories bar should contain creator avatars and story rings
      expect(serverContent).toContain('class="story-ring"');
      expect(serverContent).toContain('id="myStoryRing"');
      expect(serverContent).toContain('launchStoryViewer');

      // Check for user/creator story representations
      expect(serverContent).toContain('Your Story');
    });

    it('renders #sovereignStoryViewerModal with multi-segment viewer and backward compatibility', () => {
      // Container modal
      expect(serverContent).toContain('id="sovereignStoryViewerModal"');
      expect(serverContent).toContain('data-legacy-id="storyModalOverlay"');

      // Progress bars and segmented viewer
      expect(serverContent).toContain('id="storySegmentsHeader"');
      expect(serverContent).toContain('class="story-segments-header"');
      expect(serverContent).toContain('class="story-segment-track"');
      expect(serverContent).toContain('class="story-segment-fill"');

      // Media, creator info, encrypted reply input, close button
      expect(serverContent).toContain('id="storyModalText"');
      expect(serverContent).toContain('id="storyModalAuthor"');
      expect(serverContent).toContain('id="storyReplyInput"');
      expect(serverContent).toContain('onclick="closeStory(event)"');
    });

    it('implements dual-ID resolution in launchStoryViewer and closeStory', () => {
      // launchStoryViewer dual resolution
      expect(serverContent).toMatch(/document\.getElementById\(['"]sovereignStoryViewerModal['"]\)\s*\|\|\s*document\.getElementById\(['"]storyModalOverlay['"]\)/);

      // closeStory dual resolution
      expect(serverContent).toMatch(/function\s+closeStory\s*\([a-zA-Z0-9_]*\)\s*\{[\s\S]*?sovereignStoryViewerModal[\s\S]*?storyModalOverlay/);

      // openOverlays stack includes both selectors
      expect(serverContent).toContain("'#sovereignStoryViewerModal'");
      expect(serverContent).toContain("'#storyModalOverlay'");
    });

    it('supports video stories and file input accept attributes for both images and videos', () => {
      // Input accepting images and videos
      expect(serverContent).toContain('accept="image/*,video/*"');
      expect(serverContent).toContain('id="realStoryFileInput"');

      // Video playback element in story modal
      expect(serverContent).toContain('id="storyModalVideo"');

      // Story upload script handles video
      expect(serverContent).toMatch(/handleRealStoryUpload[\s\S]*?isVideo/);
    });
  });

  describe('2. WhatsApp Voice Memos Parity', () => {
    it('renders #chatVoiceMemoBtn with hold-to-record and tap-to-record triggers', () => {
      expect(serverContent).toContain('id="chatVoiceMemoBtn"');
      expect(serverContent).toContain('data-legacy-id="micBtn"');
      expect(serverContent).toContain('aria-label="Record Voice"');
      expect(serverContent).toContain('title="Hold or Click to Record Voice Note"');
      expect(serverContent).toContain('onclick="toggleVoiceRecord()"');
      expect(serverContent).toContain('onpointerdown="startVoiceHoldRecord(event)"');
      expect(serverContent).toContain('onpointerup="finishVoiceHoldRecord(event)"');
    });

    it('renders #chatVoiceMemoRecorder with live waveforms and recording timer', () => {
      expect(serverContent).toContain('id="chatVoiceMemoRecorder"');
      expect(serverContent).toContain('data-legacy-id="voiceRecordingDrawer"');
      expect(serverContent).toContain('class="record-blinking-dot"');
      expect(serverContent).toContain('id="voiceRecordTimer"');
      expect(serverContent).toContain('class="record-live-waves"');
      expect(serverContent).toContain('class="record-wave-bar"');
      expect(serverContent).toContain('onclick="cancelVoiceRecord()"');
      expect(serverContent).toContain('onclick="finishAndSendVoiceRecord()"');
    });

    it('provides startVoiceHoldRecord and finishVoiceHoldRecord handlers in client script', () => {
      expect(serverContent).toContain('function startVoiceHoldRecord(');
      expect(serverContent).toContain('function finishVoiceHoldRecord(');
      expect(serverContent).toContain('_voiceHoldTimeout');
      expect(serverContent).toContain('_isVoiceHoldMode');

      // Dual-ID resolution in voice recording logic
      expect(serverContent).toMatch(/document\.getElementById\(['"]chatVoiceMemoRecorder['"]\)\s*\|\|\s*document\.getElementById\(['"]voiceRecordingDrawer['"]\)/);
    });
  });

  describe('3. Twitter/X Mesh Trending Topics Parity', () => {
    it('renders #meshTrendingTopics inside #omniSearchModal under recent searches', () => {
      expect(serverContent).toContain('id="meshTrendingTopics"');
      expect(serverContent).toContain('Mesh Trending Topics');
      expect(serverContent).toContain('across P2P mesh');

      // Contains gossip-ranked chips
      expect(serverContent).toContain('onclick="applyMeshTrendingTopic(\'#Web3\')"');
      expect(serverContent).toContain('onclick="applyMeshTrendingTopic(\'#P2P\')"');
      expect(serverContent).toContain('onclick="applyMeshTrendingTopic(\'#Sovra4K\')"');
      expect(serverContent).toContain('onclick="applyMeshTrendingTopic(\'#ZeroCensorship\')"');
      expect(serverContent).toContain('onclick="applyMeshTrendingTopic(\'#SovereignIdentity\')"');
    });

    it('provides applyMeshTrendingTopic() helper connected to filterOmniSearch()', () => {
      expect(serverContent).toContain('function applyMeshTrendingTopic(topic)');
      expect(serverContent).toMatch(/function\s+applyMeshTrendingTopic\s*\([a-zA-Z0-9_]*\)\s*\{[\s\S]*?omniSearchInput[\s\S]*?filterOmniSearch/);
    });
  });

  describe('4. Biometric App Shield Parity', () => {
    it('renders #biometricAppShield hardware-backed modal dialog', () => {
      expect(serverContent).toContain('id="biometricAppShield"');
      expect(serverContent).toContain('id="biometricShieldTitle"');
      expect(serverContent).toContain('id="biometricShieldDesc"');
      expect(serverContent).toContain('id="biometricVerifyBtn"');
      expect(serverContent).toContain('id="biometricShieldFeedback"');
      expect(serverContent).toContain('onclick="verifyBiometricAppShield()"');
      expect(serverContent).toContain('onclick="cancelBiometricAppShield()"');
    });

    it('implements triggerBiometricShield, verifyBiometricAppShield, and cancelBiometricAppShield in client script', () => {
      expect(serverContent).toContain('function triggerBiometricShield(');
      expect(serverContent).toContain('async function verifyBiometricAppShield()');
      expect(serverContent).toContain('function cancelBiometricAppShield()');
      expect(serverContent).toContain('PublicKeyCredential');
    });

    it('guards openFullPageWallet with triggerBiometricShield', () => {
      expect(serverContent).toMatch(/function\s+openFullPageWallet\s*\(\)\s*\{[\s\S]*?triggerBiometricShield/);
    });

    it('provides confidential chat biometric shield button and toggleConfidentialChatLock', () => {
      expect(serverContent).toContain('id="chatConfidentialShieldBtn"');
      expect(serverContent).toContain('onclick="toggleConfidentialChatLock()"');
      expect(serverContent).toContain('function toggleConfidentialChatLock(');
      expect(serverContent).toContain('function updateConfidentialShieldUi(');
      expect(serverContent).toContain('confidentialChatDids');
    });

    it('guards selectContact with triggerBiometricShield for confidential chats', () => {
      expect(serverContent).toMatch(/function\s+selectContact\s*\([a-zA-Z0-9_,\s]*\)\s*\{[\s\S]*?isConfidential[\s\S]*?triggerBiometricShield/);
    });
  });
});

