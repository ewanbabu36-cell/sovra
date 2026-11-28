/**
 * @file apps/sovra-mobile/src/main.tsx
 * Standalone Mobile Hybrid App Entrypoint.
 * Mounts the full 5-tab React root (<BottomTabNavigator />) and enforces
 * zero-domain-first multi-relay configuration by default.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BottomTabNavigator } from './navigation/BottomTabNavigator.js';
import { multiRelayManager } from './services/multi-relay-manager.js';

export interface MobileAppInitOptions {
  readonly zeroDomainOnly?: boolean;
}

const activeRoots = new WeakMap<HTMLElement, Root>();

export function initMobileApp(
  mountEl?: HTMLElement | null,
  options?: MobileAppInitOptions,
): Root | null {
  const root = mountEl || (typeof document !== 'undefined' ? document.getElementById('root') : null);
  if (!root) return null;

  multiRelayManager.setZeroDomainOnly(options?.zeroDomainOnly ?? true);

  let shell = root.querySelector(':scope > .sovra-mobile-shell') as HTMLElement | null;
  if (!shell) {
    root.innerHTML = '';
    shell = document.createElement('div');
    shell.className = 'sovra-mobile-shell';
    shell.style.width = '100%';
    shell.style.height = '100%';
    shell.style.backgroundColor = '#000';
    shell.style.display = 'flex';
    shell.style.flexDirection = 'column';
    root.appendChild(shell);
  }

  let reactRoot = activeRoots.get(shell);
  if (!reactRoot) {
    reactRoot = createRoot(shell);
    activeRoots.set(shell, reactRoot);
  }

  reactRoot.render(React.createElement(BottomTabNavigator));
  return reactRoot;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMobileApp());
  } else {
    initMobileApp();
  }
}
