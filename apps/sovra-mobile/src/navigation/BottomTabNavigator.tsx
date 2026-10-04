/**
 * @file apps/sovra-mobile/src/navigation/BottomTabNavigator.tsx
 * 5-Tab Mobile Navigation Controller for Sovra.
 */

import React, { useState } from 'react';
import { FeedScreen } from '../screens/FeedScreen.js';
import { ReelsScreen } from '../screens/ReelsScreen.js';
import { WatchScreen } from '../screens/WatchScreen.js';
import { ChatsScreen } from '../screens/ChatsScreen.js';
import { MeScreen } from '../screens/MeScreen.js';

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
      {/* Screen Viewport */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderActiveScreen()}
      </div>

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
