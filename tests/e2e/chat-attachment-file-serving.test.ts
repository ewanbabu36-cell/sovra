import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SOVRA_BASE_URL || 'http://localhost:3001';

describe('Chat File Attachment Serving & Safe Opening Gate', () => {
  const ts = Date.now();
  let userA: { did: string; handle: string; sessionToken: string };
  let userB: { did: string; handle: string; sessionToken: string };
  let userC: { did: string; handle: string; sessionToken: string };

  beforeAll(async () => {
    // 1. Register User A
    const resA = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@attach_alice_${ts}`,
        name: 'Alice Attachments',
        bio: 'Sender of sovereign documents',
      }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    userA = { did: dataA.user.did, handle: dataA.user.handle, sessionToken: dataA.sessionToken };

    // 2. Register User B
    const resB = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@attach_bob_${ts}`,
        name: 'Bob Attachments',
        bio: 'Recipient peer',
      }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    userB = { did: dataB.user.did, handle: dataB.user.handle, sessionToken: dataB.sessionToken };

    // 3. Register User C (Unauthorized outsider)
    const resC = await fetch(`${BASE_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: `@attach_charlie_${ts}`,
        name: 'Charlie Outsider',
        bio: 'Non-participant third party',
      }),
    });
    expect(resC.status).toBe(200);
    const dataC = await resC.json();
    userC = { did: dataC.user.did, handle: dataC.user.handle, sessionToken: dataC.sessionToken };
  });

  it('serves dashboard HTML with lightbox modal, safe preview pill, and no raw dataUrl window.open', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Verify lightbox modal exists
    expect(html).toContain('id="chatAttachmentLightboxModal"');
    expect(html).toContain('id="lightboxFilePreviewContainer"');
    expect(html).toContain('id="lightboxOpenTabBtn"');
    expect(html).toContain('id="lightboxDownloadBtn"');

    // Verify handler functions are present
    expect(html).toContain('function openChatAttachment(');
    expect(html).toContain('function downloadChatAttachment(');
    expect(html).toContain('function dataUrlToBlob(');
    expect(html).toContain('function getAuthenticatedAttachmentUrl(');

    // Verify that the old broken window.open(att.dataUrl, "_blank") is completely replaced
    expect(html).not.toContain('window.open(&quot;\' + att.dataUrl + \'&quot;, &quot;_blank&quot;)');
  });

  it('uploads an image attachment, persists binary bytes to disk, and serves with exact MIME and inline Content-Disposition', async () => {
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a7545b780000000049454e44ae426082';
    const rawBuffer = Buffer.from(pngHex, 'hex');
    const imageBase64 = `data:image/png;base64,${rawBuffer.toString('base64')}`;

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Diagram of P2P network topology',
        attachment: {
          name: 'topology.png',
          type: 'image/png',
          dataUrl: imageBase64,
        },
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);
    expect(sendData.message.attachment).toBeDefined();
    expect(sendData.message.attachment.cid).toBeTruthy();
    expect(sendData.message.attachment.url).toContain('/api/chat/attachment/');

    const attachmentUrl = sendData.message.attachment.url;

    // 1. Test fetching with Bearer Token header
    const fileResHeader = await fetch(`${BASE_URL}${attachmentUrl}`, {
      headers: { Authorization: `Bearer ${userB.sessionToken}` },
    });
    expect(fileResHeader.status).toBe(200);
    expect(fileResHeader.headers.get('content-type')).toBe('image/png');
    expect(fileResHeader.headers.get('content-disposition')).toContain('inline; filename="topology.png"');
    expect(fileResHeader.headers.get('etag')).toBeTruthy();
    expect(fileResHeader.headers.get('cache-control')).toContain('private');

    const receivedBytes = Buffer.from(await fileResHeader.arrayBuffer());
    expect(receivedBytes.equals(rawBuffer)).toBe(true);

    // 2. Test fetching with Query Token (?token=...) as used in window.open / new browser tabs
    const fileResQuery = await fetch(`${BASE_URL}${attachmentUrl}&token=${userB.sessionToken}`);
    expect(fileResQuery.status).toBe(200);
    expect(fileResQuery.headers.get('content-type')).toBe('image/png');
    const queryBytes = Buffer.from(await fileResQuery.arrayBuffer());
    expect(queryBytes.equals(rawBuffer)).toBe(true);
  });

  it('uploads a PDF attachment, sets application/pdf, and permits inline browser preview in new tab', async () => {
    const samplePdfString = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
    const pdfBuffer = Buffer.from(samplePdfString, 'utf8');
    const pdfBase64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Whitepaper PDF specification',
        attachment: {
          name: 'sovra_whitepaper.pdf',
          type: 'application/pdf',
          dataUrl: pdfBase64,
        },
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    expect(sendData.ok).toBe(true);

    const attachmentUrl = sendData.message.attachment.url;
    expect(attachmentUrl).toBeTruthy();

    const pdfRes = await fetch(`${BASE_URL}${attachmentUrl}&token=${userB.sessionToken}`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    expect(pdfRes.headers.get('content-disposition')).toContain('inline; filename="sovra_whitepaper.pdf"');

    const fetchedPdfText = await pdfRes.text();
    expect(fetchedPdfText).toBe(samplePdfString);
  });

  it('supports HTTP Range requests (206 Partial Content) for streaming media attachments', async () => {
    // 256 bytes of dummy video payload
    const dummyVideo = Buffer.alloc(256, 0x42);
    const videoBase64 = `data:video/mp4;base64,${dummyVideo.toString('base64')}`;

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Screen recording demo',
        attachment: {
          name: 'demo.mp4',
          type: 'video/mp4',
          dataUrl: videoBase64,
        },
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    const attachmentUrl = sendData.message.attachment.url;

    // 1. Test Valid Range Request: bytes=0-63
    const rangeRes = await fetch(`${BASE_URL}${attachmentUrl}&token=${userB.sessionToken}`, {
      headers: { Range: 'bytes=0-63' },
    });
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get('content-type')).toBe('video/mp4');
    expect(rangeRes.headers.get('content-range')).toBe('bytes 0-63/256');
    expect(rangeRes.headers.get('content-length')).toBe('64');
    expect(rangeRes.headers.get('accept-ranges')).toBe('bytes');

    const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
    expect(rangeBytes.length).toBe(64);
    expect(rangeBytes.equals(dummyVideo.subarray(0, 64))).toBe(true);

    // 2. Test Invalid Range Request: bytes=500-600 (exceeds 256)
    const invalidRangeRes = await fetch(`${BASE_URL}${attachmentUrl}&token=${userB.sessionToken}`, {
      headers: { Range: 'bytes=500-600' },
    });
    expect(invalidRangeRes.status).toBe(416);
    expect(invalidRangeRes.headers.get('content-range')).toBe('bytes */256');
  });

  it('serves generic downloadable files (e.g. .zip) with Content-Disposition: attachment', async () => {
    const zipBuffer = Buffer.from('PK\x03\x04dummyzipcontent', 'binary');
    const zipBase64 = `data:application/zip;base64,${zipBuffer.toString('base64')}`;

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Project bundle archive',
        attachment: {
          name: 'project_bundle.zip',
          type: 'application/zip',
          dataUrl: zipBase64,
        },
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json();
    const attachmentUrl = sendData.message.attachment.url;

    const zipRes = await fetch(`${BASE_URL}${attachmentUrl}&token=${userB.sessionToken}`);
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('content-type')).toBe('application/zip');
    expect(zipRes.headers.get('content-disposition')).toContain('attachment; filename="project_bundle.zip"');
  });

  it('enforces strict authentication and authorization boundaries on chat attachments', async () => {
    const secretBuffer = Buffer.from('TOP_SECRET_PEER_DATA', 'utf8');
    const secretBase64 = `data:text/plain;base64,${secretBuffer.toString('base64')}`;

    const sendRes = await fetch(`${BASE_URL}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.sessionToken}`,
      },
      body: JSON.stringify({
        recipientDid: userB.did,
        text: 'Confidential keys and tokens',
        attachment: {
          name: 'confidential.txt',
          type: 'text/plain',
          dataUrl: secretBase64,
        },
      }),
    });
    const sendData = await sendRes.json();
    const attachmentUrl = sendData.message.attachment.url;

    // 1. Unauthenticated Request -> Must return 401 Unauthorized
    const unauthRes = await fetch(`${BASE_URL}${attachmentUrl}`);
    expect(unauthRes.status).toBe(401);
    const unauthData = await unauthRes.json();
    expect(unauthData.ok).toBe(false);

    // 2. Unauthorized Third-Party (User C) -> Must return 403 Forbidden
    const forbiddenRes = await fetch(`${BASE_URL}${attachmentUrl}`, {
      headers: { Authorization: `Bearer ${userC.sessionToken}` },
    });
    expect(forbiddenRes.status).toBe(403);
    const forbiddenData = await forbiddenRes.json();
    expect(forbiddenData.ok).toBe(false);
    expect(forbiddenData.error).toContain('Forbidden');

    // 3. Sender (User A) -> Allowed (200 OK)
    const senderRes = await fetch(`${BASE_URL}${attachmentUrl}`, {
      headers: { Authorization: `Bearer ${userA.sessionToken}` },
    });
    expect(senderRes.status).toBe(200);

    // 4. Recipient (User B) -> Allowed (200 OK)
    const recipientRes = await fetch(`${BASE_URL}${attachmentUrl}`, {
      headers: { Authorization: `Bearer ${userB.sessionToken}` },
    });
    expect(recipientRes.status).toBe(200);
  });

  it('blocks path traversal and returns clean 400/404 for invalid attachment requests', async () => {
    // 1. Path traversal attempt
    const traversalRes = await fetch(`${BASE_URL}/api/chat/attachment/..%2F..%2Fetc%2Fpasswd?token=${userA.sessionToken}`);
    expect(traversalRes.status).toBe(400);

    // 2. Non-existent CID
    const notFoundRes = await fetch(`${BASE_URL}/api/chat/attachment/non_existent_cid_99999999?token=${userA.sessionToken}`);
    expect(notFoundRes.status).toBe(404);
    const notFoundData = await notFoundRes.json();
    expect(notFoundData.ok).toBe(false);
    expect(notFoundData.error).toContain('not found');
  });
});
