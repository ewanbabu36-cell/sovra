import { describe, it, expect } from 'vitest';

describe('Real-World Mobile Testing & Field Interaction Hardening', () => {
  const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';

  it('1. Story Viewer hold-to-pause vs tap duration filter is wired', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('_storyPressStartTime = Date.now()');
    expect(html).toContain('Date.now() - _storyPressStartTime > 220');
    expect(html).toContain('window.nextStorySegment = nextStorySegment');
    expect(html).toContain('window.prevStorySegment = prevStorySegment');
    expect(html).toContain('prevStorySegment()');
    expect(html).toContain('nextStorySegment()');
  });

  it('2. Feed double-tap to like vs single-tap lightbox debounce is wired', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('_mediaSingleTapTimeout');
    expect(html).toContain('_lastMediaTapPostId === postId && (now - _lastMediaTapTime < 220)');
    expect(html).toContain('handleFeedDoubleTap(postId, e)');
    expect(html).toContain('openPhotoLightboxById(postId)');
  });

  it('3. Hardware back button (popstate) modal stack covers all active overlays', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('hideVideoUploadProgressHUD()');
    expect(html).toContain('declineIncomingCall()');
    expect(html).toContain('minimizeSpatialCallToPip()');
    expect(html).toContain('closeViewOnceModal()');
    expect(html).toContain('closeTierModal()');
    expect(html).toContain('closeOnboardingModal()');
  });

  it('4. Guest mode guards are applied to stories, tipping, channels and studio releases', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("checkGuestWriteAction('create stories')");
    expect(html).toContain("checkGuestWriteAction('react to stories')");
    expect(html).toContain("checkGuestWriteAction('launch video channels')");
    expect(html).toContain("checkGuestWriteAction('launch organization pages')");
    expect(html).toContain("checkGuestWriteAction('tip creators with SOV')");
    expect(html).toContain("checkGuestWriteAction('publish video releases')");
  });

  it('5. Native mobile pull-to-refresh spring gesture indicator is in DOM and initialized', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('id="feedStreamContainer"');
    expect(html).toContain('id="feedPullToRefreshIndicator"');
    expect(html).toContain('id="pullRefreshSpinner"');
    expect(html).toContain('id="pullRefreshText"');
    expect(html).toContain('window.initFeedPullToRefresh = initFeedPullToRefresh');
    expect(html).toContain('syncPeersAndContacts()');
  });

  it('6. Ambient in-feed LAN peer pill is present and polling is wired', async () => {
    const res = await fetch(`${SERVER_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('id="ambientLanPeerPill"');
    expect(html).toContain('id="ambientLanPeerPillLabel"');
    expect(html).toContain('id="ambientLanPeerActionBtn"');
    expect(html).toContain('window.fetchAndUpdateAmbientLanPeers = fetchAndUpdateAmbientLanPeers');
    expect(html).toContain('openDirectChatWithUser(first.did, first.name, first.handle)');
  });

  it('7. Node health status endpoint responds with healthy JSON state', async () => {
    const res = await fetch(`${SERVER_URL}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(['ok', 'online']).toContain(data.status);
    expect(data.did).toBeDefined();
  });
});
