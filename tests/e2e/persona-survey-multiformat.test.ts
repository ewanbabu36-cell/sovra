import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Author Persona Selector & Multi-Format (Post, Reel, Poll, Survey, Q&A) Production Suite', () => {
  let sessionToken: string;
  let userDid: string;

  it('registers a sovereign author node to test publishing workflows', async () => {
    const res = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@persona_author_${Date.now()}`,
        name: 'Persona Author Node',
        bio: 'Testing persona and multi-format feeds',
        device: 'Workstation',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    sessionToken = data.sessionToken;
    userDid = data.user.did;
  });

  it('renders author persona dropdown (Personal, Pages, Channels) and all format tabs in HTML', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Verify format tabs
    expect(html).toContain('id="tabBtnText"');
    expect(html).toContain('id="tabBtnPhoto"');
    expect(html).toContain('id="tabBtnVideo"');
    expect(html).toContain('id="tabBtnPoll"');
    expect(html).toContain('id="tabBtnSurvey"');
    expect(html).toContain('id="tabBtnQa"');
    expect(html).toContain('id="tabBtnArticle"');
    expect(html).toContain('id="tabBtnMood"');
    expect(html).toContain('id="tabBtnCanvas"');

    // Verify author persona switcher elements
    expect(html).toContain('id="composerAuthorSelect"');
    expect(html).toContain('id="composerAuthorAvatar"');
    expect(html).toContain('id="composerEntityBadge"');
    expect(html).toContain('id="composerEntityHandle"');

    // Verify optgroups for Personal, Pages, Channels
    expect(html).toContain('label="👤 Personal Account"');
    expect(html).toContain('label="📄 Sovereign Pages"');
    expect(html).toContain('label="📢 Broadcast Channels"');

    // Verify survey inputs container
    expect(html).toContain('id="feedSurveyInputsContainer"');
    expect(html).toContain('id="feedSurveyTitle"');
    expect(html).toContain('id="feedSurveyQ1"');
    expect(html).toContain('id="feedSurveyQ2"');
    expect(html).toContain('id="feedSurveyQ3"');
  });

  it('publishes as a Sovereign Page with page identity and badge-page', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'Fresh batch of dark roast Ethiopian beans available at Metropolis Coffee!',
        tags: '#coffee #local #p2p',
        postType: 'text',
        authorType: 'page',
        authorEntityId: 'pg-metropolis',
        authorBadge: '📄 Page',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.post).toBeDefined();
    expect(data.post.authorType).toBe('page');
    expect(data.post.authorName).toBe('Metropolis Roastery');
    expect(data.post.authorBadge).toBe('📄 Page');
    expect(data.post.authorEntityHandle).toBe('@metropolis_coffee');

    // Check rendered HTML
    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${data.post.id}"`));
    const cardHtml = cardSnippet.slice(0, cardSnippet.indexOf('</article>'));

    expect(cardHtml).toContain('badge-page');
    expect(cardHtml).toContain('📄 Page');
    expect(cardHtml).toContain('@metropolis_coffee');
    expect(cardHtml).toContain('Metropolis Roastery');
  });

  it('publishes as a Broadcast Channel with channel identity and badge-channel', async () => {
    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        caption: 'BREAKING: Global peer count reaches new high across 42 sovereign subnets.',
        tags: '#news #broadcast #mesh',
        postType: 'text',
        authorType: 'channel',
        authorEntityId: 'ch-news',
        authorBadge: '📢 Channel',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.post).toBeDefined();
    expect(data.post.authorType).toBe('channel');
    expect(data.post.authorName).toBe('Global Mesh Dispatches');
    expect(data.post.authorBadge).toBe('📢 Channel');
    expect(data.post.authorEntityHandle).toBe('@decentral_news');

    // Check rendered HTML
    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${data.post.id}"`));
    const cardHtml = cardSnippet.slice(0, cardSnippet.indexOf('</article>'));

    expect(cardHtml).toContain('badge-channel');
    expect(cardHtml).toContain('📢 Channel');
    expect(cardHtml).toContain('@decentral_news');
    expect(cardHtml).toContain('Global Mesh Dispatches');
  });

  it('publishes a dynamic Community Survey and records cryptographic responses', async () => {
    const surveyPayload = {
      caption: 'Community Survey: Sovereign Relay Node Satisfaction',
      postType: 'survey',
      authorType: 'personal',
      surveyData: {
        title: 'Sovereign Relay Node Satisfaction 2026',
        questions: [
          {
            id: 'q1',
            prompt: 'How is your connection stability over BLE/Direct P2P?',
            type: 'choice',
            options: [
              '⭐⭐⭐⭐⭐ Blazing Fast (< 5ms latency)',
              '⭐⭐⭐ Stable with Relay Hops',
              '⭐ High Latency / Packet Drops',
            ],
          },
        ],
        responses: {},
      },
    };

    const res = await fetch(`${BASE_URL}/api/feed/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(surveyPayload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.post).toBeDefined();
    expect(data.post.postType).toBe('survey');
    expect(data.post.surveyData).toBeDefined();
    expect(data.post.surveyData.title).toBe('Sovereign Relay Node Satisfaction 2026');

    const postId = data.post.id;

    // Verify rendered survey card in HTML
    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    const cardSnippet = html.slice(html.indexOf(`id="card-${postId}"`));
    const cardHtml = cardSnippet.slice(0, cardSnippet.indexOf('</article>'));

    expect(cardHtml).toContain('📋 COMMUNITY SURVEY');
    expect(cardHtml).toContain('Sovereign Relay Node Satisfaction 2026');
    expect(cardHtml).toContain('Blazing Fast');
    expect(cardHtml).toContain('Stable with Relay Hops');

    // Cast a vote in the survey
    const voteRes = await fetch(`${BASE_URL}/api/feed/vote-survey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        postId: postId,
        questionId: 'q1',
        choice: '⭐⭐⭐⭐⭐ Blazing Fast (< 5ms latency)',
      }),
    });

    expect(voteRes.status).toBe(200);
    const voteData = await voteRes.json();
    expect(voteData.ok).toBe(true);
    expect(voteData.surveyData).toBeDefined();
    expect(voteData.surveyData.responses[userDid]).toBeDefined();

    // Verify updated tallies via feed list
    const listRes = await fetch(`${BASE_URL}/api/feed/list`);
    const listData = await listRes.json();
    const fetchedPost = listData.posts.find((p: any) => p.id === postId);
    expect(fetchedPost).toBeDefined();
    expect(fetchedPost.surveyData.responses[userDid].q1).toBe('⭐⭐⭐⭐⭐ Blazing Fast (< 5ms latency)');
  });
});
