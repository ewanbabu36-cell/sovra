/**
 * @file apps/sovra-mobile/src/main.tsx
 * Standalone Mobile Hybrid App Entrypoint.
 */

import React from 'react';
import App from '../App.js';

export function initMobileApp(mountEl?: HTMLElement | null): void {
  const root = mountEl || document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';

  const mobileFrame = document.createElement('div');
  mobileFrame.className = 'sovra-mobile-shell';
  mobileFrame.style.width = '100%';
  mobileFrame.style.height = '100%';
  mobileFrame.style.backgroundColor = '#000';
  mobileFrame.style.display = 'flex';
  mobileFrame.style.flexDirection = 'column';
  root.appendChild(mobileFrame);

  console.log('[Sovra Mobile] Hybrid PWA / Capacitor client active and initialized.');
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMobileApp());
  } else {
    initMobileApp();
  }
}
