import { describe, it, expect } from 'vitest';
import {
  createReelsSwarmSession,
  createE2EEMessengerSession,
  createChannelFeedSession,
  createPasskeySessionManager,
  renderReelsViewportHtml,
  renderHlsPlayerProHtml,
  renderChatBubbleHtml,
  getTickIcon,
  renderStoriesCarouselHtml,
  DEFAULT_REELS_GESTURE_CONFIG,
} from '../src/index.js';
import type { ReelDescriptor } from '@sovra/storage';
import type { VirtualChannelHop } from '@sovra/protocol';

describe('Frontend Client Architecture (React/Next.js Technical Roadmap)', () => {
  const sampleReels: ReelDescriptor[] = [
    {
      reelId: 'reel-1',
      creatorDid: 'did:sovra:alice_peer',
      creatorHandle: 'alice',
      manifestCid: 'bafybei_reel_manifest_1',
      segment0Cid: 'bafybei_seg0_reel_1',
      caption: 'P2P Reels running with 60fps snap scroll! #reels',
      tags: ['#reels', '#p2p'],
      audioTrackTitle: 'Original Audio - alice',
      durationSeconds: 15,
      initialLikesCount: 1420,
      initialCommentsCount: 38,
      backgroundGradient: 'linear-gradient(135deg, #1e1b4b, #312e81)',
    },
    {
      reelId: 'reel-2',
      creatorDid: 'did:sovra:bob_peer',
      creatorHandle: 'bob',
      manifestCid: 'bafybei_reel_manifest_2',
      segment0Cid: 'bafybei_seg0_reel_2',
      caption: 'BitSwap pre-warm delivers <= 250ms first frame decode! 🚀',
      tags: ['#bitswap', '#swarm'],
      audioTrackTitle: 'Cyber Beat - bob',
      durationSeconds: 22,
      initialLikesCount: 980,
      initialCommentsCount: 19,
      backgroundGradient: 'linear-gradient(135deg, #064e3b, #047857)',
    },
    {
      reelId: 'reel-3',
      creatorDid: 'did:sovra:carol_peer',
      creatorHandle: 'carol',
      manifestCid: 'bafybei_reel_manifest_3',
      segment0Cid: 'bafybei_seg0_reel_3',
      caption: 'Spatial multi-track audio synced to video track 🎧',
      tags: ['#spatial', '#flac'],
      audioTrackTitle: 'Echoes - Carol',
      durationSeconds: 18,
      initialLikesCount: 2310,
      initialCommentsCount: 84,
      backgroundGradient: 'linear-gradient(135deg, #831843, #be185d)',
    },
  ];

  describe('1. useReelsSwarm Hook & ReelsViewport UI', () => {
    it('manages speculative Segment 0 pre-warming and sub-250ms decode SLA', () => {
      const session = createReelsSwarmSession(sampleReels, 0);

      expect(session.activeIndex).toBe(0);
      expect(session.activeReel.reelId).toBe('reel-1');
      expect(session.isPreWarmed).toBe(true);
      expect(session.decodeLatencyMs).toBeLessThanOrEqual(25); // 14ms memory decode
      expect(session.preWarmedNextReelIds).toContain('reel-1');
      expect(session.preWarmedNextReelIds).toContain('reel-2');

      // Swipe up to next reel
      const nextState = session.nextReel();
      expect(nextState.activeIndex).toBe(1);
      expect(session.activeReel.reelId).toBe('reel-2');
      expect(session.isPreWarmed).toBe(true);
      expect(session.preWarmedNextReelIds).toContain('reel-3');
    });

    it('handles double-tap gesture and optimistic CRDT reaction', () => {
      const session = createReelsSwarmSession(sampleReels, 0);
      const initialLikes = session.likesCount;
      const now = 1000000;

      // Double-tap with 150ms interval (50ms < elapsed <= 300ms)
      session.handleTap(150, 300, now);
      const tap2 = session.handleTap(150, 300, now + 150);

      expect(tap2.isHeartSpawned).toBe(true);
      expect(session.isLiked).toBe(true);
      expect(session.likesCount).toBe(initialLikes + 1);
    });

    it('renders ReelsViewport HTML with snap scroll contract', () => {
      const html = renderReelsViewportHtml({
        reelId: 'reel-1',
        creatorHandle: 'alice',
        caption: 'Snap scroll reel',
        audioTrack: 'Original Audio',
        likesCount: 1420,
        commentsCount: 38,
        isPreWarmed: true,
        decodeLatencyMs: 14,
      });

      expect(html).toContain('scroll-snap-type: y mandatory');
      expect(html).toContain('Pre-Warmed (14ms decode)');
      expect(html).toContain('@alice');
      expect(DEFAULT_REELS_GESTURE_CONFIG.snapType).toBe('y mandatory');
    });
  });

  describe('2. useE2EEMessenger Hook & ChatConversation UI', () => {
    const aliceDid = 'did:sovra:alice_device_1';
    const bobDid = 'did:sovra:bob_device_2';

    it('manages Double Ratchet dispatch and 3-phase delivery ticks via GossipAckVerifier', () => {
      const messenger = createE2EEMessengerSession(aliceDid, bobDid);

      // Phase 1: Sent (Single Grey Tick ✓)
      const msg = messenger.sendText('Hey Bob, sovereign Signal-grade E2EE test');
      expect(msg.state).toBe('sent');
      expect(msg.senderDid).toBe(aliceDid);

      // Phase 2: Delivered (Double Grey Tick ✓✓)
      const delivered = messenger.markDelivered(msg.id);
      expect(delivered).toBe(true);
      expect(messenger.messages.find(m => m.id === msg.id)?.state).toBe('delivered');

      // Phase 3: Read (Blue Double Tick ✓✓)
      const read = messenger.markRead(msg.id);
      expect(read).toBe(true);
      expect(messenger.messages.find(m => m.id === msg.id)?.state).toBe('read');
    });

    it('dispatches voice note with waveform amplitudes and computes 60-digit safety numbers', () => {
      const messenger = createE2EEMessengerSession(aliceDid, bobDid);
      const waveform = [15, 45, 90, 65, 30, 85, 50, 20];
      const voice = messenger.sendVoice(4.2, waveform);

      expect(voice.isAudio).toBe(true);
      expect(voice.audioMetadata?.durationSec).toBe(4.2);
      expect(voice.audioMetadata?.waveformBars).toEqual(waveform);

      const safety = messenger.safetyNumbers;
      expect(safety.formattedNumbers.split(' ').length).toBe(12); // 12 blocks of 5 digits
      expect(safety.qrPayload).toContain('sovra:safety:');
    });

    it('purges disappearing messages after duration', () => {
      const messenger = createE2EEMessengerSession(aliceDid, bobDid);
      messenger.setDisappearingTimer(5); // 5s timer

      const msg = messenger.sendText('Ephemeral secrets');
      expect(msg.disappearingDurationSec).toBe(5);
      expect(msg.expiresAt).toBeDefined();

      // Before expiry
      const purgedBefore = messenger.purgeExpired();
      expect(purgedBefore.length).toBe(0);

      // Manually set past expiration
      if (msg.expiresAt) msg.expiresAt = Date.now() - 1000;
      const purgedAfter = messenger.purgeExpired();
      expect(purgedAfter.length).toBe(1);
      expect(messenger.messages[0]?.text).toContain('💨 This message has disappeared');
    });

    it('renders chat bubble with correct tick colors', () => {
      const tickSent = getTickIcon('sent');
      expect(tickSent.icon).toBe('✓');
      expect(tickSent.color).toBe('#8696a0');

      const tickDelivered = getTickIcon('delivered');
      expect(tickDelivered.icon).toBe('✓✓');
      expect(tickDelivered.color).toBe('#8696a0');

      const tickRead = getTickIcon('read');
      expect(tickRead.icon).toBe('✓✓');
      expect(tickRead.color).toBe('#53bdeb'); // Electric blue

      const bubbleHtml = renderChatBubbleHtml({
        messageId: 'm1',
        isOutgoing: true,
        text: 'Encrypted message',
        timeString: '18:45',
        state: 'read',
      });
      expect(bubbleHtml).toContain('#53bdeb');
      expect(bubbleHtml).toContain('✓✓');
    });
  });

  describe('3. useChannelFeed Hook & HlsPlayerPro UI', () => {
    const video = {
      id: 'yt-1',
      title: 'P2P 4K Video Streaming Protocol Deep Dive',
      channelDid: 'did:sovra:channel_lab',
      channelName: 'Sovra Protocol Lab',
      durationSeconds: 860,
      manifestCid: 'bafybei_hls_manifest_4k',
      chapters: [
        { title: 'Introduction', startSeconds: 0, endSeconds: 120 },
        { title: 'ICE & CGNAT Traversal', startSeconds: 120, endSeconds: 400 },
        { title: 'BitSwap Swarm Architecture', startSeconds: 400, endSeconds: 860 },
      ],
    };

    const initialComments = [
      {
        id: 'c1',
        authorName: 'Dave',
        authorDid: 'did:sovra:dave',
        text: 'Great explanation of NAT traversal!',
        timestamp: 1000,
        likes: 12,
        replies: [],
      },
      {
        id: 'c2',
        authorName: 'Carol (Super Supporter)',
        authorDid: 'did:sovra:carol',
        text: 'Super Thanks for the open source code!',
        timestamp: 2000,
        likes: 5,
        isSuperThanks: true,
        superThanksAmount: '₹500',
        replies: [],
      },
    ];

    it('evaluates dynamic ABR based on buffer health B(t) and sorts comments', () => {
      const feed = createChannelFeedSession(video, initialComments);

      // Critical buffer: 1.2s -> 360p fallback
      const decision1 = feed.evaluateAbr(1.2, 3_000_000);
      expect(decision1.selectedResolution).toBe('360p');
      expect(feed.activeResolution).toBe('360p');

      // Healthy buffer: 9.5s & 10Mbps -> 1080p
      const decision2 = feed.evaluateAbr(9.5, 10_000_000);
      expect(decision2.selectedResolution).toBe('1080p');
      expect(feed.activeResolution).toBe('1080p');

      // Sort by Top (Super Thanks weighted higher)
      const topComments = feed.sortComments('top');
      expect(topComments[0]?.id).toBe('c2'); // c2 has super thanks

      // Sort by Newest (timestamp based)
      const newestComments = feed.sortComments('newest');
      expect(newestComments[0]?.id).toBe('c2');
    });

    it('plans off-chain state channel tip route via VirtualChannelMeshRouter', () => {
      const feed = createChannelFeedSession(video, initialComments);
      const hop: VirtualChannelHop = {
        channelId: 'ch-seeder-1',
        peerDid: 'did:sovra:seeder_node_1',
        localBalance: 1000n,
        remoteBalance: 200n,
        capacity: 1200n,
      };

      const quote = feed.sendTip(50n, hop);
      expect(quote.isFeasible).toBe(true);
      expect(quote.hops).toContain('ch-seeder-1');
    });

    it('renders HlsPlayerPro HTML with ambient glow and ABR controls', () => {
      const html = renderHlsPlayerProHtml({
        title: video.title,
        channelName: video.channelName,
        durationSeconds: video.durationSeconds,
        currentResolution: '1080p',
        isAutoAbr: true,
        bufferSeconds: 9.4,
        playbackSpeed: 1.0,
        isPiP: false,
      });

      expect(html).toContain('yt-ambient-glow');
      expect(html).toContain('1080p (Auto ABR)');
      expect(html).toContain('yt-scrubber');
    });
  });

  describe('4. usePasskeySession Hook & StoriesCarousel UI', () => {
    it('registers hardware biometric WebAuthn passkey and unlocks session', () => {
      const passkey = createPasskeySessionManager();
      expect(passkey.isUnlocked).toBe(false);

      const mockDevicePubkey = new Uint8Array(32).fill(0x7c);
      const cred = passkey.registerPasskey('did:sovra:user_alice', mockDevicePubkey, 'apple-secure-enclave');

      expect(cred.userHandleDid).toBe('did:sovra:user_alice');
      expect(cred.attestationFormat).toBe('apple-secure-enclave');
      expect(passkey.isUnlocked).toBe(true);
      expect(passkey.activeCredential?.credentialId).toBe(cred.credentialId);

      passkey.lockSession();
      expect(passkey.isUnlocked).toBe(false);

      passkey.unlockSession();
      expect(passkey.isUnlocked).toBe(true);
    });

    it('renders StoriesCarousel HTML with gradient unseen and grey seen rings', () => {
      const stories = [
        {
          creatorHandle: 'alice',
          creatorName: 'Alice',
          avatarEmoji: 'A',
          avatarBg: '#10b981',
          isSeen: false, // Unseen: gradient ring
          hoursRemaining: 23,
        },
        {
          creatorHandle: 'bob',
          creatorName: 'Bob',
          avatarEmoji: 'B',
          avatarBg: '#f59e0b',
          isSeen: true, // Seen: grey ring
          hoursRemaining: 18,
        },
      ];

      const html = renderStoriesCarouselHtml(stories);
      expect(html).toContain('story-alice');
      expect(html).toContain('story-bob');
      expect(html).toContain('Your Story');
    });
  });
});
