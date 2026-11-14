/**
 * @file apps/sovra-mobile/src/navigation/BottomTabNavigator.tsx
 * 5-Tab Mobile Navigation Controller for Sovra with Truthful Offline Mesh HUD.
 */

import React, { useState, useEffect } from 'react';
import { FeedScreen } from '../screens/FeedScreen.js';
import { ReelsScreen } from '../screens/ReelsScreen.js';
import { WatchScreen } from '../screens/WatchScreen.js';
import { ChatsScreen } from '../screens/ChatsScreen.js';
import { ProfileScreen } from '../screens/profile/ProfileScreen.js';
import { CreatorStudioScreen } from '../screens/studio/CreatorStudioScreen.js';
import { WalletHubScreen } from '../screens/wallet/WalletHubScreen.js';
import { SecuritySettingsScreen } from '../screens/settings/SecuritySettingsScreen.js';
import { SendTokenModal, ReceiveTokenModal } from '../screens/MeScreen.js';
import { BackupSeedModal } from '../components/BackupSeedModal.js';
import { ImportSeedModal } from '../components/ImportSeedModal.js';
import { DepositModal } from '../components/DepositModal.js';
import type { UserAccountProfile } from '@sovra/identity';
import { CallScreen } from '../screens/CallScreen.js';
import { MeshDiagnosticsScreen } from '../screens/MeshDiagnosticsScreen.js';
import {
  fetchMeshStatus,
  updateMeshControls,
  type MobileMeshStatus,
  fetchIncomingCall,
  declineCall,
  endCall,
  type MobileIncomingCall,
  fetchUserProfile,
  fetchFeedPosts,
  fetchBookmarkedPosts,
  fetchFollowStats,
  fetchWalletAssets,
  type WalletAssetItem,
} from '../services/api.js';

export type TabKey = 'feed' | 'reels' | 'watch' | 'chats' | 'me';

export interface TabItem {
  key: TabKey;
  label: string;
  icon: string;
}

export const TABS: readonly TabItem[] = [
  { key: 'feed', label: 'Feed', icon: '📷' },
  { key: 'reels', label: 'Reels', icon: '🎬' },
  { key: 'watch', label: 'Watch', icon: '📺' },
  { key: 'chats', label: 'Chats', icon: '💬' },
  { key: 'me', label: 'Me', icon: '👤' },
];

export function triggerHapticFeedback(pattern: number[] = [50, 30, 50]): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

