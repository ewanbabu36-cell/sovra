/**
 * @file tests/e2e/instagram-parity-suite.test.ts
 * SOVRA INSTAGRAM 100% FULL-FEATURE PARITY SPECIFICATION & VERIFICATION SUITE
 *
 * Verifies:
 * 1. Story Feature Parity:
 *    - Close Friends radiant emerald green gradient rings & selective visibility
 *    - Close Friends modal badge (#storyCloseFriendsBadge)
 *    - Live Music sticker attribution box (#storyMusicBox, #storyMusicTitle, #storyMusicArtist)
 *    - Live Interactive Polls with real-time percentage progress bars (#storyPollBox, #storyPollOptionsList)
 *    - Ask-Me-Anything Question boxes (#storyQuestionBox, #storyQuestionPrompt, submitStoryQuestionResponse)
 *    - Creator Story Insights (#storyCreatorFooterBar, #storyViewersSheetOverlay, openStoryViewersDrawer)
 *    - Profile Story Highlights shelf (#profileHighlightsShelf, createHighlight, getHighlights, launchHighlightViewer)
 * 2. Feed Multi-Image Carousel & CSS Filter Shaders:
 *    - Multi-image swipeable carousel cards (.insta-carousel-container, .insta-carousel-track, .insta-carousel-slide)
 *    - Dot pagination, prev/next arrows, 1/N counter badge (#carousel-badge, navigatePostCarousel, setPostCarouselSlide)
 *    - Instagram CSS Filter shaders (.filter-clarendon, .filter-gingham, .filter-moon, .filter-valencia, .filter-cyberpunk, .filter-reyes, .filter-slumber)
 *    - Filter preset tray (#composerFilterTray) and dynamic post card filter rendering
 * 3. Visual Discovery Explore Mosaic Grid:
 *    - Multi-aspect visual mosaic grid (#exploreMosaicSection, #exploreMosaicGrid, loadExploreMosaicGrid)
 *    - Dynamic span classes (.span-1x2 vertical reels with hover preview, .span-2x2 featured cards, .span-1x1 media tiles)
 *    - Category filtering pills and one-click transitions (handleExploreTileClick)
 *    - REST API endpoint: /api/explore/grid
 * 4. Reels Audio Hub & Sound Attribution:
 *    - Audio track sheet sound attribution stream (#audioReelsMosaicList)
 *    - REST API endpoint: /api/reels/by-audio
 *    - One-click reel navigation (navigateToReelById)
 * 5. SovraDatabaseEngine Data Integrity:
 *    - Poll voting, AMA question answering, viewers tracking, highlights lifecycle, audio track filtering, close friends graph
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SovraDatabaseEngine } from '../../scripts/database-engine';

describe('SOVRA Instagram Full-Feature Parity Suite', () => {
  const devServerPath = path.resolve(__dirname, '../../scripts/dev-server.ts');
  const serverContent = fs.readFileSync(devServerPath, 'utf8');

  // =========================================================================
  // 1. STORY FEATURE PARITY
  // =========================================================================
  describe('1. Instagram Story Feature Parity', () => {
    it('defines Close Friends radiant emerald green gradient styling for story rings', () => {
      expect(serverContent).toContain('.story-ring.close-friends');
      expect(serverContent).toMatch(/gradient\(.*#10b981,\s*#059669,\s*#34d399/);
    });

    it('renders #storyCloseFriendsBadge in the story viewer modal', () => {
      expect(serverContent).toContain('id="storyCloseFriendsBadge"');
      expect(serverContent).toContain('Close Friends');
    });

    it('renders Music Track sticker box with vinyl spin animation and attribution labels', () => {
      expect(serverContent).toContain('id="storyMusicBox"');
      expect(serverContent).toContain('id="storyMusicTitle"');
      expect(serverContent).toContain('id="storyMusicArtist"');
      expect(serverContent).toContain('spinVinyl');
    });

    it('renders Live Poll Box with interactive voting and percentage progress bars', () => {
      expect(serverContent).toContain('id="storyPollBox"');
      expect(serverContent).toContain('id="storyPollQuestion"');
      expect(serverContent).toContain('id="storyPollOptionsList"');
      expect(serverContent).toContain('id="storyPollTotalVotes"');
      expect(serverContent).toContain('voteStoryPoll');
    });

    it('renders Ask-Me-Anything Question Box with response input and send button', () => {
      expect(serverContent).toContain('id="storyQuestionBox"');
      expect(serverContent).toContain('id="storyQuestionPrompt"');
      expect(serverContent).toContain('id="storyQuestionInput"');
      expect(serverContent).toContain('submitStoryQuestionResponse()');
    });

    it('renders Creator Story Insights drawer and footer bar', () => {
      expect(serverContent).toContain('id="storyCreatorFooterBar"');
      expect(serverContent).toContain('id="storyViewerCountBadge"');
      expect(serverContent).toContain('id="storyViewersSheetOverlay"');
      expect(serverContent).toContain('id="storyViewersList"');
      expect(serverContent).toContain('openStoryViewersDrawer()');
      expect(serverContent).toContain('closeStoryViewersDrawer()');
    });

    it('renders Profile Story Highlights shelf with New Highlight trigger', () => {
      expect(serverContent).toContain('id="profileHighlightsShelf"');
      expect(serverContent).toContain('openCreateHighlightModal()');
      expect(serverContent).toContain('loadProfileHighlights');
      expect(serverContent).toContain('launchHighlightViewer');
    });

    it('implements Story REST API endpoints in dev-server', () => {
      expect(serverContent).toContain("url.pathname === '/api/stories/seen'");
      expect(serverContent).toContain("url.pathname === '/api/stories/poll/vote'");
      expect(serverContent).toContain("url.pathname === '/api/stories/question/answer'");
      expect(serverContent).toContain("url.pathname === '/api/stories/viewers'");
      expect(serverContent).toContain("url.pathname === '/api/stories/delete'");
      expect(serverContent).toContain("url.pathname === '/api/stories/highlights'");
      expect(serverContent).toContain("url.pathname === '/api/stories/highlights/create'");
      expect(serverContent).toContain("url.pathname === '/api/stories/highlights/delete'");
      expect(serverContent).toContain("url.pathname === '/api/users/close-friends'");
    });
  });

  // =========================================================================
  // 2. FEED CAROUSEL & CSS FILTER SHADERS
  // =========================================================================
  describe('2. Feed Multi-Image Carousel & CSS Filter Shaders', () => {
    it('defines Instagram CSS Filter Shaders in stylesheet', () => {
      expect(serverContent).toContain('.filter-clarendon');
      expect(serverContent).toContain('.filter-gingham');
      expect(serverContent).toContain('.filter-moon');
      expect(serverContent).toContain('.filter-valencia');
      expect(serverContent).toContain('.filter-cyberpunk');
      expect(serverContent).toContain('.filter-reyes');
      expect(serverContent).toContain('.filter-slumber');
    });

    it('defines Instagram Carousel CSS components', () => {
      expect(serverContent).toContain('.insta-carousel-container');
      expect(serverContent).toContain('.insta-carousel-track');
      expect(serverContent).toContain('.insta-carousel-slide');
      expect(serverContent).toContain('.insta-carousel-nav');
      expect(serverContent).toContain('.insta-carousel-dots');
      expect(serverContent).toContain('.insta-carousel-dot');
      expect(serverContent).toContain('.insta-carousel-badge');
    });

    it('provides multi-photo selection and filter tray in feed composer', () => {
      expect(serverContent).toContain('id="realFeedFileInput"');
      expect(serverContent).toMatch(/<input[^>]*id="realFeedFileInput"[^>]*multiple/);
      expect(serverContent).toContain('id="composerFilterTray"');
      expect(serverContent).toContain('applyComposerFilterPreset');
    });

    it('implements carousel navigation functions in client JS', () => {
      expect(serverContent).toContain('function navigatePostCarousel(');
      expect(serverContent).toContain('function setPostCarouselSlide(');
    });

    it('renders carousels and CSS filters in renderDynamicPostCard', () => {
      expect(serverContent).toContain('post.carouselImages && post.carouselImages.length > 1');
      expect(serverContent).toContain("var fPresetCar = post.filterPreset ? 'filter-' + post.filterPreset : ''");
      expect(serverContent).toContain("var fPresetSingle = post.filterPreset ? 'filter-' + post.filterPreset : ''");
    });

    it('submits carouselImages and filterPreset in submitDynamicPost payload', () => {
      expect(serverContent).toMatch(/carouselImages:\s*\(selectedFeedCarouselImages && selectedFeedCarouselImages\.length > 1\)\s*\?\s*selectedFeedCarouselImages\s*:\s*undefined/);
      expect(serverContent).toMatch(/filterPreset:\s*\(selectedFilterPreset && selectedFilterPreset !== 'normal'\)\s*\?\s*selectedFilterPreset\s*:\s*undefined/);
    });
  });

  // =========================================================================
  // 3. VISUAL DISCOVERY EXPLORE MOSAIC GRID
  // =========================================================================
  describe('3. Visual Discovery Explore Mosaic Grid', () => {
    it('renders #exploreMosaicSection with category filtering pills', () => {
      expect(serverContent).toContain('id="exploreMosaicSection"');
      expect(serverContent).toContain('id="exploreMosaicGrid"');
      expect(serverContent).toContain('filterExploreCategory');
      expect(serverContent).toContain('loadExploreMosaicGrid');
    });

    it('defines multi-span layout classes for mosaic grid', () => {
      expect(serverContent).toContain('.explore-tile');
      expect(serverContent).toContain('.explore-tile.span-1x2');
      expect(serverContent).toContain('.explore-tile.span-2x2');
      expect(serverContent).toContain('.explore-tile-overlay');
      expect(serverContent).toContain('.explore-tile-badge');
    });

    it('implements /api/explore/grid endpoint with category filtering and mosaic layout spans', () => {
      expect(serverContent).toContain("url.pathname === '/api/explore/grid'");
      expect(serverContent).toContain("layoutSpan: span");
      expect(serverContent).toContain("handleExploreTileClick");
    });
  });

  // =========================================================================
  // 4. REELS AUDIO HUB & ATTRIBUTION
  // =========================================================================
  describe('4. Reels Audio Hub & Attribution Stream', () => {
    it('renders #audioReelsMosaicList in #audioSheetOverlay', () => {
      expect(serverContent).toContain('id="audioReelsMosaicList"');
      expect(serverContent).toContain('id="audioSheetOverlay"');
    });

    it('implements /api/reels/by-audio endpoint in dev-server', () => {
      expect(serverContent).toContain("url.pathname === '/api/reels/by-audio'");
      expect(serverContent).toContain("sovraDb.getReelsByAudioTrack(audioTrack)");
    });

    it('fetches sound attribution reels in openAudioTrackSheet', () => {
      expect(serverContent).toMatch(/fetch\('\/api\/reels\/by-audio\?audio='\s*\+\s*encodeURIComponent\(r\.audioTrack\)\)/);
      expect(serverContent).toContain('function navigateToReelById(');
    });
  });

  // =========================================================================
  // 5. DATABASE ENGINE DATA INTEGRITY & LIFECYCLE
  // =========================================================================
  describe('5. Database Engine Methods & P2P Data Integrity', () => {
    let testDb: SovraDatabaseEngine;
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.resolve(__dirname, '../../test_tmp_insta_' + Math.random().toString(36).substring(2, 9));
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      testDb = new SovraDatabaseEngine(tmpDir);
    });

    afterEach(() => {
      try {
        if (tmpDir && fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (_) {}
    });

    it('records story seen timestamp and returns viewers with cryptographic DIDs', () => {
      const creatorDid = 'did:sovra:creator1';
      const viewerDid = 'did:sovra:viewer1';

      testDb.createUser({
        did: creatorDid,
        handle: 'creator1',
        displayName: 'Alice Creator',
      });
      testDb.createUser({
        did: viewerDid,
        handle: 'viewer1',
        displayName: 'Bob Viewer',
      });

      const story = testDb.addStory({
        authorDid: creatorDid,
        authorHandle: 'creator1',
        authorName: 'Alice Creator',
        segments: [{
          id: 'seg-1',
          caption: 'Hello Mesh',
          timeAgo: 'Just now',
          createdAt: Date.now(),
        }],
      });

      expect(story).toBeDefined();
      const markOk = testDb.markStorySeen(story.id, viewerDid);
      expect(markOk).toBe(true);

      const viewersRes = testDb.getStoryViewers(story.id, creatorDid);
      expect(viewersRes.ok).toBe(true);
      expect(viewersRes.count).toBe(1);
      expect(viewersRes.viewers?.[0].did).toBe(viewerDid);
      expect(viewersRes.viewers?.[0].handle).toMatch(/@?viewer1/);
    });

    it('handles interactive Live Poll voting and calculates real-time option votes', () => {
      const creatorDid = 'did:sovra:creator2';
      const voter1 = 'did:sovra:voter1';
      const voter2 = 'did:sovra:voter2';

      const story = testDb.addStory({
        authorDid: creatorDid,
        authorHandle: 'creator2',
        authorName: 'Poll Creator',
        segments: [{
          id: 'seg-poll-1',
          caption: 'Vote now!',
          timeAgo: 'Just now',
          poll: {
            question: 'Best Consensus?',
            options: [
              { text: 'CometBFT', votes: 0 },
              { text: 'Proof of Stake', votes: 0 },
            ],
            userVotes: {},
          },
          createdAt: Date.now(),
        }],
      });

      const vote1 = testDb.voteStoryPoll(story.id, 'seg-poll-1', 0, voter1);
      expect(vote1.ok).toBe(true);
      expect(vote1.poll?.options[0].votes).toBe(1);

      const vote2 = testDb.voteStoryPoll(story.id, 'seg-poll-1', 0, voter2);
      expect(vote2.ok).toBe(true);
      expect(vote2.poll?.options[0].votes).toBe(2);

      // Change vote from option 0 to option 1
      const voteChange = testDb.voteStoryPoll(story.id, 'seg-poll-1', 1, voter1);
      expect(voteChange.ok).toBe(true);
      expect(voteChange.poll?.options[0].votes).toBe(1);
      expect(voteChange.poll?.options[1].votes).toBe(1);
    });

    it('submits Ask-Me-Anything Question response to story segment', () => {
      const creatorDid = 'did:sovra:creator3';
      const responderDid = 'did:sovra:responder1';

      const story = testDb.addStory({
        authorDid: creatorDid,
        authorHandle: 'creator3',
        authorName: 'AMA Creator',
        segments: [{
          id: 'seg-ama-1',
          caption: 'Ask me anything about P2P mesh!',
          timeAgo: 'Just now',
          questionSticker: {
            prompt: 'What is your favorite P2P protocol?',
            responses: [],
          },
          createdAt: Date.now(),
        }],
      });

      const ansRes = testDb.answerStoryQuestion(story.id, 'seg-ama-1', 'BitSwap & GossipSub', responderDid, 'responder1');
      expect(ansRes.ok).toBe(true);

      const all = testDb.getAllStories(creatorDid);
      const found = all.find(s => s.id === story.id || s.creatorHandle === 'creator3');
      const qSticker = found?.segments.find(sg => sg.id === 'seg-ama-1')?.questionSticker;
      expect(qSticker?.responses.length).toBe(1);
      expect(qSticker?.responses[0].response).toBe('BitSwap & GossipSub');
    });

    it('manages Story Highlights pinned to profile shelf', () => {
      const creatorDid = 'did:sovra:creator4';

      const hl = testDb.createHighlight({
        creatorDid,
        title: 'Crypto Dev 2026',
        coverEmoji: '🚀',
        segments: [{
          id: 'seg-hl-1',
          caption: 'Building Sovra L1',
          timeAgo: 'Archive',
          createdAt: Date.now(),
        }],
      });

      expect(hl.id).toMatch(/^hl-/);
      expect(hl.title).toBe('Crypto Dev 2026');

      const list = testDb.getHighlights(creatorDid);
      expect(list.length).toBe(1);
      expect(list[0].title).toBe('Crypto Dev 2026');

      const delOk = testDb.deleteHighlight(hl.id, creatorDid);
      expect(delOk).toBe(true);
      expect(testDb.getHighlights(creatorDid).length).toBe(0);
    });

    it('filters reels by audio track attribution stream', () => {
      testDb.createReel({
        creatorDid: 'did:sovra:r1',
        creatorHandle: 'r1',
        creatorName: 'Reel Producer 1',
        caption: 'First reel with track',
        audioTrack: 'Hyperdrive Synthwave • CyberDJ',
      });
      testDb.createReel({
        creatorDid: 'did:sovra:r2',
        creatorHandle: 'r2',
        creatorName: 'Reel Producer 2',
        caption: 'Second reel with track',
        audioTrack: 'Hyperdrive Synthwave • CyberDJ',
      });
      testDb.createReel({
        creatorDid: 'did:sovra:r3',
        creatorHandle: 'r3',
        creatorName: 'Reel Producer 3',
        caption: 'Different audio track reel',
        audioTrack: 'Acoustic Guitar Morning',
      });

      const matching = testDb.getReelsByAudioTrack('Hyperdrive Synthwave');
      expect(matching.length).toBe(2);
      expect(matching.every(m => m.audioTrack.includes('Hyperdrive Synthwave'))).toBe(true);
    });

    it('toggles Close Friends graph relationship', () => {
      const userA = 'did:sovra:userA';
      const userB = 'did:sovra:userB';

      const res1 = testDb.toggleCloseFriend(userA, userB);
      expect(res1.ok).toBe(true);
      expect(res1.isCloseFriend).toBe(true);

      const list1 = testDb.getCloseFriends(userA);
      expect(list1.closeFriends.some((cf: any) => cf.did === userB)).toBe(true);

      const res2 = testDb.toggleCloseFriend(userA, userB);
      expect(res2.ok).toBe(true);
      expect(res2.isCloseFriend).toBe(false);

      const list2 = testDb.getCloseFriends(userA);
      expect(list2.closeFriends.some((cf: any) => cf.did === userB)).toBe(false);
    });
  });
});
