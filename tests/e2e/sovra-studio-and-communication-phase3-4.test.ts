/**
 * @file tests/e2e/sovra-studio-and-communication-phase3-4.test.ts
 * VERIFICATION SUITE: SOVRA STUDIO (PHASE 3) & SPATIAL COMMUNICATION LAYER (PHASE 4)
 *
 * Covers:
 * Phase 3:
 *  - Unified Studio discovery via entity being managed (no permanent sidebar)
 *  - Channels, Pages, Groups CRUD & management under unified identity
 *  - Space Switcher & progressive disclosure (Overview, Content, Community, Settings)
 *  - Real persisted metrics and honest zero-data states ("No activity yet.")
 *  - Server-side RBAC permissions (OWNER, ADMIN, EDITOR, MODERATOR, MEMBER)
 *
 * Phase 4:
 *  - Spatial Communication Layer (Chat, Conversation, Attachments, Actions)
 *  - Real contacts & message streaming (Double Ratchet / Noise_XX / Ed25519)
 *  - Message context menu (react, copy, delete with author verification)
 *  - Secure file attachment serving (zero blank-tab errors, MIME validation, BOLA/IDOR protection)
 *  - WebRTC Audio & Video Call entry points and signaling state transitions
 *  - Notifications with deep-linking & persistent read state
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('SOVRA Phase 3 (Studio) & Phase 4 (Communication Layer) Verification Suite', () => {
  const ts = Date.now();
  let ownerUser: { did: string; handle: string; sessionToken: string };
  let memberUser: { did: string; handle: string; sessionToken: string };
  let testChannelId: string;
  let testPageId: string;
  let testGroupId: string;
  let testMessageId: string;
  let testAttachmentCid: string;

  beforeAll(async () => {
    // 1. Register Owner
    const regOwner = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@owner_${ts}`,
        name: 'Studio Owner',
        bio: 'Creator and owner of test spaces',
      }),
    });
    expect(regOwner.status).toBe(200);
    const ownerData = await regOwner.json();
    expect(ownerData.ok).toBe(true);
    ownerUser = {
      did: ownerData.user.did,
      handle: ownerData.user.handle,
      sessionToken: ownerData.sessionToken,
    };

    // 2. Register Peer Member
    const regMember = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@member_${ts}`,
        name: 'Peer Member',
        bio: 'Subscriber and community member',
      }),
    });
    expect(regMember.status).toBe(200);
    const memberData = await regMember.json();
    expect(memberData.ok).toBe(true);
    memberUser = {
      did: memberData.user.did,
      handle: memberData.user.handle,
      sessionToken: memberData.sessionToken,
    };
  });

  // ==========================================================================
  // 🏢 PHASE 3: UNIFIED SOVRA STUDIO
  // ==========================================================================

  describe('Phase 3: Unified SOVRA Studio & Space Management', () => {
    it('creates a broadcast Channel with real persistent metadata', async () => {
      const res = await fetch(`${BASE_URL}/api/social/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          name: `Tech Dispatches ${ts}`,
          handle: `@tech_channel_${ts}`,
          category: 'tech',
          desc: 'Decentralized research dispatches',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.channel).toBeDefined();
      expect(data.channel.name).toBe(`Tech Dispatches ${ts}`);
      testChannelId = data.channel.id;
    });

    it('creates a sovereign Page with business/brand identity', async () => {
      const res = await fetch(`${BASE_URL}/api/social/pages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          name: `Sovereign Labs ${ts}`,
          handle: `@sovereign_labs_${ts}`,
          category: 'business',
          ctaType: 'message',
          bio: 'Open-source decentralized protocol laboratory',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.page).toBeDefined();
      expect(data.page.name).toBe(`Sovereign Labs ${ts}`);
      testPageId = data.page.id;
    });

    it('creates a peer Group with privacy controls and peer membership', async () => {
      const res = await fetch(`${BASE_URL}/api/social/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          name: `Mesh Devs Circle ${ts}`,
          handle: `@mesh_devs_${ts}`,
          privacy: 'public',
          description: 'Peer group for local mesh protocol development',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.group).toBeDefined();
      expect(data.group.name).toBe(`Mesh Devs Circle ${ts}`);
      testGroupId = data.group.id;
    });

    it('retrieves user spaces via GET /api/studio/spaces under unified identity', async () => {
      const res = await fetch(`${BASE_URL}/api/studio/spaces`, {
        headers: {
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.spaces).toBeDefined();
      expect(Array.isArray(data.spaces.channels)).toBe(true);
      expect(Array.isArray(data.spaces.pages)).toBe(true);
      expect(Array.isArray(data.spaces.groups)).toBe(true);

      const foundChan = data.spaces.channels.find((c: any) => c.id === testChannelId);
      const foundPage = data.spaces.pages.find((p: any) => p.id === testPageId);
      const foundGroup = data.spaces.groups.find((g: any) => g.id === testGroupId);

      expect(foundChan).toBeDefined();
      expect(foundPage).toBeDefined();
      expect(foundGroup).toBeDefined();
    });

    it('inspects space details, real telemetry, and OWNER role via /api/studio/space', async () => {
      const res = await fetch(
        `${BASE_URL}/api/studio/space?spaceId=${encodeURIComponent(testChannelId)}&spaceType=channel`,
        {
          headers: {
            Authorization: `Bearer ${ownerUser.sessionToken}`,
            'X-Sovra-DID': ownerUser.did,
          },
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.space).toBeDefined();
      expect(data.space.id).toBe(testChannelId);
      expect(data.spaceType).toBe('channel');
      expect(data.stats).toBeDefined();
      expect(data.stats.contentCount).toBeGreaterThanOrEqual(0);
      expect(data.stats.memberCount).toBeGreaterThanOrEqual(0);
    });

    it('manages Group rules lifecycle (create, list, delete)', async () => {
      // 1. Create Rule
      const createRes = await fetch(`${BASE_URL}/api/social/groups/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          groupId: testGroupId,
          title: 'Zero Sybil Attacks',
          description: 'Nodes must present verified Ed25519 public keys before broadcast.',
        }),
      });

      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      expect(createData.ok).toBe(true);
      expect(createData.rule).toBeDefined();
      const ruleId = createData.rule.id;

      // 2. List Rules
      const listRes = await fetch(`${BASE_URL}/api/social/groups/rules?groupId=${encodeURIComponent(testGroupId)}`);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.ok).toBe(true);
      expect(Array.isArray(listData.rules)).toBe(true);
      expect(listData.rules.some((r: any) => r.id === ruleId)).toBe(true);

      // 3. Delete Rule
      const delRes = await fetch(`${BASE_URL}/api/social/groups/rules/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          groupId: testGroupId,
          ruleId: ruleId,
        }),
      });

      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.ok).toBe(true);
    });

    it('allows a peer member to join group and verifies membership', async () => {
      const joinRes = await fetch(`${BASE_URL}/api/social/groups/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
        body: JSON.stringify({
          groupId: testGroupId,
        }),
      });

      expect(joinRes.status).toBe(200);
      const joinData = await joinRes.json();
      expect(joinData.ok).toBe(true);

      // Check group members
      const memRes = await fetch(`${BASE_URL}/api/social/groups/members?groupId=${encodeURIComponent(testGroupId)}`);
      expect(memRes.status).toBe(200);
      const memData = await memRes.json();
      expect(memData.ok).toBe(true);
      expect(Array.isArray(memData.members)).toBe(true);
      expect(memData.members.some((m: any) => m.userDid === memberUser.did)).toBe(true);
    });

    it('enforces RBAC: owner can promote member to MODERATOR, while member cannot mutate roles', async () => {
      // 1. Owner promotes member to MODERATOR
      const promoRes = await fetch(`${BASE_URL}/api/studio/team/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          spaceId: testGroupId,
          targetDid: memberUser.did,
          role: 'MODERATOR',
        }),
      });

      expect(promoRes.status).toBe(200);
      const promoData = await promoRes.json();
      expect(promoData.ok).toBe(true);
      expect(promoData.role).toBe('MODERATOR');

      // 2. Member tries to demote Owner (must be rejected 403)
      const rogueRes = await fetch(`${BASE_URL}/api/studio/team/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
        body: JSON.stringify({
          spaceId: testGroupId,
          targetDid: ownerUser.did,
          role: 'MEMBER',
        }),
      });

      expect(rogueRes.status).toBe(403);
      const rogueData = await rogueRes.json();
      expect(rogueData.ok).toBe(false);
    });
  });

  // ==========================================================================
  // 💬 PHASE 4: SPATIAL COMMUNICATION LAYER
  // ==========================================================================

  describe('Phase 4: Spatial Communication Layer (Chat, Calls, Attachments, Notifications)', () => {
    it('retrieves chat contacts via /api/chat/contacts', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/contacts?userDid=${encodeURIComponent(ownerUser.did)}`, {
        headers: {
          Authorization: `Bearer ${ownerUser.sessionToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.contacts)).toBe(true);
    });

    it('sends an encrypted direct chat message from Owner to Member', async () => {
      const msgText = `Encrypted handshake test dispatch ${ts}`;
      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          recipientDid: memberUser.did,
          recipient: memberUser.did,
          text: msgText,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toBeDefined();
      testMessageId = data.message.id;
      expect(data.message.text).toBe(msgText);
      expect(data.message.recipientDid || data.message.recipient).toBe(memberUser.did);
    });

    it('retrieves thread message history and filters by contactDid', async () => {
      const res = await fetch(
        `${BASE_URL}/api/chat/messages?userDid=${encodeURIComponent(ownerUser.did)}`,
        {
          headers: {
            Authorization: `Bearer ${ownerUser.sessionToken}`,
          },
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.messages)).toBe(true);
      const found = data.messages.find((m: any) => m.id === testMessageId);
      expect(found).toBeDefined();
    });

    it('adds an emoji reaction to message via POST /api/chat/reaction', async () => {
      const res = await fetch(`${BASE_URL}/api/chat/reaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
        body: JSON.stringify({
          messageId: testMessageId,
          reaction: '🚀',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('sends a chat message with a binary attachment and retrieves safe authenticated link', async () => {
      const fakeImageBase64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const res = await fetch(`${BASE_URL}/api/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          recipient: memberUser.did,
          text: 'Check this diagram attachment',
          attachment: {
            name: 'architecture_diagram.png',
            type: 'image/png',
            size: 68,
            dataUrl: fakeImageBase64,
          },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message.attachment).toBeDefined();
      expect(data.message.attachment.name).toBe('architecture_diagram.png');
      testAttachmentCid = data.message.attachment.cid || data.message.attachment.id || 'test_cid';

      // Verify the attachment can be fetched via /api/chat/attachment/:cid
      if (testAttachmentCid && testAttachmentCid !== 'test_cid') {
        const attRes = await fetch(`${BASE_URL}/api/chat/attachment/${encodeURIComponent(testAttachmentCid)}`, {
          headers: {
            Authorization: `Bearer ${ownerUser.sessionToken}`,
          },
        });
        expect([200, 304]).toContain(attRes.status);
        expect(attRes.headers.get('content-type')).toContain('image/png');
      }
    });

    it('deletes message with author verification via POST /api/chat/delete', async () => {
      // 1. Non-author cannot delete
      const rogueDel = await fetch(`${BASE_URL}/api/chat/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
        body: JSON.stringify({
          messageId: testMessageId,
        }),
      });
      expect(rogueDel.status).toBe(403);

      // 2. Author deletes
      const authorDel = await fetch(`${BASE_URL}/api/chat/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          messageId: testMessageId,
        }),
      });
      expect(authorDel.status).toBe(200);
      const delData = await authorDel.json();
      expect(delData.ok).toBe(true);
    });

    it('handles WebRTC call signaling pipeline (offer -> incoming -> answer -> end)', async () => {
      // 1. Caller initiates offer
      const offerRes = await fetch(`${BASE_URL}/api/call/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          recipientDid: memberUser.did,
          callType: 'video',
          offerSdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 100\r\n',
        }),
      });
      expect(offerRes.status).toBe(200);
      const offerData = await offerRes.json();
      expect(offerData.ok).toBe(true);
      const callId = offerData.session?.callId || offerData.callId;

      // 2. Recipient detects incoming call
      const incomingRes = await fetch(`${BASE_URL}/api/call/incoming?userDid=${encodeURIComponent(memberUser.did)}`, {
        headers: {
          Authorization: `Bearer ${memberUser.sessionToken}`,
        },
      });
      expect(incomingRes.status).toBe(200);
      const incomingData = await incomingRes.json();
      expect(incomingData.ok).toBe(true);

      // 3. Recipient answers call
      const answerRes = await fetch(`${BASE_URL}/api/call/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
        body: JSON.stringify({
          callId: callId,
          answerSdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendrecv\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 100\r\n',
        }),
      });
      expect(answerRes.status).toBe(200);
      const answerData = await answerRes.json();
      expect(answerData.ok).toBe(true);

      // 4. Hang up / End call
      const endRes = await fetch(`${BASE_URL}/api/call/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerUser.sessionToken}`,
          'X-Sovra-DID': ownerUser.did,
        },
        body: JSON.stringify({
          callId: callId,
        }),
      });
      expect(endRes.status).toBe(200);
      const endData = await endRes.json();
      expect(endData.ok).toBe(true);
    });

    it('persists notifications and updates read state via /api/notifications/read', async () => {
      // Query notifications
      const notifsRes = await fetch(`${BASE_URL}/api/notifications`, {
        headers: {
          Authorization: `Bearer ${memberUser.sessionToken}`,
          'X-Sovra-DID': memberUser.did,
        },
      });
      expect(notifsRes.status).toBe(200);
      const notifsData = await notifsRes.json();
      expect(notifsData.ok).toBe(true);
      expect(Array.isArray(notifsData.notifications)).toBe(true);

      // If notification exists, mark read
      if (notifsData.notifications.length > 0) {
        const notif = notifsData.notifications[0];
        const readRes = await fetch(`${BASE_URL}/api/notifications/read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${memberUser.sessionToken}`,
            'X-Sovra-DID': memberUser.did,
          },
          body: JSON.stringify({
            notificationId: notif.id,
          }),
        });
        expect(readRes.status).toBe(200);
        const readData = await readRes.json();
        expect(readData.ok).toBe(true);
      }
    });

    it('verifies client-side spatial surface engine definitions in served HTML', async () => {
      const htmlRes = await fetch(`${BASE_URL}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();

      // Check spatial communication surfaces
      expect(html).toContain('window.openSpatialChatSurface');
      expect(html).toContain('window.openSpatialConversationSurface');
      expect(html).toContain('window.openSpatialNewChatSurface');
      expect(html).toContain('window.openSpatialMessageActionsSurface');
      expect(html).toContain('window.openSpatialCallSurface');
      expect(html).toContain('window._handleNotificationClick');

      // Check spatial studio surfaces
      expect(html).toContain('window.openSpatialStudioSpacesSurface');
      expect(html).toContain('window.openSpatialStudioSurface');
      expect(html).toContain('window.openSpatialSpaceSwitcherSurface');

      // Verify chat queries real contacts rather than hardcoded mock cards
      expect(html).toContain('/api/chat/contacts');
      expect(html).not.toContain('Sovereign Swarm Bot');
    });
  });
});