export function BottomTabNavigator(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('feed');
  const [meshStatus, setMeshStatus] = useState<MobileMeshStatus | null>(null);
  const [showMeshDrawer, setShowMeshDrawer] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [incomingCall, setIncomingCall] = useState<MobileIncomingCall | null>(null);
  const [activeCallSession, setActiveCallSession] = useState<{
    callId: string;
    peerName: string;
    peerDid: string;
    mediaType: 'audio' | 'video';
  } | null>(null);

  // PWA Install prompt state
  const [installPromptEvent, setInstallPromptEvent] = useState<any | null>(null);
  const [isInstallDismissed, setIsInstallDismissed] = useState(false);

  // Decoupled 4-Tier Surface Navigation State
  const [activeSubModal, setActiveSubModal] = useState<'none' | 'wallet' | 'studio' | 'settings'>('none');
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Authoritative Shared User & Profile State
  const [profile, setProfile] = useState<UserAccountProfile>({
    did: 'did:key:z6MksAliceP2PGenesisAddress',
    handle: '@alice',
    displayName: 'Alice Sovereign',
    deviceId: 'dev_mobile_01',
    devicePublicKeyHex: '',
    credentialId: 'cred_titan_bio_01',
    createdAt: Math.floor(Date.now() / 1000),
    isLocked: false,
  });
  const [followStats, setFollowStats] = useState({
    followersCount: 142,
    followingCount: 38,
    friendsCount: 24,
    postsCount: 0,
  });
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [savedPosts, setSavedPosts] = useState<any[]>([]);
  const [walletBalance, setWalletBalance] = useState('150.00');
  const [walletAssets, setWalletAssets] = useState<WalletAssetItem[]>([
    {
      id: 'sov-native',
      type: 'NATIVE',
      name: 'Sovereign Token',
      symbol: 'SOV',
      decimals: 6,
      balance: '150.00',
      displayBalance: '150.00 SOV',
      sovValue: '150.00',
      icon: '⚡',
    },
    {
      id: 'cw20-alice',
      type: 'CW20',
      name: 'Alice Creator Token',
      symbol: 'ALICE',
      decimals: 6,
      balance: '2500.00',
      displayBalance: '2,500 ALICE',
      sovValue: '25.00',
      icon: '🎨',
    },
  ]);

  // Load Authoritative Profile, Posts & Wallet Data from SQLite / Node Engine
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const [profRes, feedRes, bookmarkedRes, statsRes, assetsRes] = await Promise.allSettled([
          fetchUserProfile(),
          fetchFeedPosts(),
          fetchBookmarkedPosts(),
          fetchFollowStats(),
          fetchWalletAssets(),
        ]);
        if (!mounted) return;
        if (profRes.status === 'fulfilled' && profRes.value) {
          const sp = profRes.value;
          setProfile(prev => ({
            ...prev,
            did: sp.did || prev.did,
            handle: sp.handle || prev.handle,
            displayName: sp.displayName || sp.name || prev.displayName,
          }));
          if (sp.balanceSov !== undefined) {
            setWalletBalance(Number(sp.balanceSov).toFixed(2));
          }
        }
        if (feedRes.status === 'fulfilled' && Array.isArray(feedRes.value)) {
          setUserPosts(feedRes.value);
          setFollowStats(prev => ({ ...prev, postsCount: feedRes.value.length }));
        }
        if (bookmarkedRes.status === 'fulfilled' && Array.isArray(bookmarkedRes.value)) {
          setSavedPosts(bookmarkedRes.value);
        }
        if (statsRes.status === 'fulfilled' && statsRes.value) {
          setFollowStats(prev => ({
            ...prev,
            followersCount: statsRes.value.followersCount ?? prev.followersCount,
            followingCount: statsRes.value.followingCount ?? prev.followingCount,
          }));
        }
        if (assetsRes.status === 'fulfilled' && assetsRes.value?.assets) {
          setWalletAssets(assetsRes.value.assets);
          if (assetsRes.value.totalValuationSov) {
            setWalletBalance(Number(assetsRes.value.totalValuationSov).toFixed(2));
          }
        }
      } catch (err) {
        console.warn('[BottomTabNavigator] Load profile data warning:', err);
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      }
    };
  }, []);

  const handleInstallApp = async () => {
    if (installPromptEvent) {
      triggerHapticFeedback([100]);
      installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        setInstallPromptEvent(null);
      }
    }
  };

  // Background incoming call polling - maintains active listening even when screen is locked
  useEffect(() => {
    let mounted = true;
    let wakeLockSentinel: any = null;

    const checkIncoming = async () => {
      if (activeCallSession) return;
      try {
        const inc = await fetchIncomingCall();
        if (!mounted) return;
        if (inc) {
          setIncomingCall(prev => {
            if (prev?.callId === inc.callId) return prev;
            // Native Android Heads-Up / Full-Screen Intent Bridge
            if (typeof (window as any).SovraCallNative?.showIncomingCallNotification === 'function') {
              (window as any).SovraCallNative.showIncomingCallNotification(
                inc.callId,
                inc.callerName || 'Peer',
                inc.callType || 'audio',
              );
            }
            // Screen Wake Lock & Vibration
            try {
              if (navigator.wakeLock?.request) {
                navigator.wakeLock.request('screen').then(w => { wakeLockSentinel = w; }).catch(() => {});
              }
              if (navigator.vibrate) {
                navigator.vibrate([500, 300, 500, 300, 500, 300, 500, 300]);
              }
            } catch (_) {}
            return inc;
          });
        } else {
          setIncomingCall(prev => {
            if (prev) {
              if (typeof (window as any).SovraCallNative?.cancelIncomingCallNotification === 'function') {
                (window as any).SovraCallNative.cancelIncomingCallNotification(prev.callId);
              }
              if (navigator.vibrate) navigator.vibrate(0);
              if (wakeLockSentinel) {
                wakeLockSentinel.release().catch(() => {});
                wakeLockSentinel = null;
              }
            }
            return null;
          });
        }
      } catch (_) {}
    };

    checkIncoming();
    const interval = setInterval(checkIncoming, 2500);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (wakeLockSentinel) wakeLockSentinel.release().catch(() => {});
      if (navigator.vibrate) navigator.vibrate(0);
    };
  }, [activeCallSession]);

  // Global hooks for native Android PendingIntent and Service Worker auto-answer & decline
  useEffect(() => {
    const handleAutoAnswer = (targetCallId?: string) => {
      setIncomingCall(current => {
        const call = current || (targetCallId ? {
          callId: targetCallId,
          callerName: 'Peer',
          callerDid: 'did:key:z6MksPeer',
          callerHandle: '@peer',
          callerAvatar: '📞',
          callerAvatarBg: '#10b981',
          callType: 'audio' as const,
          createdAt: Date.now(),
        } : null);

        if (call) {
          if (typeof (window as any).SovraCallNative?.cancelIncomingCallNotification === 'function') {
            (window as any).SovraCallNative.cancelIncomingCallNotification(call.callId);
          }
          if (navigator.vibrate) navigator.vibrate(0);
          setActiveCallSession({
            callId: call.callId,
            peerName: call.callerName || 'Peer',
            peerDid: call.callerDid || 'did:key:z6MksPeer',
            mediaType: call.callType || 'audio',
          });
        }
        return null;
      });
    };

    const handleDecline = () => {
      setIncomingCall(current => {
        if (current) {
          declineCall(current.callId).catch(() => {});
          if (typeof (window as any).SovraCallNative?.cancelIncomingCallNotification === 'function') {
            (window as any).SovraCallNative.cancelIncomingCallNotification(current.callId);
          }
          if (navigator.vibrate) navigator.vibrate(0);
        }
        return null;
      });
    };

    (window as any).autoAnswerIncomingCallById = handleAutoAnswer;
    (window as any).declineIncomingCall = handleDecline;

    // Check query params for autoAnswerCall from Service Worker / Intent
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      const autoAnswerId = urlParams.get('autoAnswerCall');
      if (autoAnswerId) {
        handleAutoAnswer(autoAnswerId);
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SOVRA_AUTO_ANSWER_CALL' && event.data.callId) {
        handleAutoAnswer(event.data.callId);
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
      delete (window as any).autoAnswerIncomingCallById;
      delete (window as any).declineIncomingCall;
    };
  }, []);

  const handleAcceptIncomingCall = () => {
    if (!incomingCall) return;
    if (typeof (window as any).SovraCallNative?.cancelIncomingCallNotification === 'function') {
      (window as any).SovraCallNative.cancelIncomingCallNotification(incomingCall.callId);
    }
    if (navigator.vibrate) navigator.vibrate(0);
    setActiveCallSession({
      callId: incomingCall.callId,
      peerName: incomingCall.callerName || 'Peer',
      peerDid: incomingCall.callerDid || 'did:key:z6MksPeer',
      mediaType: incomingCall.callType || 'audio',
    });
    setIncomingCall(null);
  };

  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    declineCall(incomingCall.callId).catch(() => {});
    if (typeof (window as any).SovraCallNative?.cancelIncomingCallNotification === 'function') {
      (window as any).SovraCallNative.cancelIncomingCallNotification(incomingCall.callId);
    }
    if (navigator.vibrate) navigator.vibrate(0);
    setIncomingCall(null);
  };


  useEffect(() => {
    let mounted = true;
    const pollStatus = async () => {
      try {
        const s = await fetchMeshStatus();
        if (mounted) setMeshStatus(s);
      } catch {}
    };

    pollStatus();
    const timer = setInterval(pollStatus, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleToggleBle = async () => {
    if (!meshStatus) return;
    const nextVal = !meshStatus.controls.bluetoothMeshEnabled;
    const res = await updateMeshControls({ bluetoothMeshEnabled: nextVal });
    if (res.ok) {
      setMeshStatus(prev =>
        prev
          ? {
              ...prev,
              status: (res.status as any) || (nextVal ? 'NO_PEERS' : 'OFFLINE'),
              controls: { ...prev.controls, bluetoothMeshEnabled: nextVal },
            }
          : null,
      );
    }
  };

  const handleToggleRelay = async () => {
    if (!meshStatus) return;
    const nextVal = !meshStatus.controls.relayParticipationEnabled;
    await updateMeshControls({ relayParticipationEnabled: nextVal });
    setMeshStatus(prev =>
      prev
        ? {
            ...prev,
            controls: { ...prev.controls, relayParticipationEnabled: nextVal },
          }
        : null,
    );
  };

  const handleCycleBatteryProfile = async () => {
    if (!meshStatus) return;
    const current = meshStatus.controls.batteryProfile;
    const next =
      current === 'BALANCED'
        ? 'PERFORMANCE'
        : current === 'PERFORMANCE'
        ? 'POWERSAVER'
        : 'BALANCED';
    await updateMeshControls({ batteryProfile: next });
    setMeshStatus(prev =>
      prev
        ? {
            ...prev,
            controls: { ...prev.controls, batteryProfile: next },
          }
        : null,
    );
  };

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'feed':
        return <FeedScreen />;
      case 'reels':
        return <ReelsScreen />;
      case 'watch':
        return <WatchScreen />;
      case 'chats':
        return <ChatsScreen />;
      case 'me': {
        if (activeSubModal !== 'none') {
          return (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                animation: 'slideUpModal 0.26s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* iOS Sheet Drag Handle Indicator */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  paddingTop: 8,
                  paddingBottom: 4,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  triggerHapticFeedback([10]);
                  setActiveSubModal('none');
                }}
                title="Dismiss"
              >
                <div
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: 'rgba(255, 255, 255, 0.25)',
                  }}
                />
              </div>

              {activeSubModal === 'wallet' && (
                <WalletHubScreen
                  balance={walletBalance}
                  fiatValuation={(Number(walletBalance) * 3).toFixed(2)}
                  assets={walletAssets}
                  onOpenSend={() => setShowSendModal(true)}
                  onOpenReceive={() => setShowReceiveModal(true)}
                  onOpenDeposit={() => setShowDepositModal(true)}
                  onOpenStaking={() => triggerHapticFeedback([40, 20])}
                  onOpenBackupSeed={() => setShowBackupModal(true)}
                  onBack={() => setActiveSubModal('none')}
                />
              )}
              {activeSubModal === 'studio' && (
                <CreatorStudioScreen
                  balanceSov={walletBalance}
                  handle={profile.handle || '@sovereign'}
                  onOpenWithdraw={() => triggerHapticFeedback([40, 20])}
                  onOpenWallet={() => setActiveSubModal('wallet')}
                  onBack={() => setActiveSubModal('none')}
                />
              )}
              {activeSubModal === 'settings' && (
                <SecuritySettingsScreen
                  handle={profile.handle || '@sovereign'}
                  profile={profile}
                  onOpenBackupSeed={() => setShowBackupModal(true)}
                  onOpenImportSeed={() => setShowImportModal(true)}
                  onLogout={() => {
                    triggerHapticFeedback([50, 50]);
                    setActiveSubModal('none');
                  }}
                  onBack={() => setActiveSubModal('none')}
                />
              )}
            </div>
          );
        }
        return (
          <ProfileScreen
            profile={profile}
            stats={followStats}
            posts={userPosts}
            bookmarkedPosts={savedPosts}
            balanceSov={walletBalance}
            onOpenSettings={() => setActiveSubModal('settings')}
            onOpenStudio={() => setActiveSubModal('studio')}
            onOpenWallet={() => setActiveSubModal('wallet')}
            onShareProfile={() => {
              triggerHapticFeedback([20]);
              if (typeof navigator !== 'undefined' && (navigator as any).share) {
                (navigator as any).share({
                  title: `${profile.displayName || 'Sovereign Peer'} on SOVRA`,
                  text: `Connect with ${profile.handle || '@sovereign'} on the SOVRA P2P Mesh Network`,
                  url: `https://sovra.network/?peer=${profile.did}`,
                }).catch(() => {});
              } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(`https://sovra.network/?peer=${profile.did}`);
                alert('Profile link copied to clipboard!');
              }
            }}
          />
        );
      }
    }
  };

  const getStatusBadge = () => {
    if (!meshStatus) return { text: 'P2P MESH', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
    switch (meshStatus.status) {
      case 'ONLINE_IP_MESH':
      case 'ONLINE':
        return { text: '🟢 ONLINE (IP MESH)', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)' };
      case 'ONLINE_IP':
        return { text: '🟢 ONLINE (IP)', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)' };
      case 'BLUETOOTH_MESH':
        return {
          text: `🔵 BLE MESH (${meshStatus.diagnostics.authenticatedPeersCount} PEERS)`,
          color: '#38bdf8',
          bg: 'rgba(56, 189, 248, 0.15)',
        };
      case 'CONNECTING':
        return { text: '🟣 CONNECTING...', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)' };
      case 'NO_PEERS':
        return { text: '🟡 OFFLINE MESH (SCANNING)', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)' };
      case 'OFFLINE':
      default:
        if (meshStatus.controls?.bluetoothMeshEnabled !== false) {
          return {
            text: '🟣 OFFLINE MESH (BLE GATT & DTN READY)',
            color: '#c084fc',
            bg: 'rgba(192, 132, 252, 0.2)',
          };
        }
        return { text: '🔴 MESH RADIO DISABLED', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        backgroundColor: '#090d16',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes slideUpModal {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes radarPulse {
          0% { transform: scale(0.92); opacity: 0.8; }
          50% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(0.92); opacity: 0.8; }
        }
        @keyframes heartBurst {
          0% { transform: scale(1); }
          35% { transform: scale(1.35); }
          65% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        @keyframes spinVinyl {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Offline Mesh Top Status HUD Pill */}
      <div
        style={{
          height: 'calc(34px + env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          backgroundColor: 'rgba(3, 7, 18, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12,
          paddingRight: 12,
          zIndex: 40,
        }}
      >
        <div
          onClick={() => setShowMeshDrawer(prev => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            padding: '2px 8px',
            borderRadius: 12,
            backgroundColor: badge.bg,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: badge.color, letterSpacing: '0.5px' }}>
            {badge.text}
          </span>
          <span style={{ fontSize: 9, color: '#94a3b8' }}>⚙️</span>
        </div>

        <div style={{ fontSize: 10, color: '#64748b', display: 'flex', gap: 10 }}>
          <span>Relay: {meshStatus?.controls.relayParticipationEnabled ? 'ON' : 'OFF'}</span>
          <span>Battery: {meshStatus?.controls.batteryProfile || 'BALANCED'}</span>
        </div>
      </div>

      {/* Screen Viewport */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderActiveScreen()}
      </div>

      {/* Mesh Diagnostics & Controls Drawer */}
      {showMeshDrawer && (
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 0,
            right: 0,
            backgroundColor: '#0f172a',
            borderBottom: '1px solid #1e293b',
            padding: 16,
            zIndex: 60,
            boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              📡 Bluetooth Offline Mesh Diagnostics
            </span>
            <button
              onClick={() => setShowMeshDrawer(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{ backgroundColor: '#1e293b', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Nearby BLE Peers</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>
                {meshStatus?.diagnostics.nearbyPeersCount ?? 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#1e293b', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Packets Relayed</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80' }}>
                {meshStatus?.diagnostics.packetsRouted ?? 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#1e293b', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Relay Queue</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>
                {meshStatus?.diagnostics.relayQueueCount ?? 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#1e293b', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Bytes Sent / Recv</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>
                {((meshStatus?.diagnostics.totalBytesSent ?? 0) / 1024).toFixed(1)}k /{' '}
                {((meshStatus?.diagnostics.totalBytesReceived ?? 0) / 1024).toFixed(1)}k
              </div>
            </div>
          </div>

          {/* User Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#cbd5e1' }}>BLE Mesh Radio</span>
              <button
                onClick={handleToggleBle}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: meshStatus?.controls.bluetoothMeshEnabled ? '#0284c7' : '#334155',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {meshStatus?.controls.bluetoothMeshEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#cbd5e1' }}>Store-and-Forward Relay</span>
              <button
                onClick={handleToggleRelay}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: meshStatus?.controls.relayParticipationEnabled ? '#16a34a' : '#334155',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {meshStatus?.controls.relayParticipationEnabled ? 'Relaying' : 'Opted Out'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#cbd5e1' }}>Battery Duty Profile</span>
              <button
                onClick={handleCycleBatteryProfile}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#475569',
                  color: '#f8fafc',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {meshStatus?.controls.batteryProfile ?? 'BALANCED'} ↻
              </button>
            </div>
          </div>
            <button
              id="btnOpenMeshDiagnosticsModal"
              onClick={() => {
                setShowMeshDrawer(false);
                setShowDiagnosticsModal(true);
              }}
              style={{
                marginTop: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(56, 189, 248, 0.4)',
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>📡 Open Full RF Simulator & Diagnostics HUD</span>
            </button>
        </div>
      )}

      {/* PWA Install Banner */}
      {installPromptEvent && !isInstallDismissed && (
        <div
          role="region"
          aria-label="PWA Install Banner"
          style={{
            position: 'absolute',
            bottom: 60,
            left: 0,
            right: 0,
            backgroundColor: '#1e293b',
            borderTop: '1px solid rgba(56, 189, 248, 0.3)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            zIndex: 45,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📲</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Install Sovra App</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Fast, offline mesh and zero-server calling</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleInstallApp}
              style={{
                backgroundColor: '#00a884',
                color: '#fff',
                border: 'none',
                borderRadius: 16,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Install
            </button>
            <button
              onClick={() => setIsInstallDismissed(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 14,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Bottom 5-Tab Bar (iOS Safe Area & Glowing Active Indicator) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 'calc(62px + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          backgroundColor: 'rgba(3, 7, 18, 0.92)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          zIndex: 50,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <div
              key={tab.key}
              onClick={() => {
                triggerHapticFeedback([12]);
                setActiveTab(tab.key);
                if (tab.key === 'me' && activeSubModal !== 'none') {
                  setActiveSubModal('none');
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                cursor: 'pointer',
                padding: '6px 14px',
                position: 'relative',
                transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
                transform: isActive ? 'scale(1.06)' : 'scale(1)',
                opacity: isActive ? 1 : 0.45,
                userSelect: 'none',
              }}
            >
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    width: 22,
                    height: 3,
                    borderRadius: 2,
                    background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
                    boxShadow: '0 0 10px rgba(56, 189, 248, 0.8)',
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 20,
                  filter: isActive ? 'drop-shadow(0 2px 6px rgba(56, 189, 248, 0.45))' : 'none',
                }}
              >
                {tab.icon}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#38bdf8' : '#94a3b8',
                  letterSpacing: '0.2px',
                }}
              >
                {tab.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* WhatsApp-Style High-Priority Incoming Call Heads-Up Overlay */}
      {incomingCall && !activeCallSession && (
        <div
          id="mobileIncomingCallOverlay"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(11, 20, 26, 0.96)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderBottom: '2px solid rgba(34, 197, 94, 0.4)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.85)',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {/* E2EE Security Badge */}
          <div style={{ fontSize: 11, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🔒</span>
            <span>End-to-End Encrypted (Noise_XX / DTLS)</span>
          </div>

          {/* Caller Avatar & Name */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                backgroundColor: incomingCall.callerAvatarBg || '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                boxShadow: '0 0 24px rgba(34, 197, 94, 0.5)',
                border: '3px solid #22c55e',
              }}
            >
              {incomingCall.callerAvatar || '📞'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>
              {incomingCall.callerName}
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>
              Incoming {incomingCall.callType === 'video' ? 'Video' : 'Voice'} Call...
            </div>
          </div>

          {/* Accept / Decline Action Buttons */}
          <div style={{ display: 'flex', gap: 40, alignItems: 'center', marginTop: 8 }}>
            {/* Decline */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <button
                id="btnDeclineIncomingCall"
                onClick={handleDeclineIncomingCall}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  border: 'none',
                  fontSize: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(239, 68, 68, 0.6)',
                }}
                title="Decline Call"
              >
                🔴
              </button>
              <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>Decline</span>
            </div>

            {/* Accept */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <button
                id="btnAcceptIncomingCall"
                onClick={handleAcceptIncomingCall}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  border: 'none',
                  fontSize: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(34, 197, 94, 0.6)',
                }}
                title="Accept Call"
              >
                🟢
              </button>
              <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>Accept</span>
            </div>
          </div>
        </div>
      )}

      
      {/* Fullscreen Mesh Diagnostics & RF Simulator Modal */}
      {showDiagnosticsModal && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 90 }}>
          <MeshDiagnosticsScreen onClose={() => setShowDiagnosticsModal(false)} />
        </div>
      )}

      {/* Sub-Modal Dialogs for Wallet & Security Operations */}
      {showSendModal && (
        <SendTokenModal
          isOpen={showSendModal}
          onClose={() => setShowSendModal(false)}
          balance={walletBalance}
          onTransferComplete={() => setShowSendModal(false)}
        />
      )}
      {showReceiveModal && (
        <ReceiveTokenModal
          isOpen={showReceiveModal}
          onClose={() => setShowReceiveModal(false)}
          userDid={profile.did}
        />
      )}
      {showDepositModal && (
        <DepositModal
          isOpen={showDepositModal}
          onClose={() => setShowDepositModal(false)}
          userAddress={profile.did}
        />
      )}
      {showBackupModal && (
        <BackupSeedModal
          isOpen={showBackupModal}
          onClose={() => setShowBackupModal(false)}
          mnemonic={(typeof localStorage !== 'undefined' ? localStorage.getItem('sovra_active_mnemonic') : null) || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'}
        />
      )}
      {showImportModal && (
        <ImportSeedModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
        />
      )}
{/* Active Call Fullscreen View (Available anywhere across all tabs) */}
      {activeCallSession && (
        <CallScreen
          peerName={activeCallSession.peerName}
          peerDid={activeCallSession.peerDid}
          mediaType={activeCallSession.mediaType}
          onEndCall={() => {
            endCall(activeCallSession.callId, 'completed').catch(() => {});
            setActiveCallSession(null);
          }}
        />
      )}
    </div>
  );
}

