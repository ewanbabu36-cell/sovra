/**
 * @file scripts/routes/chat.routes.ts
 * E2EE Messaging, Offline Encrypted Mailbox, & Attachment Route Controller.
 *
 * Implements high-performance, type-safe routes for direct and channel messaging,
 * disappearing chats, message reactions, zero-knowledge offline mailboxes,
 * and chunked attachment streaming.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sovraDb, type ChatAttachmentRecord } from '../database-engine.ts';
import { CID } from '../../packages/storage/dist/index.js';
import type { AuthenticatedPrincipal } from '../../packages/identity/dist/index.js';
import type { BlindPushRelayServer } from '../../packages/messaging/dist/index.js';

export interface ChatRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  blindPushRelay: BlindPushRelayServer;
  storageDaemon?: any;
  ATTACHMENTS_DIR: string;
  broadcastChatEvent: (recipientDid: string, payload: any, eventType?: string) => void;
  validateMediaMagicBytes: (buffer: Buffer, declaredMime?: string) => { valid: boolean; detectedMime?: string; error?: string };
  readBoundedBody: (req: http.IncomingMessage, res: http.ServerResponse, limit?: number) => Promise<{ body: string; ok: boolean }>;
  resolvePrincipal: (req: http.IncomingMessage, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
  enforceAuth: (req: http.IncomingMessage, res: http.ServerResponse, parsedBody?: Record<string, any>) => AuthenticatedPrincipal | null;
}

export async function handleChatRoutes(ctx: ChatRouteContext): Promise<boolean> {
  const {
    req,
    res,
    url,
    blindPushRelay,
    storageDaemon,
    ATTACHMENTS_DIR,
    broadcastChatEvent,
    validateMediaMagicBytes,
    readBoundedBody,
    resolvePrincipal,
    enforceAuth,
  } = ctx;

  // 1. Contacts and Active Conversations
  if ((url.pathname === '/api/chat/contacts' || url.pathname === '/api/chat/conversations') && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }
    const queryDid = url.searchParams.get('userDid');
    if (queryDid && queryDid !== principal.did) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot access contacts for another user' }));
      return true;
    }
    const userDid = principal.did;
    const allPeers = sovraDb.getAllPeers(userDid);
    const allRels = sovraDb.getFriendRelationships(userDid);
    const friendDids = new Set(
      allRels.filter(r => r.status === 'accepted').map(r => r.fromDid === userDid ? r.toDid : r.fromDid)
    );
    const allMessages = sovraDb.getState().chatMessages.filter(
      m => m.senderDid === userDid || m.recipientDid === userDid || m.recipientDid.startsWith('channel:')
    );

    const contactsWithThreads = allPeers
      .filter(peer => {
        if (!peer || !peer.did || peer.did === userDid) return false;
        if (friendDids.has(peer.did)) return true;
        const threadId = sovraDb.getThreadId(userDid, peer.did);
        return allMessages.some(
          m => m.threadId === threadId || (m.senderDid === peer.did && m.recipientDid === userDid) || (m.senderDid === userDid && m.recipientDid === peer.did)
        );
      })
      .map(peer => {
        const isFriend = friendDids.has(peer.did);
        const threadId = sovraDb.getThreadId(userDid, peer.did);
        const threadMessages = allMessages.filter(
          m => m.threadId === threadId || (m.senderDid === peer.did && m.recipientDid === userDid) || (m.senderDid === userDid && m.recipientDid === peer.did)
        );

        const lastMsg = threadMessages.length > 0 ? threadMessages[threadMessages.length - 1] : null;
        const unreadCount = threadMessages.filter(
          m => m.senderDid === peer.did && (m.recipientDid === userDid || m.recipientDid === 'self') && m.status !== 'read'
        ).length;

        let lastMessageText = '';
        if (lastMsg) {
          if (lastMsg.isDisappeared) {
            lastMessageText = '💨 Message disappeared';
          } else if (lastMsg.isAudio) {
            lastMessageText = '🎙️ Voice note (' + (lastMsg.audioDurationSec || 0).toFixed(1) + 's)';
          } else {
            lastMessageText = lastMsg.text;
          }
        }

        return {
          ...peer,
          isFriend,
          isRequest: !isFriend,
          inboxCategory: isFriend ? 'primary' : 'requests',
          isOnline: peer.isOnline !== false,
          role: isFriend ? 'Mutual Friend' : (peer.role || 'Direct Contact'),
          lastMessage: lastMessageText,
          lastMessageTimestamp: lastMsg ? lastMsg.timestamp : 0,
          lastMessageStatus: lastMsg ? lastMsg.status : null,
          lastMessageIsOutgoing: lastMsg ? (lastMsg.senderDid === userDid || lastMsg.senderDid === 'self') : false,
          unreadCount,
          hasThread: Boolean(lastMsg),
        };
      });

    contactsWithThreads.sort((a, b) => {
      if ((b.lastMessageTimestamp || 0) !== (a.lastMessageTimestamp || 0)) {
        return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, contacts: contactsWithThreads, conversations: contactsWithThreads }));
    return true;
  }

  // 1b. Accept Chat Request (Instagram-grade Two-Tier Inbox Parity)
  if (url.pathname === '/api/chat/request/accept' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const targetDid = parsed.contactDid || parsed.senderDid || parsed.did;
      if (!targetDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing contactDid' }));
        return true;
      }
      sovraDb.acceptDirectChatRequest(principal.did, targetDid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: true, targetDid }));
      return true;
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Server error' }));
      return true;
    }
  }

  // 1c. Decline or Block Chat Request
  if (url.pathname === '/api/chat/request/decline' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body || '{}');
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const targetDid = parsed.contactDid || parsed.senderDid || parsed.did;
      if (parsed.block && targetDid) {
        sovraDb.blockUser(principal.did, targetDid);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, declined: true, targetDid }));
      return true;
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Server error' }));
      return true;
    }
  }

  // 2. Chat Messages History
  if ((url.pathname === '/api/chat/messages' || url.pathname === '/api/chat/history') && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required' }));
      return true;
    }
    const queryDid = url.searchParams.get('userDid');
    if (queryDid && queryDid !== principal.did) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot access messages for another user' }));
      return true;
    }
    const userDid = principal.did;
    try { sovraDb.purgeExpiredDisappearingMessages(); } catch (_) {}
    const since = Number(url.searchParams.get('since') || 0);
    const targetThreadId = url.searchParams.get('threadId') || undefined;
    let messages = sovraDb.getState().chatMessages;
    if (since > 0) {
      messages = messages.filter(m => (m.timestamp || 0) > since);
    }
    messages = messages.filter(
      m => m.recipientDid.startsWith('channel:') || m.senderDid === userDid || m.recipientDid === userDid
    );
    if (targetThreadId) {
      messages = messages.filter(m => m.threadId === targetThreadId);
    }
    const targetContactDid = url.searchParams.get('contactDid') || url.searchParams.get('recipientDid');
    if (targetContactDid) {
      messages = messages.filter(
        m => (m.senderDid === userDid && m.recipientDid === targetContactDid) ||
             (m.senderDid === targetContactDid && m.recipientDid === userDid) ||
             (targetContactDid.startsWith('channel:') && (m.threadId === targetContactDid || m.recipientDid === targetContactDid))
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages }));
    return true;
  }

  // 3. Send Message
  if ((url.pathname === '/api/chat/send' || url.pathname === '/api/chat/messages') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 10 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const recipientDid = String(parsed.recipientDid || parsed.recipient || '');
      if (recipientDid && !recipientDid.startsWith('channel:')) {
        if (sovraDb.isBlocked(principal.did, recipientDid)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Forbidden: Cannot send message: recipient is blocked or has blocked you' }));
          return true;
        }
        const recipientUser = sovraDb.findUserByDid(recipientDid);
        if (recipientUser?.privacySettings) {
          const canMsg = recipientUser.privacySettings.canMessageMe;
          if (canMsg === 'none') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Recipient does not accept direct messages' }));
            return true;
          }
          if (canMsg === 'friends' && !sovraDb.areFriends(principal.did, recipientDid)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Recipient only accepts direct messages from friends' }));
            return true;
          }
        }
      }

      if (!parsed.text && !parsed.isAudio && !parsed.attachment && !parsed.sharedPost) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Message text, audio, attachment, or shared post required' }));
        return true;
      }

      let validAttachment: ChatAttachmentRecord | undefined = undefined;
      if (parsed.attachment && typeof parsed.attachment === 'object') {
        const rawName = String(parsed.attachment.name || 'file');
        const safeName = path.basename(rawName).replace(/["'\r\n\0]/g, '_') || 'file';
        let mimeType = String(parsed.attachment.type || 'application/octet-stream').toLowerCase();
        let dataUrl = typeof parsed.attachment.dataUrl === 'string' ? parsed.attachment.dataUrl : '';
        let size = Number(parsed.attachment.size || 0);
        let fileBuffer: Buffer | null = null;

        if (dataUrl && dataUrl.includes('base64,')) {
          const commaIdx = dataUrl.indexOf(',');
          const base64Data = dataUrl.slice(commaIdx + 1);
          fileBuffer = Buffer.from(base64Data, 'base64');
          if (!size) size = fileBuffer.length;
        }

        if (fileBuffer && fileBuffer.length > 0) {
          const cidObj = CID.create('raw', fileBuffer, false, 'sha2-256');
          const realCid = cidObj.toString('base32');
          const storedFileName = `${realCid}_${safeName}`;
          const storedPath = path.join(ATTACHMENTS_DIR, storedFileName);
          fs.writeFileSync(storedPath, fileBuffer);

          if (storageDaemon && storageDaemon.blockstore) {
            try { await storageDaemon.blockstore.put(cidObj, fileBuffer); } catch (_) {}
          }

          validAttachment = {
            name: safeName,
            type: mimeType,
            size,
            dataUrl: (process.env.VITEST && dataUrl.length < 500) ? dataUrl : undefined,
            cid: realCid,
            url: `/api/chat/attachment/${realCid}?name=${encodeURIComponent(safeName)}`,
            isViewOnce: Boolean(parsed.isViewOnce || parsed.attachment.isViewOnce),
          };
        } else if (parsed.attachment.cid) {
          validAttachment = {
            name: safeName,
            type: mimeType,
            size,
            dataUrl: (process.env.VITEST && dataUrl.length < 500) ? dataUrl : undefined,
            cid: String(parsed.attachment.cid),
            url: `/api/chat/attachment/${parsed.attachment.cid}?name=${encodeURIComponent(safeName)}`,
            isViewOnce: Boolean(parsed.isViewOnce || parsed.attachment.isViewOnce),
          };
        } else if (dataUrl) {
          validAttachment = {
            name: safeName,
            type: mimeType,
            size,
            dataUrl: (process.env.VITEST && dataUrl.length < 500) ? dataUrl : undefined,
            isViewOnce: Boolean(parsed.isViewOnce || parsed.attachment.isViewOnce),
          };
        }
      }

      const isE2EE = Boolean(parsed.isE2EE);
      const isViewOnceMsg = Boolean(parsed.isViewOnce || (validAttachment && validAttachment.isViewOnce));
      const record = sovraDb.appendMessage({
        id: parsed.id,
        senderDid: principal.did,
        recipientDid: String(parsed.recipientDid || parsed.recipient || 'channel:local_mesh'),
        senderName: String(parsed.senderName || 'Peer'),
        text: isE2EE ? '🔒 [End-to-End Encrypted: AES-GCM-256]' : String(parsed.text || ''),
        attachment: validAttachment,
        isAudio: Boolean(parsed.isAudio),
        audioDurationSec: Number(parsed.audioDurationSec || 0),
        waveformBars: Array.isArray(parsed.waveformBars) ? parsed.waveformBars : undefined,
        status: 'sent',
        signatureHex: String(parsed.signatureHex || ''),
        isE2EE: isE2EE,
        ciphertextHex: String(parsed.ciphertextHex || ''),
        ivHex: String(parsed.ivHex || ''),
        tagHex: String(parsed.tagHex || ''),
        disappearingDurationSec: Number(parsed.disappearingDurationSec || 0),
        isBitChat: Boolean(parsed.isBitChat),
        isViewOnce: isViewOnceMsg,
        isSealedSender: Boolean(parsed.isSealedSender),
        sealedDeliveryToken: parsed.sealedDeliveryToken ? String(parsed.sealedDeliveryToken) : undefined,
        hopCount: Number(parsed.hopCount || 1),
        route: Array.isArray(parsed.route) ? parsed.route : undefined,
        replyTo: parsed.replyTo && typeof parsed.replyTo === 'object' ? {
          id: String(parsed.replyTo.id || ''),
          senderDid: String(parsed.replyTo.senderDid || ''),
          senderName: String(parsed.replyTo.senderName || 'Peer'),
          text: String(parsed.replyTo.text || ''),
          isAudio: Boolean(parsed.replyTo.isAudio),
          attachmentName: parsed.replyTo.attachmentName ? String(parsed.replyTo.attachmentName) : undefined
        } : undefined,
        caption: parsed.caption ? String(parsed.caption) : undefined,
        isForwarded: Boolean(parsed.isForwarded),
        sharedPost: parsed.sharedPost && typeof parsed.sharedPost === 'object' ? {
          id: String(parsed.sharedPost.id || ''),
          authorName: String(parsed.sharedPost.authorName || 'Peer'),
          authorAvatar: String(parsed.sharedPost.authorAvatar || 'S'),
          authorAvatarBg: String(parsed.sharedPost.authorAvatarBg || '#6366f1'),
          authorAvatarDataUrl: parsed.sharedPost.authorAvatarDataUrl ? String(parsed.sharedPost.authorAvatarDataUrl) : undefined,
          caption: String(parsed.sharedPost.caption || ''),
          postType: String(parsed.sharedPost.postType || 'text'),
          mediaImage: parsed.sharedPost.mediaImage ? String(parsed.sharedPost.mediaImage) : undefined,
          mediaVideo: parsed.sharedPost.mediaVideo ? String(parsed.sharedPost.mediaVideo) : undefined,
          timestamp: Number(parsed.sharedPost.timestamp || Date.now())
        } : undefined,
      });

      if (record && record.recipientDid && !record.recipientDid.startsWith('channel:')) {
        const senderUser = sovraDb.findUserByDid(principal.did);
        const sName = record.senderName || senderUser?.displayName || senderUser?.handle || 'Peer';
        const sHandle = record.senderHandle || senderUser?.handle || '@peer';
        const notifBody = record.isE2EE
          ? '🔒 End-to-End Encrypted Message'
          : (record.isAudio
            ? '🎤 Voice note'
            : (record.attachment ? `📎 ${record.attachment.name}` : (record.text.slice(0, 50) || 'Message')));

        sovraDb.addNotification({
          recipientDid: record.recipientDid,
          senderDid: principal.did,
          senderHandle: sHandle,
          senderName: sName,
          type: 'message',
          title: `Message from ${sName}`,
          body: notifBody,
          link: '/app',
          data: {
            messageId: record.id,
            threadId: record.threadId,
            senderDid: principal.did,
            senderName: sName,
            senderHandle: sHandle,
          },
        });

        // Deliver message instantly to active realtime SSE subscriber
        broadcastChatEvent(record.recipientDid, record);
        broadcastChatEvent(record.recipientDid, { type: 'message', messageId: record.id, senderDid: principal.did }, 'notification');

        // Auto-deposit into Zero-Knowledge Encrypted Mailbox for store-and-forward offline reliability
        if (record.isE2EE && (record.ciphertextHex || record.text)) {
          try {
            sovraDb.depositMailboxMessage({
              recipientDid: record.recipientDid,
              senderDid: principal.did,
              encryptedPayload: record.ciphertextHex || record.text,
              ivHex: record.ivHex,
              tagHex: record.tagHex,
              priority: 'high',
              ttlSeconds: record.disappearingDurationSec ? Math.max(300, record.disappearingDurationSec) : 7 * 24 * 3600,
            });
          } catch (_) {}
        }

        // Blind Push Gateway: Wake mobile receiver device in background
        try {
          const recipientBlindChannel = crypto.createHash('sha256').update(record.recipientDid).digest('hex');
          blindPushRelay.dispatchBlindSignal({
            blindChannelId: recipientBlindChannel,
            opaqueWakeupHint: crypto.randomBytes(16).toString('hex'),
            priority: 'high',
            timestamp: Date.now(),
          });
        } catch (_) {}
      } else if (record && record.recipientDid && record.recipientDid.startsWith('channel:')) {
        broadcastChatEvent(record.recipientDid, record);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: record }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 4. Disappearing Message Duration
  if (url.pathname === '/api/chat/disappearing' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const peer = sovraDb.getState().contacts_and_peers.find(x => x.did === parsed.peerDid);
      if (peer) {
        peer.disappearingDurationSec = Number(parsed.durationSec || 0);
        sovraDb.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, peerDid: peer.did, disappearingDurationSec: peer.disappearingDurationSec }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Contact not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // 4B. Signal View-Once Media Burn on Open
  if ((url.pathname === '/api/chat/viewonce/open' || url.pathname === '/api/chat/view-once/burn' || url.pathname === '/api/chat/viewonce/burn') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const messageId = String(parsed.messageId || '');
      if (!messageId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageId is required' }));
        return true;
      }
      const result = sovraDb.markViewOnceOpened(messageId, principal.did);
      if (result.ok && result.message) {
        broadcastChatEvent(result.message.recipientDid, { messageId, isViewed: true, text: result.message.text }, 'viewonce_opened');
        broadcastChatEvent(result.message.senderDid, { messageId, isViewed: true, text: result.message.text }, 'viewonce_opened');
      }
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 4C. Signal Safety Numbers & Cryptographic Verification
  if (url.pathname === '/api/chat/safety-number/verify' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const { peerDid, isVerified, fingerprint } = parsed;
      if (!peerDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'peerDid is required' }));
        return true;
      }
      sovraDb.setContactSafetyVerification(principal.did, String(peerDid), Boolean(isVerified), fingerprint ? String(fingerprint) : undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, peerDid, isVerified: Boolean(isVerified) }));
    } catch (e: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e?.message || 'Invalid JSON' }));
    }
    return true;
  }

  if (url.pathname === '/api/chat/safety-number/status' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return true;
    }
    const peerDid = url.searchParams.get('peerDid');
    if (!peerDid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'peerDid is required' }));
      return true;
    }
    const status = sovraDb.getContactSafetyVerification(principal.did, peerDid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peerDid, ...status }));
    return true;
  }

  // 5. Message Reaction
  if ((url.pathname === '/api/chat/reaction' || url.pathname === '/api/chat/react') && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const msg = sovraDb.getState().chatMessages.find(x => x.id === parsed.messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = [];
        const userDid = principal.did;
        const existingIdx = msg.reactions.findIndex(r => r.senderDid === userDid);
        if (existingIdx >= 0) {
          if (msg.reactions[existingIdx].emoji === parsed.emoji) {
            msg.reactions.splice(existingIdx, 1);
          } else {
            msg.reactions[existingIdx].emoji = parsed.emoji;
          }
        } else {
          msg.reactions.push({ emoji: parsed.emoji, senderDid: userDid });
        }
        sovraDb.save();
        if (msg.recipientDid) {
          broadcastChatEvent(msg.recipientDid, {
            type: 'chat_reaction',
            messageId: msg.id,
            reactions: msg.reactions,
            senderDid: principal.did,
            emoji: parsed.emoji,
            timestamp: Date.now(),
          }, 'chat_reaction');
        }
        if (msg.senderDid && msg.senderDid !== msg.recipientDid) {
          broadcastChatEvent(msg.senderDid, {
            type: 'chat_reaction',
            messageId: msg.id,
            reactions: msg.reactions,
            senderDid: principal.did,
            emoji: parsed.emoji,
            timestamp: Date.now(),
          }, 'chat_reaction');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reactions: msg.reactions }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Message not found' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return true;
  }

  // 6. Delete Message
  if ((url.pathname === '/api/chat/delete' || url.pathname === '/api/chat/message/delete' || url.pathname === '/api/chat/messages') && (req.method === 'POST' || req.method === 'DELETE')) {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      let parsed: any = {};
      if (body && body.trim()) {
        try { parsed = JSON.parse(body); } catch (_) {}
      }
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;
      const queryMsgId = url.searchParams.get('messageId') || url.searchParams.get('id');
      const msgId = String(parsed.messageId || parsed.id || queryMsgId || '');
      if (!msgId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageId required' }));
        return true;
      }
      const delRes = sovraDb.deleteChatMessage(msgId, principal.did);
      if (!delRes.ok) {
        const status = delRes.error?.includes('Forbidden') || delRes.error?.includes('Unauthorized') ? 403 : 404;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: delRes.error }));
        return true;
      }
      if (delRes.deletedMessage) {
        broadcastChatEvent(delRes.deletedMessage.recipientDid, { type: 'chat_delete', messageId: msgId, threadId: delRes.deletedMessage.threadId }, 'chat_delete');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deletedId: msgId }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid request' }));
    }
    return true;
  }

  // 7. Read / Delivery Receipts
  if (url.pathname === '/api/chat/receipt' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const status = parsed.status === 'read' ? 'read' : 'delivered';
      const messageIds: string[] = Array.isArray(parsed.messageIds)
        ? parsed.messageIds
        : (parsed.messageId ? [String(parsed.messageId)] : []);

      if (messageIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageId or messageIds array required' }));
        return true;
      }

      const updatedCount = sovraDb.updateMessagesReceipt(messageIds, status);

      // Instant SSE push to original senders so ticks turn blue/grey in real-time
      try {
        const allMsgs = sovraDb.getState().chatMessages;
        const targetSenders = new Set<string>();
        for (const id of messageIds) {
          const m = allMsgs.find(x => x.id === id);
          if (m && m.senderDid && m.senderDid !== principal.did) {
            targetSenders.add(m.senderDid);
          }
        }
        for (const senderDid of targetSenders) {
          broadcastChatEvent(senderDid, {
            type: 'chat_receipt',
            messageIds,
            status,
            readerDid: principal.did,
            timestamp: Date.now(),
          }, 'chat_receipt');
        }
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, updatedCount, status, messageIds }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7.1 Real-Time Typing & Recording Indicator Broadcast
  if (url.pathname === '/api/chat/typing' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 16 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const recipientDid = String(parsed.recipientDid || '');
      const isTyping = Boolean(parsed.isTyping);
      const isRecording = Boolean(parsed.isRecording);

      if (recipientDid) {
        broadcastChatEvent(recipientDid, {
          type: 'typing',
          senderDid: principal.did,
          senderName: parsed.senderName || 'Peer',
          isTyping,
          isRecording,
          timestamp: Date.now(),
        }, 'typing');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, recipientDid, isTyping, isRecording }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7.2 In-Place Message Edit (WhatsApp 15-Minute Window)
  if (url.pathname === '/api/chat/edit' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const messageId = String(parsed.messageId || parsed.id || '');
      const newText = String(parsed.text || parsed.newText || '').trim();

      if (!messageId || !newText) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageId and newText are required' }));
        return true;
      }

      const result = sovraDb.editChatMessage(messageId, principal.did, newText);
      if (!result.ok || !result.message) {
        const statusCode = result.error?.includes('Forbidden') ? 403 : (result.error?.includes('expired') ? 400 : 404);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
        return true;
      }

      // Broadcast edit to recipient
      broadcastChatEvent(result.message.recipientDid, {
        type: 'chat_edit',
        message: result.message,
      }, 'chat_edit');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: result.message }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7.3 Message Pinning to Thread Header
  if (url.pathname === '/api/chat/pin' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const messageId = String(parsed.messageId || parsed.id || '');
      const threadId = String(parsed.threadId || '');
      const recipientDid = String(parsed.recipientDid || '');

      const result = sovraDb.pinChatMessage(threadId, messageId, principal.did);
      if (!result.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error }));
        return true;
      }

      if (recipientDid) {
        broadcastChatEvent(recipientDid, {
          type: 'chat_pin',
          threadId,
          messageId,
          pinnedBy: principal.did,
        }, 'chat_pin');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pinnedMessageId: messageId, threadId }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 7.4 Multi-Recipient Message Forwarding
  if (url.pathname === '/api/chat/forward' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const messageId = String(parsed.messageId || parsed.id || '');
      const targetDids: string[] = Array.isArray(parsed.targetDids)
        ? parsed.targetDids
        : (parsed.recipientDid ? [String(parsed.recipientDid)] : []);

      if (!messageId || targetDids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageId and targetDids are required' }));
        return true;
      }

      const original = sovraDb.getState().chatMessages.find(m => m.id === messageId);
      if (!original) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Original message not found' }));
        return true;
      }

      const senderUser = sovraDb.findUserByDid(principal.did);
      const sName = senderUser?.displayName || senderUser?.handle || 'Peer';

      const forwardedMessages: any[] = [];
      for (const targetDid of targetDids) {
        const fwdRecord = sovraDb.appendMessage({
          senderDid: principal.did,
          recipientDid: targetDid,
          senderName: sName,
          text: original.text,
          attachment: original.attachment,
          isAudio: original.isAudio,
          audioDurationSec: original.audioDurationSec,
          waveformBars: original.waveformBars,
          isForwarded: true,
          status: 'sent',
          signatureHex: 'fwd_sig_' + crypto.randomBytes(8).toString('hex'),
        });

        broadcastChatEvent(targetDid, fwdRecord);
        forwardedMessages.push(fwdRecord);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, forwardedCount: forwardedMessages.length, messages: forwardedMessages }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 8. Attachment Upload
  if (url.pathname === '/api/chat/attachment/upload' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 25 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = enforceAuth(req, res, parsed);
      if (!principal) return true;

      const rawData = parsed.dataUrl || parsed.base64 || parsed.content;
      if (!rawData || typeof rawData !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'File dataUrl is required' }));
        return true;
      }

      const commaIdx = rawData.indexOf(',');
      const base64Data = commaIdx >= 0 ? rawData.slice(commaIdx + 1) : rawData;
      const fileBuffer = Buffer.from(base64Data, 'base64');
      const rawName = String(parsed.name || 'file');
      const safeName = path.basename(rawName).replace(/["'\r\n\0]/g, '_') || 'file';
      const mimeType = String(parsed.type || 'application/octet-stream').toLowerCase();

      // Reject dangerous executables
      const hex4 = fileBuffer.subarray(0, 4).toString('hex').toLowerCase();
      const hex8 = fileBuffer.length >= 8 ? fileBuffer.subarray(0, 8).toString('hex').toLowerCase() : '';
      if (hex4.startsWith('4d5a') || hex8.startsWith('7f454c46')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Disallowed executable attachment format' }));
        return true;
      }

      if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
        const magicCheck = validateMediaMagicBytes(fileBuffer, mimeType);
        if (!magicCheck.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Invalid media attachment: ${magicCheck.error || 'Magic byte signature mismatch'}` }));
          return true;
        }
      }

      const cidObj = CID.create('raw', fileBuffer, false, 'sha2-256');
      const cid = cidObj.toString('base32');
      const storedPath = path.join(ATTACHMENTS_DIR, `${cid}_${safeName}`);
      fs.writeFileSync(storedPath, fileBuffer);

      if (storageDaemon && storageDaemon.blockstore) {
        try { await storageDaemon.blockstore.put(cidObj, fileBuffer); } catch (_) {}
      }

      const attachment = {
        name: safeName,
        type: mimeType,
        size: fileBuffer.length,
        cid,
        url: `/api/chat/attachment/${cid}?name=${encodeURIComponent(safeName)}`,
        dataUrl: rawData,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, attachment }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 9. Attachment Streaming / Download
  if (url.pathname.startsWith('/api/chat/attachment/') && req.method === 'GET') {
    const cidOrId = path.basename(url.pathname);
    if (!cidOrId || cidOrId.includes('..') || cidOrId.includes('/') || cidOrId.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid attachment identifier' }));
      return true;
    }

    const hasAuthToken = Boolean(
      req.headers.authorization ||
      req.headers['x-sovra-session-token'] ||
      (req.headers.cookie && req.headers.cookie.includes('sovra_session_token=')) ||
      url.searchParams.get('sessionToken') ||
      url.searchParams.get('token')
    );
    if (!hasAuthToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required to access attachment' }));
      return true;
    }

    let principal = resolvePrincipal(req);
    if (!principal) {
      const qToken = url.searchParams.get('token') || url.searchParams.get('sessionToken') || (req.headers['x-sovra-session-token'] as string);
      if (qToken && (qToken.startsWith('stk_guest_') || qToken.startsWith('mesh_token_') || qToken.startsWith('stk_'))) {
        const u = sovraDb.findUserBySessionToken(qToken);
        if (u) {
          principal = { did: u.did, sessionId: qToken, role: (u.role === 'SUPER_ADMIN' || u.role === 'ADMIN') ? u.role : 'USER', authenticationMethod: 'BEARER_TOKEN' } as any;
        } else if (qToken.startsWith('stk_guest_') || qToken.startsWith('mesh_token_')) {
          principal = { did: 'did:sovra:guest_' + qToken.slice(-8), sessionId: qToken, role: 'USER', authenticationMethod: 'BEARER_TOKEN' } as any;
        }
      }
    }
    if (!principal) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication required to access attachment' }));
      return true;
    }

    const allMessages = sovraDb.getState().chatMessages;
    const matchingMessages = allMessages.filter(m => 
      m.attachment?.cid === cidOrId ||
      m.id === cidOrId ||
      (m.attachment?.url && m.attachment.url.includes(cidOrId))
    );
    const matchingMsg = matchingMessages[matchingMessages.length - 1];

    if (matchingMessages.length > 0) {
      const isParticipant =
        principal.role === 'SUPER_ADMIN' ||
        principal.role === 'ADMIN' ||
        matchingMessages.some(m =>
          principal.did === m.senderDid ||
          principal.did === m.recipientDid ||
          m.recipientDid === 'self' ||
          m.recipientDid.startsWith('channel:') ||
          principal.did.startsWith('did:sovra:guest_')
        );

      if (!isParticipant) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: You do not have permission to access this attachment' }));
        return true;
      }
    }

    let targetFile: string | null = null;
    if (fs.existsSync(ATTACHMENTS_DIR)) {
      const files = fs.readdirSync(ATTACHMENTS_DIR);
      const match = files.find(f => f.startsWith(cidOrId + '_') || f === cidOrId || f.startsWith(cidOrId + '.'));
      if (match) {
        targetFile = path.join(ATTACHMENTS_DIR, match);
      }
    }

    if (!targetFile && matchingMsg && matchingMsg.attachment?.dataUrl) {
      try {
        const dUrl = matchingMsg.attachment.dataUrl;
        const commaIdx = dUrl.indexOf(',');
        const base64Data = commaIdx >= 0 ? dUrl.slice(commaIdx + 1) : dUrl;
        const buf = Buffer.from(base64Data, 'base64');
        const safeName = path.basename(matchingMsg.attachment.name || 'file').replace(/["'\r\n\0]/g, '_');
        const reconstructedPath = path.join(ATTACHMENTS_DIR, `${cidOrId}_${safeName}`);
        fs.writeFileSync(reconstructedPath, buf);
        targetFile = reconstructedPath;
      } catch (_) {}
    }

    if (!targetFile || !fs.existsSync(targetFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Attachment file not found' }));
      return true;
    }

    const queryName = url.searchParams.get('name');
    const filename = queryName
      ? path.basename(queryName).replace(/["'\r\n\0]/g, '_')
      : (matchingMsg?.attachment?.name ? path.basename(matchingMsg.attachment.name).replace(/["'\r\n\0]/g, '_') : path.basename(targetFile).replace(/^[a-z0-9]+_/, ''));

    let mimeType = matchingMsg?.attachment?.type || '';
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = path.extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.txt': 'text/plain; charset=utf-8',
        '.csv': 'text/csv; charset=utf-8',
        '.json': 'application/json',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      mimeType = mimeMap[ext] || 'application/octet-stream';
    }

    const forceDownload = url.searchParams.get('download') === '1';
    const isPreviewable = !forceDownload && (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/') ||
      mimeType === 'application/pdf' ||
      mimeType.startsWith('text/')
    );
    const dispositionType = isPreviewable ? 'inline' : 'attachment';
    const safeHeaderFilename = filename.replace(/["\r\n]/g, '_');

    const stat = fs.statSync(targetFile);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return true;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Content-Disposition': `${dispositionType}; filename="${safeHeaderFilename}"`,
        'Cache-Control': 'private, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'ETag': `"${cidOrId}"`,
      });
      fs.createReadStream(targetFile, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType,
        'Content-Disposition': `${dispositionType}; filename="${safeHeaderFilename}"`,
        'Cache-Control': 'private, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'ETag': `"${cidOrId}"`,
      });
      fs.createReadStream(targetFile).pipe(res);
    }
    return true;
  }

  // ==========================================
  // 📬 ZERO-KNOWLEDGE OFFLINE MAILBOX RELAY
  // (Solves Bottleneck #2: Store-and-Forward)
  // ==========================================

  // 10. Deposit Offline Encrypted Payload
  if (url.pathname === '/api/mailbox/deposit' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 2 * 1024 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = resolvePrincipal(req, parsed);
      const senderDid = principal?.did || String(parsed.senderDid || 'did:sovra:anonymous');

      const recipientDid = String(parsed.recipientDid || '');
      const encryptedPayload = String(parsed.encryptedPayload || '');
      if (!recipientDid || !encryptedPayload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'recipientDid and encryptedPayload are required' }));
        return true;
      }

      const mailboxMsg = sovraDb.depositMailboxMessage({
        recipientDid,
        senderDid,
        encryptedPayload,
        ivHex: parsed.ivHex ? String(parsed.ivHex) : undefined,
        tagHex: parsed.tagHex ? String(parsed.tagHex) : undefined,
        priority: parsed.priority === 'high' ? 'high' : 'normal',
        ttlSeconds: parsed.ttlSeconds ? Number(parsed.ttlSeconds) : undefined,
      });

      // Dispatch ZK Blind Push Wakeup to recipient device
      try {
        const blindChannelId = crypto.createHash('sha256').update(recipientDid).digest('hex');
        blindPushRelay.dispatchBlindSignal({
          blindChannelId,
          opaqueWakeupHint: crypto.randomBytes(16).toString('hex'),
          priority: 'high',
          timestamp: Date.now(),
        });
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deposited: true, mailboxId: mailboxMsg.id, expiresAt: mailboxMsg.expiresAt }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  // 11. Pull Pending Encrypted Mailbox Messages
  if (url.pathname === '/api/mailbox/pull' && req.method === 'GET') {
    const principal = resolvePrincipal(req);
    const userDid = principal?.did || url.searchParams.get('userDid') || url.searchParams.get('recipientDid') || '';
    if (!userDid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication or userDid required' }));
      return true;
    }

    const blindChannel = url.searchParams.get('channel') || undefined;
    const messages = sovraDb.pullMailboxMessages(userDid, blindChannel);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages, count: messages.length }));
    return true;
  }

  // 12. Acknowledge and Clear Delivered Mailbox Messages
  if (url.pathname === '/api/mailbox/ack' && req.method === 'POST') {
    const { body, ok } = await readBoundedBody(req, res, 64 * 1024);
    if (!ok) return true;
    try {
      const parsed = JSON.parse(body);
      const principal = resolvePrincipal(req, parsed);
      const userDid = principal?.did || String(parsed.userDid || parsed.recipientDid || '');
      if (!userDid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Authentication or userDid required' }));
        return true;
      }

      const messageIds: string[] = Array.isArray(parsed.messageIds)
        ? parsed.messageIds
        : (parsed.messageId ? [String(parsed.messageId)] : []);

      if (messageIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'messageIds array is required' }));
        return true;
      }

      const clearedCount = sovraDb.ackMailboxMessages(userDid, messageIds);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clearedCount }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
    }
    return true;
  }

  return false;
}
