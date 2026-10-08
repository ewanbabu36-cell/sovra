/**
 * @file apps/sovra-mobile/src/navigation/BottomTabNavigator.tsx
 * 5-Tab Mobile Navigation Controller for Sovra with Truthful Offline Mesh HUD.
 */

import React, { useState, useEffect } from 'react';
import { FeedScreen } from '../screens/FeedScreen.js';
import { ReelsScreen } from '../screens/ReelsScreen.js';
import { WatchScreen } from '../screens/WatchScreen.js';
import { ChatsScreen } from '../screens/ChatsScreen.js';
import { MeScreen } from '../screens/MeScreen.js';
import {
  fetchMeshStatus,
  updateMeshControls,
  type MobileMeshStatus,
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

export function BottomTabNavigator(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('feed');
  const [meshStatus, setMeshStatus] = useState<MobileMeshStatus | null>(null);
  const [showMeshDrawer, setShowMeshDrawer] = useState(false);

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
      case 'me':
        return <MeScreen />;
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
        return { text: '🟡 OFFLINE (SCANNING)', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)' };
      case 'OFFLINE':
      default:
        return { text: '🔴 OFFLINE / DISCONNECTED', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' };
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
      {/* Offline Mesh Top Status HUD Pill */}
      <div
        style={{
          height: 32,
          backgroundColor: '#030712',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
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
        </div>
      )}

      {/* Bottom 5-Tab Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          backgroundColor: '#030712',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          zIndex: 50,
          backdropFilter: 'blur(12px)',
        }}
      >
        {TABS.map(tab => (
          <div
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              cursor: 'pointer',
              opacity: activeTab === tab.key ? 1 : 0.45,
              transition: 'all 0.2s ease',
              padding: '6px 12px',
            }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: activeTab === tab.key ? 700 : 500,
                color: activeTab === tab.key ? '#38bdf8' : '#94a3b8',
              }}
            >
              {tab.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
