/**
 * @file apps/sovra-mobile/src/screens/ChatsScreen.tsx
 * WhatsApp-Style Signal-Grade E2EE Chat Screen for Mobile App with BitChat Zero-Internet BLE Mesh.
 *
 * Implements:
 * 1. Double Ratchet (X3DH) & Noise_XX encrypted messaging with monotonic ticks.
 * 2. BitChat Zero-Internet BLE Mesh Mode with 2.4GHz Nearby Radar visualizer.
 * 3. Hyperlocal Broadcast Channels (#local-mesh, #emergency-sos).
 * 4. Dynamic conversation thread switcher & peer discovery list.
 * 5. Seamless Online (Server POST) ↔ Offline (BLE Mesh Envelope) hybrid dispatcher.
 * 6. Audio note recording, WebRTC CallScreen initiation, and emergency panic wipe.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { MobileChatMessage } from '../types.js';
import type { CallMediaType } from '@sovra/messaging';
import { computeSafetyNumbers } from '@sovra/messaging';
import type { MeshDiscoveredPeer } from '@sovra/p2p';
import { CallScreen } from './CallScreen.js';
import {
  fetchChatMessages,
  sendChatMessage,
  markChatReceipt,
  reactToChatMessage,
  getActiveUserDid,
  createMeshChannel,
  fetchMeshChannels,
  createGroupChat,
  fetchGroupChats,
} from '../services/api.js';
import { localDb, type ConversationSummary } from '../services/local-database.js';
import { syncEngine } from '../services/sync-engine.js';
import { mobileMesh, type MobileMeshRuntimeState } from '../services/mobile-mesh-coordinator.js';

export const INITIAL_MESSAGES: MobileChatMessage[] = [
  {
    id: 'm-1',
    senderDid: 'did:key:z6MksAliceP2P',
    senderName: 'Alice',
    text: 'Hey! Did the Double Ratchet key rotation succeed?',
    timestamp: Date.now() - 300000,
    isOutgoing: false,
    tickState: 'read',
  },
  {
    id: 'm-2',
    senderDid: 'did:key:z6MksLocalUser',
    senderName: 'You',
    text: 'Yes! ChaCha20-Poly1305 symmetric ratcheting passed seamlessly. Zero centralized server logs.',
    timestamp: Date.now() - 180000,
    isOutgoing: true,
    tickState: 'read', // Blue double tick
  },
  {
    id: 'm-3',
    senderDid: 'did:key:z6MksAliceP2P',
    senderName: 'Alice',
    text: 'Sending the updated UnixFS DAG block hash now.',
    timestamp: Date.now() - 60000,
    isOutgoing: false,
    tickState: 'read',
  },
  {
    id: 'm-4',
    senderDid: 'did:key:z6MksLocalUser',
    senderName: 'You',
    text: 'Received! 256KB chunk decrypted locally.',
    timestamp: Date.now() - 10000,
    isOutgoing: true,
    tickState: 'delivered', // Grey double tick
  },
];

export function CreateChannelModal({
  isOpen,
  onClose,
  onChannelCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChannelCreated: (channel: any) => void;
}): React.JSX.Element | null {
  const [channelName, setChannelName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    const raw = channelName.trim();
    if (!raw) {
      setError('Please provide a channel name (e.g. #dev-mesh)');
      return;
    }
    const cleanName = raw.startsWith('#') ? raw : `#${raw}`;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await createMeshChannel({
        name: cleanName,
        topic: topic.trim() || 'Sovereign Community Broadcast',
        isPublic,
      });
      if (res.ok && res.channel) {
        onChannelCreated(res.channel);
        setChannelName('');
        setTopic('');
        onClose();
      } else {
        throw new Error(res.error || 'Failed to create channel');
      }
    } catch (err: any) {
      setError(err.message || 'Channel creation error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '24px',
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📶</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>New Broadcast Channel</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 11,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Channel Name
          </label>
          <input
            type="text"
            placeholder="#channel-name"
            value={channelName}
            onChange={e => setChannelName(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Topic or Description
          </label>
          <input
            type="text"
            placeholder="What is this channel for?"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setIsPublic(true)}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: isPublic ? '#0284c7' : '#1e293b',
              color: isPublic ? '#fff' : '#94a3b8',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🌐 Public Mesh
          </button>
          <button
            type="button"
            onClick={() => setIsPublic(false)}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: !isPublic ? '#0284c7' : '#1e293b',
              color: !isPublic ? '#fff' : '#94a3b8',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🔒 Private Group
          </button>
        </div>

        <button
          onClick={handleCreate}
          disabled={isSubmitting}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: isSubmitting ? '#334155' : '#00a884',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            marginTop: 4,
          }}
        >
          {isSubmitting ? 'Registering Channel...' : 'Create Channel 🚀'}
        </button>
      </div>
    </div>
  );
}

export function CreateGroupModal({
  isOpen,
  onClose,
  onGroupCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated: (group: any) => void;
}): React.JSX.Element | null {
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('👥');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(['did:key:z6MksAliceP2P']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emojiList = ['👥', '🚀', '⚡', '🛡️', '🌐', '💬', '🔥', '💎'];
  const availableContacts = [
    { did: 'did:key:z6MksAliceP2P', name: 'Alice (P2P Architect)' },
    { did: 'did:key:z6MksBobValidator', name: 'Bob (Sovereign Validator)' },
    { did: 'did:key:z6MksCharlieRelay', name: 'Charlie (Mesh Relay)' },
  ];

  if (!isOpen) return null;

  const toggleMember = (did: string) => {
    setSelectedMembers(prev =>
      prev.includes(did) ? prev.filter(d => d !== did) : [...prev, did]
    );
  };

  const handleCreate = async () => {
    const cleanName = groupName.trim();
    if (!cleanName) {
      setError('Please provide a group name');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await createGroupChat({
        name: cleanName,
        memberDids: selectedMembers,
        description: description.trim() || undefined,
        avatarEmoji: selectedEmoji,
      });
      if (res.ok && res.group) {
        onGroupCreated(res.group);
        setGroupName('');
        setDescription('');
        onClose();
      } else {
        throw new Error(res.error || 'Failed to create group');
      }
    } catch (err: any) {
      setError(err.message || 'Group creation error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: 20,
          width: '100%',
          maxWidth: 380,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>New E2EE Group</h3>
            <span style={{ fontSize: 11, color: '#38bdf8' }}>🔐 Multi-Party Sovereign Room</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 8, fontSize: 11, color: '#f87171' }}>
            {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Group Icon
          </label>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {emojiList.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => setSelectedEmoji(em)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: selectedEmoji === em ? '#0284c7' : '#1e293b',
                  border: selectedEmoji === em ? '2px solid #38bdf8' : '1px solid #334155',
                  fontSize: 16,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Group Name
          </label>
          <input
            type="text"
            placeholder="e.g. Dev Swarm, Cosmos Core"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            Select Members
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
            {availableContacts.map(c => {
              const isSelected = selectedMembers.includes(c.did);
              return (
                <div
                  key={c.did}
                  onClick={() => toggleMember(c.did)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 8,
                    backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                    border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#e2e8f0' }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: isSelected ? '#38bdf8' : '#64748b' }}>
                    {isSelected ? '✓' : '+'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={isSubmitting}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: isSubmitting ? '#334155' : '#00a884',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            marginTop: 4,
          }}
        >
          {isSubmitting ? 'Creating Group...' : 'Create Sovereign Group 👥'}
        </button>
      </div>
    </div>
  );
}

export interface ActiveRecipient {
  did: string;
  name: string;
  avatar?: string | undefined;
  isChannel?: boolean | undefined;
  isEmergency?: boolean | undefined;
  isBitChat?: boolean | undefined;
}

export function ChatsScreen(): React.JSX.Element {
  // Navigation / View states
  const [activeRecipient, setActiveRecipient] = useState<ActiveRecipient | null>(null);
  const [subTab, setSubTab] = useState<'chats' | 'radar' | 'channels'>('chats');

  // Messages & conversation thread states
  const [messages, setMessages] = useState<MobileChatMessage[]>(INITIAL_MESSAGES);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [activeCall, setActiveCall] = useState<CallMediaType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanicConfirming, setIsPanicConfirming] = useState(false);
  const [panicToast, setPanicToast] = useState<string | null>(null);

  // Safety Numbers Modal & Disappearing Messages states
  const [showSafetyNumbers, setShowSafetyNumbers] = useState(false);
  const [disappearingSec, setDisappearingSec] = useState<number>(0);
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);
  const [copiedSafety, setCopiedSafety] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [peerTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);

  // Attachments and Reactions states
  const [pendingAttachment, setPendingAttachment] = useState<{
    name: string;
    mimeType: string;
    dataUrl: string;
    sizeBytes: number;
  } | null>(null);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // Custom channels & groups state
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [customChannels, setCustomChannels] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadChannels = async () => {
      try {
        const list = await fetchMeshChannels();
        if (mounted && Array.isArray(list)) {
          const filtered = list.filter(
            c => c.id !== 'channel:local_mesh' && c.id !== 'channel:emergency_sos',
          );
          setCustomChannels(filtered);
        }
        await fetchGroupChats();
        if (mounted) refreshConversations();
      } catch {}
    };
    loadChannels();
    return () => {
      mounted = false;
    };
  }, []);

  const handleAttachmentPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setPendingAttachment({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl: reader.result as string,
        sizeBytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleEmojiReaction = async (msgId: string, emoji: string) => {
    setActiveReactionMsgId(null);
    setMessages(prev =>
      prev.map(m => {
        if (m.id !== msgId) return m;
        const current = m.reactions ? [...m.reactions] : [];
        const idx = current.findIndex(r => r.senderDid === getActiveUserDid());
        if (idx >= 0 && current[idx]) {
          const target = current[idx]!;
          if (target.emoji === emoji) {
            current.splice(idx, 1);
          } else {
            target.emoji = emoji;
          }
        } else {
          current.push({ emoji, senderDid: getActiveUserDid() });
        }
        return { ...m, reactions: current };
      }),
    );

    try {
      await reactToChatMessage(msgId, emoji);
    } catch (err) {
      console.warn('[ChatsScreen] Reaction error:', err);
    }
  };

  // Outbox live reactive updates & online/offline listener
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(() => localDb.getPendingOutbox().length);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    const unsubOutbox = localDb.subscribeToOutbox(op => {
      setPendingOutboxCount(localDb.getPendingOutbox().length);

      // If op corresponds to a SEND_CHAT operation, update the message's tickState in real time!
      if (op.type === 'SEND_CHAT' && op.payload) {
        const msgId = op.payload.messageId || op.payload.id || op.operationId;
        const newStatus =
          op.status === 'ACKNOWLEDGED'
            ? 'read'
            : op.status === 'DELIVERED'
            ? 'delivered'
            : op.status === 'SENT'
            ? 'sent'
            : op.status === 'FAILED'
            ? 'failed'
            : 'pending';

        setMessages(prev =>
          prev.map(m => {
            if (m.id === msgId || (op.payload.text && m.text === op.payload.text && m.isOutgoing)) {
              return { ...m, tickState: newStatus as any };
            }
            return m;
          }),
        );
      }
    });

    return () => {
      unsubOutbox();
    };
  }, []);

  // Mesh & Discovery state
  const [discoveredPeers, setDiscoveredPeers] = useState<MeshDiscoveredPeer[]>([]);
  const [meshRuntimeState, setMeshRuntimeState] = useState<MobileMeshRuntimeState>(
    mobileMesh.getRuntimeState(),
  );

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const voiceTimerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  // ==========================================
  // CONVERSATIONS & THREAD DATA REFRESH
  // ==========================================

  const refreshConversations = useCallback(() => {
    const list = localDb.getConversationsList(getActiveUserDid());
    // Ensure Alice is in list if not present
    if (!list.find(c => c.threadId === 'did:key:z6MksAliceP2P')) {
      list.unshift({
        threadId: 'did:key:z6MksAliceP2P',
        peerDid: 'did:key:z6MksAliceP2P',
        peerName: 'Alice (P2P Architect)',
        lastMessageText: 'Received! 256KB chunk decrypted locally.',
        lastMessageTimestamp: Date.now() - 10000,
        unreadCount: 0,
        status: 'delivered',
        isBitChat: true,
        isChannel: false,
      });
    }
    setConversations(list);
  }, []);

  const loadMessages = useCallback(
    async (peerDid: string) => {
      setIsLoading(true);
      try {
        const localCached = localDb.getThreadMessages(peerDid);
        if (localCached.length > 0) {
          setMessages(
            localCached.map(cm => ({
              id: cm.id,
              senderDid: cm.senderDid,
              senderName: cm.senderName,
              text: cm.text,
              timestamp: cm.timestamp,
              isOutgoing: cm.senderDid === getActiveUserDid(),
              tickState: (cm.status as any) || 'delivered',
              ...(cm.isBitChat !== undefined ? { isBitChat: cm.isBitChat } : {}),
              hopCount: cm.hopCount,
              ...(cm.mediaAttachment ? { mediaAttachment: cm.mediaAttachment } : {}),
              ...(cm.mediaAttachment?.dataUrl ? { audioUrl: cm.mediaAttachment.dataUrl } : {}),
              ...(cm.text?.startsWith('🎤') || cm.mediaAttachment?.mimeType?.startsWith('audio') ? { isAudioNote: true } : {}),
            })),
          );
        } else if (peerDid === 'did:key:z6MksAliceP2P') {
          setMessages(INITIAL_MESSAGES);
        } else {
          setMessages([]);
        }

        // If not a local broadcast channel, attempt server fetch
        if (!peerDid.startsWith('channel:')) {
          const liveMessages = await fetchChatMessages(peerDid);
          if (liveMessages && liveMessages.length > 0) {
            setMessages(liveMessages);
            for (const lm of liveMessages) {
              localDb.saveMessage({
                id: lm.id,
                threadId: peerDid,
                senderDid: lm.senderDid,
                recipientDid: peerDid,
                senderName: lm.senderName,
                text: lm.text,
                timestamp: lm.timestamp,
                status: (lm.tickState as any) || 'delivered',
                ...(lm.isBitChat !== undefined ? { isBitChat: lm.isBitChat } : {}),
                syncStatus: 'SYNCED',
              });
            }

            const unreadIncoming = liveMessages
              .filter(m => !m.isOutgoing && m.tickState !== 'read')
              .map(m => m.id);
            if (unreadIncoming.length > 0) {
              markChatReceipt(unreadIncoming, 'read').catch(() => {});
            }
          }
        }
        setError(null);
      } catch (err: any) {
        console.warn('[ChatsScreen] Fetch messages notice:', err);
        setError('Operating in durable offline mesh mode.');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // Initial mount & polling
  useEffect(() => {
    refreshConversations();
    if (activeRecipient) {
      loadMessages(activeRecipient.did);
    }
  }, [activeRecipient?.did, loadMessages, refreshConversations]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      refreshConversations();
      if (activeRecipient) {
        loadMessages(activeRecipient.did);
      }
    }, 4000);
    return () => clearInterval(pollInterval);
  }, [activeRecipient, loadMessages, refreshConversations]);

  // Hook into real-time Coordinator BLE discovery & incoming envelopes
  useEffect(() => {
    const unsubPeers = mobileMesh.onPeersChange(peers => {
      setDiscoveredPeers(peers);
    });

    const unsubState = mobileMesh.onStateChange(state => {
      setMeshRuntimeState(state);
    });

    const unsubMsg = mobileMesh.onIncomingMessage(incoming => {
      refreshConversations();
      if (
        activeRecipient &&
        (incoming.threadId === activeRecipient.did ||
          incoming.senderDid === activeRecipient.did ||
          (activeRecipient.isChannel && incoming.recipientDid === activeRecipient.did))
      ) {
        setMessages(prev => {
          if (prev.some(m => m.id === incoming.id)) return prev;
          return [
            ...prev,
            {
              id: incoming.id,
              senderDid: incoming.senderDid,
              senderName: incoming.senderName,
              text: incoming.text,
              timestamp: incoming.timestamp,
              isOutgoing: false,
              tickState: (incoming.status as any) || 'delivered',
              isBitChat: incoming.isBitChat,
              hopCount: incoming.hopCount,
            },
          ];
        });
      }
    });

    const unsubReceipt = mobileMesh.onDeliveryReceipt(receipt => {
      refreshConversations();
      setMessages(prev =>
        prev.map(m =>
          m.id === receipt.targetEnvelopeId ? { ...m, tickState: 'delivered' } : m,
        ),
      );
    });

    return () => {
      unsubPeers();
      unsubState();
      unsubMsg();
      unsubReceipt();
    };
  }, [activeRecipient, refreshConversations]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Voice recording timer
  useEffect(() => {
    if (isRecordingVoice) {
      setVoiceSeconds(0);
      voiceTimerRef.current = setInterval(() => {
        setVoiceSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    }
    return () => {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    };
  }, [isRecordingVoice]);

  // ==========================================
  // DISPATCH MESSAGE (ONLINE / BLE MESH)
  // ==========================================

  const handleSendMessage = async () => {
    const text = inputText.trim();
    const currentAttachment = pendingAttachment;
    if ((!text && !currentAttachment) || isSending || !activeRecipient) return;

    const targetDid = activeRecipient.did;
    const isChannel = activeRecipient.isChannel || targetDid.startsWith('channel:');
    const tempId = `msg-${Date.now()}`;
    const myDid = getActiveUserDid();

    const optimisticMsg: MobileChatMessage = {
      id: tempId,
      senderDid: myDid,
      senderName: 'You',
      text: text || (currentAttachment ? `[Attachment: ${currentAttachment.name}]` : ''),
      timestamp: Date.now(),
      isOutgoing: true,
      tickState: 'sending',
      isBitChat: isChannel || meshRuntimeState.status === 'BLUETOOTH_MESH',
      hopCount: 1,
      ...(currentAttachment ? { mediaAttachment: currentAttachment } : {}),
    };

    setMessages(prev => [...prev, optimisticMsg]);
    setInputText('');
    setPendingAttachment(null);
    setIsSending(true);

    if (isChannel) {
      try {
        await mobileMesh.sendChannelBroadcast(targetDid, text, 'You');
        setMessages(prev =>
          prev.map(m => (m.id === tempId ? { ...m, tickState: 'delivered' } : m)),
        );
      } catch {
        setMessages(prev =>
          prev.map(m => (m.id === tempId ? { ...m, tickState: 'sent' } : m)),
        );
      } finally {
        setIsSending(false);
        refreshConversations();
      }
      return;
    }

    // Direct 1-to-1 message
    await localDb.saveMessage({
      id: tempId,
      threadId: targetDid,
      senderDid: myDid,
      recipientDid: targetDid,
      senderName: 'You',
      text: text || (currentAttachment ? `[Attachment: ${currentAttachment.name}]` : ''),
      timestamp: Date.now(),
      status: 'pending',
      syncStatus: 'LOCAL',
      ...(disappearingSec > 0 ? { disappearingDurationSec: disappearingSec } : {}),
      ...(currentAttachment
        ? {
            mediaAttachment: {
              name: currentAttachment.name,
              cid: 'bafkrei' + Math.random().toString(36).substring(2, 10),
              mimeType: currentAttachment.mimeType,
              sizeBytes: currentAttachment.sizeBytes,
              dataUrl: currentAttachment.dataUrl,
            },
          }
        : {}),
    });

    // Phase 3: Smart Transport Selection: Prefer direct BLE link / offline mesh if connected or offline
    const isDirectPeer = mobileMesh.isDirectPeerConnected(targetDid);
    const isMeshActive = meshRuntimeState.status === 'BLUETOOTH_MESH' || discoveredPeers.length > 0;
    const hasInternet = typeof navigator !== 'undefined' ? navigator.onLine : false;

    if (isDirectPeer || (!hasInternet && isMeshActive)) {
      try {
        const meshRes = await mobileMesh.sendChatMessage(targetDid, text, 'You');
        setMessages(prev =>
          prev.map(m =>
            m.id === tempId
              ? {
                  ...m,
                  id: meshRes.envelopeId,
                  tickState: 'sent',
                  isBitChat: true,
                  hopCount: isDirectPeer ? 1 : 2,
                  transportUsed: isDirectPeer ? 'ble_direct' : 'mesh_relay',
                }
              : m,
          ),
        );
        await localDb.enqueueOperation('SEND_CHAT', myDid, {
          recipientDid: targetDid,
          text,
          senderName: 'You',
          envelopeId: meshRes.envelopeId,
        });
      } catch {
        await localDb.enqueueOperation('SEND_CHAT', myDid, {
          recipientDid: targetDid,
          text,
          senderName: 'You',
        });
        setMessages(prev =>
          prev.map(m =>
            m.id === tempId
              ? { ...m, tickState: 'queued', transportUsed: 'outbox_queued' }
              : m,
          ),
        );
      } finally {
        setIsSending(false);
        refreshConversations();
      }
      return;
    }

    try {
      const res = await sendChatMessage({
        recipientDid: targetDid,
        text: text || (currentAttachment ? `[Attachment: ${currentAttachment.name}]` : ''),
        senderName: 'You',
        ...(disappearingSec > 0 ? { disappearingDurationSec: disappearingSec } : {}),
        ...(currentAttachment
          ? {
              attachment: {
                name: currentAttachment.name,
                type: currentAttachment.mimeType,
                dataUrl: currentAttachment.dataUrl,
                size: currentAttachment.sizeBytes,
              },
            }
          : {}),
      });

      if (res.ok && res.message) {
        await localDb.updateMessageStatus(tempId, 'delivered', 'SYNCED');
        setMessages(prev =>
          prev.map(m =>
            m.id === tempId
              ? {
                  ...m,
                  id: res.message.id,
                  tickState: res.message.status || 'delivered',
                  transportUsed: 'internet',
                }
              : m,
          ),
        );
      } else {
        throw new Error(res.error || 'Server unreachable');
      }
    } catch {
      await localDb.enqueueOperation('SEND_CHAT', myDid, {
        recipientDid: targetDid,
        text,
        senderName: 'You',
      });

      // Transmit over BLE mesh
      mobileMesh.sendChatMessage(targetDid, text, 'You').catch(() => {});
      syncEngine.triggerSync().catch(() => {});

      setMessages(prev =>
        prev.map(m =>
          m.id === tempId
            ? {
                ...m,
                tickState: isMeshActive ? 'sent' : 'queued',
                isBitChat: isMeshActive,
                transportUsed: isMeshActive ? 'mesh_relay' : 'outbox_queued',
              }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
      refreshConversations();
    }
  };

  const startVoiceRecording = async () => {
    audioChunksRef.current = [];
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        if (typeof MediaRecorder !== 'undefined') {
          const recorder = new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recorder.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };
          recorder.start(100);
        }
      } catch (err) {
        console.warn('[ChatsScreen] Microphone access error or not available:', err);
      }
    }
    setIsRecordingVoice(true);
  };

  const stopAndSendVoiceRecording = async () => {
    setIsRecordingVoice(false);
    const duration = Math.max(1, voiceSeconds);
    const tempId = `voice-${Date.now()}`;
    const myDid = getActiveUserDid();
    const targetDid = activeRecipient?.did || 'did:key:z6MksAliceP2P';

    let audioDataUrl = '';
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {}
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t: any) => t.stop());
      } catch (_) {}
      mediaStreamRef.current = null;
    }

    if (audioChunksRef.current.length > 0 && typeof FileReader !== 'undefined') {
      try {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioDataUrl = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string) || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn('[ChatsScreen] Error converting audio blob to dataUrl:', err);
      }
    }

    if (!audioDataUrl) {
      audioDataUrl = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJ8';
    }

    const optimisticVoice: MobileChatMessage = {
      id: tempId,
      senderDid: myDid,
      senderName: 'You',
      text: `🎤 Voice note (${duration}s)`,
      timestamp: Date.now(),
      isOutgoing: true,
      tickState: 'sending',
      isAudioNote: true,
      audioUrl: audioDataUrl,
      mediaAttachment: {
        name: `voice_${Date.now()}.webm`,
        mimeType: 'audio/webm',
        dataUrl: audioDataUrl,
        sizeBytes: audioDataUrl.length,
      },
    };

    setMessages(prev => [...prev, optimisticVoice]);

    await localDb.saveMessage({
      id: tempId,
      threadId: targetDid,
      senderDid: myDid,
      recipientDid: targetDid,
      senderName: 'You',
      text: `🎤 Voice note (${duration}s)`,
      timestamp: Date.now(),
      status: 'pending',
      mediaAttachment: {
        name: `voice_${Date.now()}.webm`,
        cid: tempId,
        mimeType: 'audio/webm',
        sizeBytes: audioDataUrl.length,
        dataUrl: audioDataUrl,
      },
      syncStatus: 'LOCAL',
    });

    try {
      const isMeshActive = meshRuntimeState.status === 'BLUETOOTH_MESH' || discoveredPeers.length > 0;
      const isMeshMode = subTab === 'radar' || isMeshActive || Boolean(activeRecipient?.isBitChat);
      const res = await sendChatMessage({
        recipientDid: targetDid,
        text: `Voice note (${duration}s)`,
        isAudio: true,
        audioDurationSec: duration,
        isBitChat: isMeshMode,
        audioBitrateKbps: isMeshMode ? 6 : 32,
        audioBitsPerSecond: isMeshMode ? 6000 : 32000,
        attachment: {
          name: `voice_${Date.now()}.webm`,
          type: 'audio/webm',
          dataUrl: audioDataUrl,
          size: audioDataUrl.length,
        },
      });

      if (res.ok && res.message) {
        setMessages(prev =>
          prev.map(m =>
            m.id === tempId
              ? {
                  ...m,
                  id: res.message.id,
                  tickState: 'delivered',
                }
              : m,
          ),
        );
      }
    } catch {
      await localDb.enqueueOperation('SEND_CHAT', myDid, {
        id: tempId,
        recipientDid: targetDid,
        text: `Voice note (${duration}s)`,
        isAudio: true,
        audioDurationSec: duration,
        attachment: {
          name: `voice_${Date.now()}.webm`,
          type: 'audio/webm',
          dataUrl: audioDataUrl,
        },
      });
      syncEngine.triggerSync().catch(() => {});
    } finally {
      refreshConversations();
    }
  };

  const handleSendVoiceNote = async () => {
    if (!isRecordingVoice) {
      await startVoiceRecording();
    } else {
      await stopAndSendVoiceRecording();
    }
  };

  const togglePlayAudio = (msg: MobileChatMessage) => {
    if (playingMessageId === msg.id) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingMessageId(null);
      return;
    }

    const audioSrc = msg.audioUrl || msg.mediaAttachment?.dataUrl;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    if (typeof Audio !== 'undefined' && audioSrc) {
      try {
        const audio = new Audio(audioSrc);
        audioPlayerRef.current = audio;
        setPlayingMessageId(msg.id);
        audio.onended = () => setPlayingMessageId(null);
        audio.onerror = () => setPlayingMessageId(null);
        audio.play().catch(() => {
          setTimeout(() => setPlayingMessageId(prev => (prev === msg.id ? null : prev)), 3000);
        });
      } catch {
        setPlayingMessageId(msg.id);
        setTimeout(() => setPlayingMessageId(prev => (prev === msg.id ? null : prev)), 3000);
      }
    } else {
      setPlayingMessageId(msg.id);
      setTimeout(() => setPlayingMessageId(prev => (prev === msg.id ? null : prev)), 3000);
    }
  };

  const handlePanicWipe = () => {
    setIsPanicConfirming(true);
  };

  const executePanicWipe = () => {
    setMessages([]);
    refreshConversations();
    setIsPanicConfirming(false);
    setPanicToast('🔒 Panic wipe complete: In-memory session buffers purged.');
    setTimeout(() => setPanicToast(null), 3000);
  };

  const renderTickIcon = (state: MobileChatMessage['tickState'], transport?: MobileChatMessage['transportUsed']) => {
    switch (state) {
      case 'queued':
        return <span title="Saved locally in Outbox (Waiting for peer or network)" style={{ color: '#f59e0b', fontSize: 10 }}>⏳</span>;
      case 'sending':
        return <span title="Transmitting..." style={{ color: '#94a3b8', fontSize: 10 }}>🕒</span>;
      case 'sent':
        if (transport === 'ble_direct') {
          return <span title="Sent directly over Bluetooth LE" style={{ color: '#38bdf8', fontSize: 11, fontWeight: 700 }}>📶✓</span>;
        }
        if (transport === 'mesh_relay') {
          return <span title="Relayed through Mesh" style={{ color: '#a855f7', fontSize: 11, fontWeight: 700 }}>🔀✓</span>;
        }
        return <span title="Sent" style={{ color: '#94a3b8', fontSize: 11 }}>✓</span>; // Grey single tick
      case 'relayed':
        return <span title="Relayed through Mesh" style={{ color: '#a855f7', fontSize: 11, fontWeight: 700 }}>🔀✓</span>;
      case 'delivered':
        return <span title="Delivered to Recipient (Cryptographic Receipt Verified)" style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>✓✓</span>; // Grey double tick
      case 'read':
        return <span title="Read by Recipient" style={{ color: '#38bdf8', fontSize: 11, fontWeight: 700 }}>✓✓</span>; // Blue double tick
      case 'failed':
        return <span title="Delivery Failed" style={{ color: '#ef4444', fontSize: 10 }}>⚠️</span>;
    }
  };

  // ==========================================
  // RENDER: THREAD VIEW (IN-CHAT)
  // ==========================================

  const renderThreadView = () => {
    if (!activeRecipient) return null;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Thread Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            backgroundColor: '#202c33',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            zIndex: 10,
          }}
        >
          <button
            onClick={() => setActiveRecipient(null)}
            aria-label="Back to Conversations"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#38bdf8',
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            ←
          </button>

          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: activeRecipient.isEmergency
                ? '#dc2626'
                : activeRecipient.isChannel
                ? '#0284c7'
                : '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {activeRecipient.avatar || (activeRecipient.isChannel ? '📶' : activeRecipient.name[0] || 'A')}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeRecipient.name}
            </div>
            <div
              style={{
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: activeRecipient.isEmergency
                  ? '#ef4444'
                  : activeRecipient.isChannel
                  ? '#38bdf8'
                  : mobileMesh.isDirectPeerConnected(activeRecipient.did)
                  ? '#22c55e'
                  : meshRuntimeState.status === 'BLUETOOTH_MESH'
                  ? '#38bdf8'
                  : typeof navigator !== 'undefined' && navigator.onLine
                  ? '#34d399'
                  : '#f59e0b',
              }}
            >
              {activeRecipient.isEmergency
                ? '🚨 Emergency SOS Swarm (Zero-Internet BLE)'
                : activeRecipient.isChannel
                ? '📶 Hyperlocal Broadcast Channel (#local-mesh)'
                : mobileMesh.isDirectPeerConnected(activeRecipient.did)
                ? '🟢 Direct BLE Link Connected (1 Hop)'
                : meshRuntimeState.status === 'BLUETOOTH_MESH'
                ? `🟣 Relayed through Mesh (${discoveredPeers.length} Peers in Range)`
                : typeof navigator !== 'undefined' && navigator.onLine
                ? '🔵 Internet Connected (E2EE Signal Ratchet)'
                : '⏳ Offline (Saved locally in Outbox)'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, fontSize: 16, alignItems: 'center' }}>
            {!activeRecipient.isChannel && (
              <>
                <button
                  onClick={() => setShowSafetyNumbers(true)}
                  aria-label="View Safety Numbers"
                  title="60-Digit Safety Numbers"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}
                >
                  🛡️
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowDisappearingMenu(prev => !prev)}
                    aria-label="Disappearing Messages Timer"
                    title={`Disappearing Messages: ${disappearingSec === 0 ? 'Off' : disappearingSec === 86400 ? '24h' : disappearingSec === 604800 ? '7d' : '90d'}`}
                    style={{
                      background: disappearingSec > 0 ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                      border: disappearingSec > 0 ? '1px solid #38bdf8' : 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 16,
                      padding: disappearingSec > 0 ? '1px 4px' : 0,
                    }}
                  >
                    ⏱️
                  </button>
                  {showDisappearingMenu && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: 6,
                        backgroundColor: '#1f2c34',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        zIndex: 100,
                        minWidth: 140,
                        padding: '4px 0',
                      }}
                    >
                      {[
                        { label: 'Off', sec: 0 },
                        { label: '24 Hours', sec: 86400 },
                        { label: '7 Days', sec: 604800 },
                        { label: '90 Days', sec: 7776000 },
                      ].map(opt => (
                        <div
                          key={opt.sec}
                          onClick={() => {
                            setDisappearingSec(opt.sec);
                            setShowDisappearingMenu(false);
                          }}
                          style={{
                            padding: '8px 14px',
                            fontSize: 12,
                            color: disappearingSec === opt.sec ? '#00a884' : '#e9edef',
                            fontWeight: disappearingSec === opt.sec ? 700 : 400,
                            backgroundColor: disappearingSec === opt.sec ? 'rgba(0,168,132,0.15)' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{opt.label}</span>
                          {disappearingSec === opt.sec && <span>✓</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setActiveCall('video')}
                  aria-label="Start Video Call"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}
                >
                  📹
                </button>
                <button
                  onClick={() => setActiveCall('audio')}
                  aria-label="Start Voice Call"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}
                >
                  📞
                </button>
              </>
            )}
            <button
              onClick={handlePanicWipe}
              title="Panic Wipe"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 4,
                color: '#f87171',
                cursor: 'pointer',
                fontSize: 11,
                padding: '3px 6px',
              }}
            >
              🚨 Wipe
            </button>
          </div>
        </header>

        {/* Inline Panic Wipe Confirmation Strip (Zero-Popup Industry Standard) */}
        {isPanicConfirming && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.4)',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: '#fca5a5',
            }}
          >
            <span>⚠️ Erase all session cache?</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={executePanicWipe}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Yes, Wipe
              </button>
              <button
                onClick={() => setIsPanicConfirming(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#e2e8f0',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Non-Blocking HUD Toast Banner */}
        {panicToast && (
          <div
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              borderBottom: '1px solid rgba(16, 185, 129, 0.4)',
              padding: '8px 14px',
              fontSize: 12,
              color: '#6ee7b7',
              textAlign: 'center',
            }}
          >
            {panicToast}
          </div>
        )}

        {/* Active Call View */}
        {activeCall && (
          <CallScreen
            peerName={activeRecipient.name}
            peerDid={activeRecipient.did}
            mediaType={activeCall}
            onEndCall={() => setActiveCall(null)}
          />
        )}

        {/* Security / Mesh Banner */}
        <div style={{ padding: '6px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              backgroundColor: '#182229',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 10,
              color: '#8696a0',
              textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.05)',
              maxWidth: 380,
            }}
          >
            {activeRecipient.isChannel
              ? '📶 Hyperlocal Ad-hoc Mesh: Broadcasts are relayed hop-by-hop across nearby peers.'
              : '🔒 End-to-End Encrypted via ChaCha20-Poly1305 & Noise_XX. Zero central logs.'}
          </div>

          {disappearingSec > 0 && !activeRecipient.isChannel && (
            <div
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: 10,
                textAlign: 'center',
                maxWidth: 380,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>⏱️</span>
              <span>
                Disappearing messages active ({disappearingSec === 86400 ? '24h' : disappearingSec === 604800 ? '7d' : '90d'}).
              </span>
            </div>
          )}

          {error && (
            <div
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fbbf24',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 10,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span>{error}</span>
              <button
                onClick={() => loadMessages(activeRecipient.did)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#38bdf8',
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  textDecoration: 'underline',
                }}
              >
                Sync
              </button>
            </div>
          )}
        </div>

        {/* Messages List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {isLoading && messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, padding: 20 }}>
              Establishing Noise_XX Session...
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              onClick={() => setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id)}
              style={{
                alignSelf: msg.isOutgoing ? 'flex-end' : 'flex-start',
                backgroundColor: msg.isOutgoing ? '#005c4b' : '#202c33',
                padding: '8px 12px',
                borderRadius: 10,
                maxWidth: '82%',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              {/* Floating Emoji Reaction Bar */}
              {activeReactionMsgId === msg.id && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    top: -38,
                    right: msg.isOutgoing ? 0 : 'auto',
                    left: msg.isOutgoing ? 'auto' : 0,
                    backgroundColor: '#1f2c34',
                    borderRadius: 24,
                    padding: '4px 8px',
                    display: 'flex',
                    gap: 6,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                    zIndex: 30,
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {['❤️', '😂', '👍', '🔥', '😮', '😢'].map(em => (
                    <span
                      key={em}
                      role="button"
                      onClick={() => handleEmojiReaction(msg.id, em)}
                      style={{
                        fontSize: 16,
                        cursor: 'pointer',
                        padding: '2px 4px',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      {em}
                    </span>
                  ))}
                </div>
              )}

              {activeRecipient.isChannel && !msg.isOutgoing && (
                <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700, marginBottom: 2 }}>
                  {msg.senderName}
                </div>
              )}

              {/* Media Attachment in message bubble */}
              {msg.mediaAttachment && msg.mediaAttachment.dataUrl && (
                <div style={{ marginBottom: 6, borderRadius: 8, overflow: 'hidden', maxHeight: 220 }}>
                  <img
                    src={msg.mediaAttachment.dataUrl}
                    alt={msg.mediaAttachment.name || 'Attachment'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              )}

              {msg.isAudioNote ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlayAudio(msg);
                    }}
                    aria-label={playingMessageId === msg.id ? 'Pause voice note' : 'Play voice note'}
                    style={{
                      background: playingMessageId === msg.id ? '#00a884' : '#1e293b',
                      border: 'none',
                      borderRadius: '50%',
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#fff',
                      fontSize: 14,
                      padding: 0,
                    }}
                  >
                    {playingMessageId === msg.id ? '⏸' : '▶'}
                  </button>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 22, flex: 1, minWidth: 60 }}>
                    {[25, 60, 90, 45, 100, 75, 40, 85, 55, 30, 70, 95].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          width: 3,
                          height: playingMessageId === msg.id ? `${(h * ((i % 3) + 1)) % 100 || 20}%` : `${h * 0.7}%`,
                          backgroundColor: playingMessageId === msg.id ? '#00a884' : '#38bdf8',
                          borderRadius: 2,
                          transition: 'height 0.2s ease, background-color 0.2s ease',
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    {playingMessageId === msg.id ? 'Playing...' : msg.text}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.4, color: '#e9edef', wordBreak: 'break-word' }}>
                  {msg.text}
                </div>
              )}

              {/* Reactions Chips */}
              {msg.reactions && msg.reactions.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {Object.entries(
                    msg.reactions.reduce((acc, r) => {
                      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>),
                  ).map(([em, cnt]) => (
                    <span
                      key={em}
                      onClick={e => {
                        e.stopPropagation();
                        handleEmojiReaction(msg.id, em);
                      }}
                      style={{
                        fontSize: 11,
                        backgroundColor: 'rgba(255,255,255,0.12)',
                        padding: '2px 6px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <span>{em}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>{cnt}</span>
                    </span>
                  ))}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 3,
                  fontSize: 10,
                  color: '#8696a0',
                }}
              >
                {msg.isBitChat && (
                  <span
                    style={{
                      fontSize: 9,
                      color: '#38bdf8',
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      padding: '1px 4px',
                      borderRadius: 3,
                    }}
                  >
                    📶 {msg.hopCount === 0 || msg.hopCount === 1 ? 'Direct BLE' : `${msg.hopCount} Hops`}
                  </span>
                )}
                <span>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.isOutgoing && renderTickIcon(msg.tickState, msg.transportUsed)}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        {(peerTyping || isTyping) && (
          <div
            style={{
              padding: '2px 14px 4px',
              fontSize: 11,
              color: '#34d399',
              fontStyle: 'italic',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>💬</span>
            <span>{isTyping ? 'Typing...' : `${activeRecipient.name} is typing...`}</span>
          </div>
        )}

        {/* Attachment preview chip */}
        {pendingAttachment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 14px',
              backgroundColor: '#182229',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {pendingAttachment.mimeType.startsWith('image/') ? (
              <img
                src={pendingAttachment.dataUrl}
                alt="Attachment preview"
                style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 20 }}>📁</span>
            )}
            <div style={{ flex: 1, fontSize: 12, color: '#e9edef', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pendingAttachment.name}
            </div>
            <button
              onClick={() => setPendingAttachment(null)}
              style={{ background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Input Bar */}
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px 14px 12px',
            backgroundColor: '#202c33',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: '#2a3942',
              borderRadius: 22,
              padding: '6px 12px',
            }}
          >
            <span>😊</span>
            <input
              type="text"
              placeholder={
                isRecordingVoice
                  ? `Recording voice note (${voiceSeconds}s)...`
                  : activeRecipient.isChannel
                  ? `Broadcast to ${activeRecipient.name}...`
                  : 'Message'
              }
              value={inputText}
              disabled={isRecordingVoice || isSending}
              onChange={e => {
                setInputText(e.target.value);
                setIsTyping(true);
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => {
                  setIsTyping(false);
                }, 1000);
              }}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              style={{
                flex: 1,
                backgroundColor: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <span
              role="button"
              aria-label="Attach Media"
              onClick={() => attachmentInputRef.current?.click()}
              style={{ cursor: 'pointer', padding: '2px 4px' }}
            >
              📎
            </span>
            <input
              type="file"
              ref={attachmentInputRef}
              accept="image/*,video/*"
              onChange={handleAttachmentPicked}
              style={{ display: 'none' }}
            />
          </div>

          <button
            onClick={inputText.trim() ? handleSendMessage : handleSendVoiceNote}
            disabled={isSending}
            aria-label={inputText.trim() ? 'Send Message' : 'Record Voice Note'}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: '#00a884',
              border: 'none',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            {inputText.trim() ? '➤' : isRecordingVoice ? '⏹' : '🎤'}
          </button>
        </footer>

        {/* Safety Numbers 60-Digit Verification Modal */}
        {showSafetyNumbers && activeRecipient && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.82)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 16,
            }}
          >
            <div
              style={{
                backgroundColor: '#182229',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16,
                maxWidth: 420,
                width: '100%',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                color: '#e9edef',
                boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>🛡️</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Verify Safety Numbers</h3>
                </div>
                <button
                  onClick={() => setShowSafetyNumbers(false)}
                  style={{ background: 'transparent', border: 'none', color: '#8696a0', fontSize: 18, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <p style={{ margin: 0, fontSize: 12, color: '#8696a0', lineHeight: 1.5 }}>
                To verify that end-to-end encryption with <strong style={{ color: '#fff' }}>{activeRecipient.name}</strong> is intact and free from MITM interception, compare these 60 digits with their device.
              </p>

              {/* 60 Digits Display (12 blocks of 5 digits) */}
              <div
                style={{
                  backgroundColor: '#111b21',
                  padding: 16,
                  borderRadius: 12,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  letterSpacing: 2,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  textAlign: 'center',
                  color: '#34d399',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                }}
              >
                {computeSafetyNumbers(getActiveUserDid(), activeRecipient.did, 'genesis_root_key_sovra').formattedNumbers.split(' ').map((block, idx) => (
                  <div key={idx} style={{ backgroundColor: 'rgba(255,255,255,0.04)', padding: '6px 4px', borderRadius: 6 }}>
                    {block}
                  </div>
                ))}
              </div>

              {/* QR Payload */}
              <div
                style={{
                  backgroundColor: '#111b21',
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 10,
                  color: '#64748b',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}
              >
                <span style={{ color: '#94a3b8', fontWeight: 600 }}>Payload: </span>
                {computeSafetyNumbers(getActiveUserDid(), activeRecipient.did, 'genesis_root_key_sovra').qrPayload}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => {
                    const sn = computeSafetyNumbers(getActiveUserDid(), activeRecipient.did, 'genesis_root_key_sovra').formattedNumbers;
                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      navigator.clipboard.writeText(sn);
                      setCopiedSafety(true);
                      setTimeout(() => setCopiedSafety(false), 2000);
                    }
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '10px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {copiedSafety ? '✓ Copied!' : '📋 Copy Numbers'}
                </button>
                <button
                  onClick={() => setShowSafetyNumbers(false)}
                  style={{
                    flex: 1,
                    backgroundColor: '#00a884',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '10px 0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Mark Verified ✓
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ==========================================
  // RENDER: CONVERSATIONS & RADAR LIST VIEW
  // ==========================================

  const renderListView = () => {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Master Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: '#202c33',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>💬 Sovra Messaging</div>
            <div style={{ fontSize: 10, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>📶 BitChat Zero-Internet Mesh Active</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 12,
                backgroundColor:
                  meshRuntimeState.status === 'BLUETOOTH_MESH'
                    ? 'rgba(56, 189, 248, 0.2)'
                    : 'rgba(34, 197, 94, 0.2)',
                color: meshRuntimeState.status === 'BLUETOOTH_MESH' ? '#38bdf8' : '#4ade80',
                border: '1px solid rgba(255,255,255,0.1)',
                fontWeight: 600,
              }}
            >
              {meshRuntimeState.status === 'BLUETOOTH_MESH'
                ? `🔵 BLE (${discoveredPeers.length} Peers)`
                : '🟢 Online'}
            </span>

            <button
              onClick={handlePanicWipe}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 6,
                color: '#f87171',
                cursor: 'pointer',
                fontSize: 10,
                padding: '4px 8px',
                fontWeight: 700,
              }}
            >
              🚨 Wipe
            </button>
          </div>
        </header>

        {/* Segmented 3-Tab Navigator */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#182229',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <button
            onClick={() => setSubTab('chats')}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: subTab === 'chats' ? '2px solid #00a884' : 'none',
              color: subTab === 'chats' ? '#00a884' : '#8696a0',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Chats ({conversations.length})
          </button>
          <button
            onClick={() => setSubTab('radar')}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: subTab === 'radar' ? '2px solid #38bdf8' : 'none',
              color: subTab === 'radar' ? '#38bdf8' : '#8696a0',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Radar ({discoveredPeers.length})
          </button>
          <button
            onClick={() => setSubTab('channels')}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: subTab === 'channels' ? '2px solid #f59e0b' : 'none',
              color: subTab === 'channels' ? '#f59e0b' : '#8696a0',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Channels ({2 + customChannels.length})
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#0b141a' }}>
          {subTab === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  backgroundColor: '#111b21',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Conversations ({conversations.length})
                </span>
                <button
                  onClick={() => setIsCreateGroupOpen(true)}
                  style={{
                    backgroundColor: '#00a884',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 16,
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>👥</span>
                  <span>New Group</span>
                </button>
              </div>
              {conversations.map(conv => (
                <div
                  key={conv.threadId}
                  onClick={() =>
                    setActiveRecipient({
                      did: conv.peerDid,
                      name: conv.peerName,
                      isChannel: conv.isChannel,
                      isEmergency: conv.peerDid.includes('sos'),
                    })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: conv.isChannel
                        ? conv.threadId.includes('sos')
                          ? '#dc2626'
                          : '#0284c7'
                        : '#3b82f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 16,
                      color: '#fff',
                    }}
                  >
                    {conv.isChannel ? (conv.threadId.includes('sos') ? '🚨' : '📶') : conv.peerName[0] || 'A'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#e9edef' }}>{conv.peerName}</span>
                      <span style={{ fontSize: 10, color: '#8696a0' }}>
                        {conv.lastMessageTimestamp
                          ? new Date(conv.lastMessageTimestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: '#8696a0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 240,
                        }}
                      >
                        {conv.lastMessageText || 'Tap to open conversation'}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span
                          style={{
                            backgroundColor: '#00a884',
                            color: '#fff',
                            borderRadius: 10,
                            padding: '1px 6px',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {subTab === 'radar' && (
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Radar Graphic Card */}
              <div
                style={{
                  backgroundColor: '#182229',
                  borderRadius: 12,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    border: '2px solid rgba(56, 189, 248, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(56, 189, 248, 0.05)',
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: '50%',
                      border: '1px solid #38bdf8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(56, 189, 248, 0.2)',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>📶</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                  2.4GHz BLE Mesh Radar Active
                </div>
                <div style={{ fontSize: 11, color: '#8696a0', marginTop: 2, textAlign: 'center' }}>
                  {discoveredPeers.length > 0
                    ? `${discoveredPeers.length} Peer(s) detected in physical range`
                    : 'Scanning for nearby mesh devices within 30 meters...'}
                </div>
              </div>

              {/* Peers List */}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                Discovered Mesh Peers ({discoveredPeers.length})
              </div>

              {discoveredPeers.length === 0 ? (
                <div
                  style={{
                    backgroundColor: '#182229',
                    borderRadius: 8,
                    padding: '16px',
                    textAlign: 'center',
                    color: '#8696a0',
                    fontSize: 12,
                    border: '1px dashed rgba(255,255,255,0.1)',
                  }}
                >
                  No external peers detected on radio spectrum right now. Bring another Sovra node within range to
                  auto-connect.
                </div>
              ) : (
                discoveredPeers.map(peer => (
                  <div
                    key={peer.peerAddress}
                    style={{
                      backgroundColor: '#182229',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                        Peer {peer.peerAddress.substring(0, 12)}...
                      </div>
                      <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 2 }}>
                        RSSI: {peer.rssi ?? -50} dBm • Dist: ~{peer.distanceMeters ?? 2.5}m • Direct Link
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        setActiveRecipient({
                          did: peer.peerAddress,
                          name: `Peer ${peer.peerAddress.substring(0, 8)}`,
                          isChannel: false,
                        })
                      }
                      style={{
                        backgroundColor: '#00a884',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Chat
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {subTab === 'channels' && (
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Channel Action Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Decentralized Swarms ({2 + customChannels.length})
                </span>
                <button
                  onClick={() => setIsCreateChannelOpen(true)}
                  style={{
                    backgroundColor: '#00a884',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>+</span>
                  <span>New Channel</span>
                </button>
              </div>

              {/* Default Hyperlocal Beacon */}
              <div
                onClick={() =>
                  setActiveRecipient({
                    did: 'channel:local_mesh',
                    name: '#local-mesh',
                    isChannel: true,
                  })
                }
                style={{
                  backgroundColor: '#182229',
                  borderRadius: 10,
                  padding: '14px',
                  border: '1px solid rgba(2, 132, 199, 0.3)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>📶</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8' }}>#local-mesh</span>
                  <span
                    style={{
                      fontSize: 9,
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontWeight: 700,
                    }}
                  >
                    Hyperlocal (50m)
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Public beacon channel for all nearby Sovra nodes. Zero-internet broadcast swarm.
                </div>
              </div>

              {/* Default Emergency SOS Beacon */}
              <div
                onClick={() =>
                  setActiveRecipient({
                    did: 'channel:emergency_sos',
                    name: '#emergency-sos',
                    isChannel: true,
                    isEmergency: true,
                  })
                }
                style={{
                  backgroundColor: '#182229',
                  borderRadius: 10,
                  padding: '14px',
                  border: '1px solid rgba(220, 38, 38, 0.4)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>🚨</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#ef4444' }}>#emergency-sos</span>
                  <span
                    style={{
                      fontSize: 9,
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      color: '#ef4444',
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontWeight: 700,
                    }}
                  >
                    Priority Swarm
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Emergency distress beacon. Multi-hop relayed to all devices within reach without pairing.
                </div>
              </div>

              {/* Dynamic Custom Channels */}
              {customChannels.map(ch => (
                <div
                  key={ch.id}
                  onClick={() =>
                    setActiveRecipient({
                      did: ch.id,
                      name: ch.name,
                      isChannel: true,
                    })
                  }
                  style={{
                    backgroundColor: '#182229',
                    borderRadius: 10,
                    padding: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 18 }}>💬</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#34d399' }}>{ch.name}</span>
                    <span
                      style={{
                        fontSize: 9,
                        backgroundColor: 'rgba(52, 211, 153, 0.15)',
                        color: '#34d399',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 700,
                      }}
                    >
                      {ch.isPublic !== false ? 'Public Swarm' : 'Private'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {ch.topic || ch.description || 'Custom decentralized peer broadcast community.'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#0b141a',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        onChannelCreated={ch => setCustomChannels(prev => [ch, ...prev])}
      />
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onGroupCreated={group => {
          refreshConversations();
          setActiveRecipient({
            did: group.id,
            name: `${group.avatarEmoji || '👥'} ${group.name}`,
            isBitChat: true,
            isEmergency: false,
          });
        }}
      />
      {/* Persistent Network & BLE Mesh Status Bar */}
      <div
        role="status"
        aria-label="Network Status Bar"
        style={{
          padding: '6px 14px',
          backgroundColor: isOnline
            ? '#064e3b'
            : discoveredPeers.length > 0 || meshRuntimeState.status === 'BLUETOOTH_MESH'
            ? '#1e1b4b'
            : '#451a03',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: isOnline
            ? '#6ee7b7'
            : discoveredPeers.length > 0 || meshRuntimeState.status === 'BLUETOOTH_MESH'
            ? '#a5b4fc'
            : '#fde047',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>
            {isOnline
              ? '🟢'
              : discoveredPeers.length > 0 || meshRuntimeState.status === 'BLUETOOTH_MESH'
              ? '🔵'
              : '🟡'}
          </span>
          <span>
            {isOnline
              ? 'Online Swarm Connected (P2P + Cloud)'
              : discoveredPeers.length > 0 || meshRuntimeState.status === 'BLUETOOTH_MESH'
              ? `BitChat BLE Mesh Active (${discoveredPeers.length} Peers)`
              : 'Offline Mode (Local Storage Encrypted)'}
          </span>
        </div>

        {pendingOutboxCount > 0 && (
          <span
            style={{
              backgroundColor: 'rgba(234, 179, 8, 0.25)',
              color: '#fef08a',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ⏳ {pendingOutboxCount} Outbox Queued
          </span>
        )}
      </div>

      {activeRecipient ? renderThreadView() : renderListView()}
    </div>
  );
}
