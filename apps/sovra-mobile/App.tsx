/**
 * @file apps/sovra-mobile/App.tsx
 * Root Entry Point for Sovra Decentralized Mobile App (React Native / Expo).
 *
 * Implements:
 * 1. P2P Mobile Light Client lifecycle.
 * 2. 5-Tab Super-App Navigation (Instagram Feed/Reels, YouTube Watch, WhatsApp Chats, Me).
 */

import React from 'react';
import { BottomTabNavigator } from './src/navigation/BottomTabNavigator.js';

export default function App(): React.JSX.Element {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#000',
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <BottomTabNavigator />
    </div>
  );
}
