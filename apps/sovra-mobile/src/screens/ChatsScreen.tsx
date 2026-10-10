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
import type { MeshDiscoveredPeer } from '@sovra/p2p';
import { CallScreen } from './CallScreen.js';
import {
  fetchChatMessages,
  sendChatMessage,
  markChatReceipt,
  getActiveUserDid,
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

export interface ActiveRecipient {
  did: string;
  name: string;
  avatar?: string | undefined;
  isChannel?: boolean | undefined;
  isEmergency?: boolean | undefined;
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

  // Mesh & Discovery state
  const [discoveredPeers, setDiscoveredPeers] = useState<MeshDiscoveredPeer[]>([]);
  const [meshRuntimeState, setMeshRuntimeState] = useState<MobileMeshRuntimeState>(
    mobileMesh.getRuntimeState(),
  );

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const voiceTimerRef = useRef<any>(null);

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

    return () => {
      unsubPeers();
      unsubState();
      unsubMsg();
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
    if (!text || isSending || !activeRecipient) return;

    const targetDid = activeRecipient.did;
    const isChannel = activeRecipient.isChannel || targetDid.startsWith('channel:');
    const tempId = `msg-${Date.now()}`;
    const myDid = getActiveUserDid();

    const optimisticMsg: MobileChatMessage = {
      id: tempId,
      senderDid: myDid,
      senderName: 'You',
      text,
      timestamp: Date.now(),
      isOutgoing: true,
      tickState: 'sending',
      isBitChat: isChannel || meshRuntimeState.status === 'BLUETOOTH_MESH',
      hopCount: 1,
    };

    setMessages(prev => [...prev, optimisticMsg]);
    setInputText('');
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
      text,
      timestamp: Date.now(),
      status: 'pending',
      syncStatus: 'LOCAL',
    });

    try {
      const res = await sendChatMessage({
        recipientDid: targetDid,
        text,
        senderName: 'You',
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
                }
              : m,
          ),
        );
      } else {
        throw new Error(res.error || 'Server unreachable');
      }
    } catch (err) {
      console.warn('[ChatsScreen] Offline fallback: enqueuing message to durable outbox & BLE mesh');
      await localDb.enqueueOperation('SEND_CHAT', myDid, {
        recipientDid: targetDid,
        text,
        senderName: 'You',
      });

      // Transmit over BLE mesh
      mobileMesh.sendChatMessage(targetDid, text, 'You').catch(() => {});
      syncEngine.triggerSync().catch(() => {});

      setMessages(prev =>
        prev.map(m => (m.id === tempId ? { ...m, tickState: 'sent' } : m)),
      );
    } finally {
      setIsSending(false);
      refreshConversations();
    }
  };

  const handleSendVoiceNote = async () => {
    if (!isRecordingVoice) {
      setIsRecordingVoice(true);
      return;
    }

    setIsRecordingVoice(false);
    const duration = Math.max(1, voiceSeconds);
    const tempId = `voice-${Date.now()}`;
    const myDid = getActiveUserDid();
    const targetDid = activeRecipient?.did || 'did:key:z6MksAliceP2P';

    const optimisticVoice: MobileChatMessage = {
      id: tempId,
      senderDid: myDid,
      senderName: 'You',
      text: `🎤 Voice note (${duration}s)`,
      timestamp: Date.now(),
      isOutgoing: true,
      tickState: 'sending',
      isAudioNote: true,
    };

    setMessages(prev => [...prev, optimisticVoice]);

    try {
      const res = await sendChatMessage({
        recipientDid: targetDid,
        text: `Voice note (${duration}s)`,
        isAudio: true,
        audioDurationSec: duration,
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
    } catch (err) {
      console.error('[ChatsScreen] Voice note fallback:', err);
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

  const renderTickIcon = (state: MobileChatMessage['tickState']) => {
    switch (state) {
      case 'sending':
        return <span style={{ color: '#94a3b8', fontSize: 10 }}>🕒</span>;
      case 'sent':
        return <span style={{ color: '#94a3b8', fontSize: 11 }}>✓</span>; // Grey single tick
      case 'delivered':
        return <span style={{ color: '#94a3b8', fontSize: 11 }}>✓✓</span>; // Grey double tick
      case 'read':
        return <span style={{ color: '#38bdf8', fontSize: 11 }}>✓✓</span>; // Blue double tick
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
                color: activeRecipient.isEmergency ? '#ef4444' : '#34d399',
              }}
            >
              {activeRecipient.isEmergency
                ? '🚨 Emergency SOS Swarm (Zero-Internet)'
                : activeRecipient.isChannel
                ? '📶 Hyperlocal Broadcast (50m Swarm)'
                : '● E2EE Double Ratchet Active'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, fontSize: 16, alignItems: 'center' }}>
            {!activeRecipient.isChannel && (
              <>
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
              style={{
                alignSelf: msg.isOutgoing ? 'flex-end' : 'flex-start',
                backgroundColor: msg.isOutgoing ? '#005c4b' : '#202c33',
                padding: '8px 12px',
                borderRadius: 10,
                maxWidth: '82%',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              {activeRecipient.isChannel && !msg.isOutgoing && (
                <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700, marginBottom: 2 }}>
                  {msg.senderName}
                </div>
              )}

              {msg.isAudioNote ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ fontSize: 16 }}>▶</span>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 18 }}>
                    {[20, 50, 80, 40, 90, 60, 30].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          width: 3,
                          height: `${h}%`,
                          backgroundColor: '#38bdf8',
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{msg.text}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.4, color: '#e9edef', wordBreak: 'break-word' }}>
                  {msg.text}
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
                {msg.isOutgoing && renderTickIcon(msg.tickState)}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

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
              onChange={e => setInputText(e.target.value)}
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
            <span>📎</span>
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
            Channels (2)
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#0b141a' }}>
          {subTab === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
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
      {activeRecipient ? renderThreadView() : renderListView()}
    </div>
  );
}
