import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

const SAMPLE_PHOTO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const SAMPLE_VIDEO_DATA_URL =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhmZGF0AAAACm1vb3Y=';

describe('Multi-Format Feed Post System (Tweet / Reddit / Photo / Video / Canvas)', () => {
  let sessionToken: string;
  let userDid: string;

  it('registers a sovereign user to publish multi-format posts', async () => {
    const res = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@author_${Date.now()}`,
        name: 'Creator Node',
        bio: 'Multi-format post author',
        device: 'Laptop',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    sessionToken = data.sessionToken;
    userDid = data.user.did;
  });

  it('publishes a native clean text post (Tweet / Reddit style) with ZERO placeholder image boxes', async () => {
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Namaste India! Sovereign P2P mesh network is live.',
        tags: '#india #freedom #p2p',
        postType: 'text',
      }),
    });

    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    expect(postData.post).toBeDefined();
    expect(postData.post.postType).toBe('text');
    expect(postData.post.mediaImage).toBeUndefined();
    expect(postData.post.mediaVideo).toBeUndefined();
    expect(postData.post.caption).toBe('Namaste India! Sovereign P2P mesh network is live.');

    // Fetch the home page and verify how the card is rendered
    const htmlRes = await fetch(`${BASE_URL}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();

    // Verify card exists
    const cardSnippet = html.slice(html.indexOf(`id="card-${postData.post.id}"`));
    const cardEnd = cardSnippet.indexOf('</article>');
    const cardHtml = cardSnippet.slice(0, cardEnd);

    // Assert that the text is front-and-center in feed-post-text-body
    expect(cardHtml).toContain('class="feed-post-text-body"');
    expect(cardHtml).toContain('Namaste India! Sovereign P2P mesh network is live.');

    // Assert that NO placeholder box exists in this card
    expect(cardHtml).not.toContain('class="insta-media-box text-only"');
    expect(cardHtml).not.toContain('P2P GossipSub Swarm Live Packet Sync');
  });

  it('renders existing text posts (like "hello india") as clean text posts without fake rocket banners', async () => {
    const htmlRes = await fetch(`${BASE_URL}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();

    if (html.includes('id="card-feed-1791279058808"')) {
      const cardSnippet = html.slice(html.indexOf('id="card-feed-1791279058808"'));
      const cardEnd = cardSnippet.indexOf('</article>');
      const cardHtml = cardSnippet.slice(0, cardEnd);

      // Verify "hello india" is rendered cleanly
      expect(cardHtml).toContain('hello india');
      expect(cardHtml).toContain('class="feed-post-text-body"');

      // Crucial: Must NOT contain the 320px text-only rocket banner
      expect(cardHtml).not.toContain('class="insta-media-box text-only"');
      expect(cardHtml).not.toContain('P2P GossipSub Swarm Live Packet Sync');
    }
  });

  it('publishes a photo post and renders the image container with #000000 background', async () => {
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Sunset photo captured on peer mesh',
        tags: '#photography #sovra',
        postType: 'photo',
        mediaImage: SAMPLE_PHOTO_DATA_URL,
      }),
    });

    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    expect(postData.post.postType).toBe('photo');
    expect(postData.post.mediaImage).toBeDefined();

    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${postData.post.id}"`));
    const cardEnd = cardSnippet.indexOf('</article>');
    const cardHtml = cardSnippet.slice(0, cardEnd);

    expect(cardHtml).toContain('class="insta-media-box has-image"');
    expect(cardHtml).toContain('background: #000000');
    expect(cardHtml).toContain('alt="Feed photo"');
  });

  it('publishes a video reel post and renders HTML5 video controls player', async () => {
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'First sovereign 60fps reel broadcast',
        tags: '#reel #video #p2p',
        postType: 'video',
        mediaVideo: SAMPLE_VIDEO_DATA_URL,
      }),
    });

    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    expect(postData.post.postType).toBe('video');
    expect(postData.post.mediaVideo).toBeDefined();

    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${postData.post.id}"`));
    const cardEnd = cardSnippet.indexOf('</article>');
    const cardHtml = cardSnippet.slice(0, cardEnd);

    expect(cardHtml).toContain('class="insta-media-box has-video"');
    expect(cardHtml).toContain('<video src=');
    expect(cardHtml).toContain('controls playsinline');
    expect(cardHtml).toContain('🎬 REEL &bull; CID:');
  });

  it('publishes a color card status post and renders user text centered in bold', async () => {
    const gradient = 'linear-gradient(135deg, #064e3b 0%, #047857 100%)';
    const postRes = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Thinking about zero-knowledge routing tonight!',
        tags: '#privacy #zk',
        postType: 'canvas',
        mediaGradient: gradient,
      }),
    });

    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.ok).toBe(true);
    expect(postData.post.postType).toBe('canvas');
    expect(postData.post.mediaGradient).toBe(gradient);

    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${postData.post.id}"`));
    const cardEnd = cardSnippet.indexOf('</article>');
    const cardHtml = cardSnippet.slice(0, cardEnd);

    expect(cardHtml).toContain('class="insta-media-box canvas-mode"');
    expect(cardHtml).toContain('Thinking about zero-knowledge routing tonight!');
  });
});
