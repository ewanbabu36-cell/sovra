/**
 * @file scripts/views/styles.view.ts
 * Global Sovra CSS Stylesheet & Theme Tokens
 * Compatibility stub delegating to modular stylesheets in apps/sovra-app/src/styles/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssFilePath = path.resolve(__dirname, '../../apps/sovra-app/src/styles/sovra.css');
const distCssPath = path.resolve(__dirname, '../../apps/sovra-app/dist/sovra.css');

let cachedCss: string | null = null;

export function renderGlobalStyles(isCreatorModeActive: boolean = false): string {
  if (!cachedCss || process.env.NODE_ENV !== 'production') {
    if (fs.existsSync(cssFilePath)) {
      cachedCss = fs.readFileSync(cssFilePath, 'utf-8');
    } else if (fs.existsSync(distCssPath)) {
      cachedCss = fs.readFileSync(distCssPath, 'utf-8');
    } else {
      cachedCss = '/* sovra.css loading */';
    }
  }
  const osStyles = `
/* Sovereign OS Runtime Modes */
body.sovra-mode-home .app-layout { display: none !important; }
body.sovra-mode-home .app-top-header { display: none !important; }
body.sovra-mode-home .sovra-android-nav-bar { display: flex !important; }
body.sovra-mode-app .sovra-home-screen-view { display: none !important; }
body.sovra-mode-app .sovra-android-nav-bar { display: flex !important; }
body.sovra-mode-app .app-layout { display: flex !important; }

/* ========================================================
   SOVRA CREATOR STUDIO & LIVE COMMAND CENTER (YouTube Studio Parity)
   ======================================================== */
.studio-main-viewport {
  width: 100% !important;
  min-height: 100vh;
  box-sizing: border-box;
}

/* Studio Pro Full-Width Mode (YouTube Studio Parity) */
body.tab-active-studio .app-left-rail,
body.tab-active-studio .app-right-rail,
body.tab-active-studio #spatialCoPilotDrawer,
body.tab-active-studio #appStageFooter {
  display: none !important;
}

body.tab-active-studio #feed-view {
  display: none !important;
}

body.tab-active-studio .app-center-stage {
  max-width: 100% !important;
  width: 100% !important;
  flex: 1 1 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}

body.tab-active-studio #studio-view {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
}

/* Hide Android System Nav on Desktop */
@media (min-width: 769px) {
  .sovra-android-nav-bar,
  #sovraAndroidNavBar,
  nav[aria-label="Android System Navigation"] {
    display: none !important;
  }
}

/* ========================================================
   TABLET PORTRAIT & MEDIUM SCREENS (768px - 1023px) 64px PERSISTENT RAIL
   ======================================================== */
@media (min-width: 768px) and (max-width: 1023px) {
  .app-layout {
    display: flex !important;
    flex-direction: row !important;
    width: 100% !important;
  }
  .app-left-rail {
    display: flex !important;
    flex-direction: column !important;
    width: 64px !important;
    min-width: 64px !important;
    max-width: 64px !important;
    padding: 0.75rem 0.35rem !important;
    align-items: center !important;
    position: sticky !important;
    top: 58px !important;
    height: calc(100vh - 58px) !important;
    box-sizing: border-box !important;
    z-index: 100 !important;
    background: rgba(11, 15, 25, 0.95) !important;
    backdrop-filter: blur(20px) !important;
    -webkit-backdrop-filter: blur(20px) !important;
    border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
  }
  .app-left-rail .rail-brand,
  .app-left-rail .rail-label,
  .app-left-rail .rail-badge,
  .app-left-rail .rail-user-profile > div:not(#railUserAvatar),
  .app-left-rail .rail-user-profile .rail-logout-quick-btn,
  .app-left-rail .rail-post-btn span {
    display: none !important;
  }
  .app-left-rail .rail-nav {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
  }
  .app-left-rail .rail-nav-item {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
    min-height: 48px !important;
    padding: 0 !important;
    justify-content: center !important;
    align-items: center !important;
    border-radius: 12px !important;
  }
  .app-left-rail .rail-icon {
    font-size: 1.35rem !important;
    margin: 0 !important;
  }
  .app-left-rail .rail-actions-group {
    width: 100% !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    margin: 0.5rem 0 !important;
  }
  .app-left-rail .rail-post-btn {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
    min-height: 48px !important;
    padding: 0 !important;
    border-radius: 12px !important;
    justify-content: center !important;
    align-items: center !important;
  }
  .app-left-rail .rail-post-btn svg {
    margin: 0 !important;
    width: 20px !important;
    height: 20px !important;
  }
  .app-left-rail .rail-user-profile {
    width: 48px !important;
    height: 48px !important;
    padding: 0 !important;
    border-radius: 50% !important;
    justify-content: center !important;
    align-items: center !important;
  }
  .app-left-rail #railUserAvatar {
    width: 38px !important;
    height: 38px !important;
  }
  .app-right-rail,
  #spatialCoPilotDrawer {
    display: none !important;
  }
  .app-center-stage {
    flex: 1 1 auto !important;
    max-width: calc(100vw - 64px) !important;
    width: calc(100vw - 64px) !important;
    min-width: 0 !important;
    padding-left: 0.5rem !important;
    padding-right: 0.5rem !important;
  }
  .mobile-bottom-nav,
  .app-bottom-nav {
    display: none !important;
  }
}

/* ========================================================
   WCAG 2.5.5 / ANDROID MATERIAL 44×44PX TOUCH HITBOX POLISH
   ======================================================== */
.header-action-icon-btn,
#headerCreateBtn,
#headerChatBtn,
#headerNotificationBell,
#headerThemeToggleBtn {
  min-width: 44px !important;
  min-height: 44px !important;
  width: 44px !important;
  height: 44px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
}

@media (min-width: 861px) {
  #headerMobileSearchBtn,
  .header-menu-toggle-btn {
    display: none !important;
  }
}

/* Mobile Bottom Dock visible and cleanly stacked above Android System Bar */
@media (max-width: 860px) {
  #headerMobileSearchBtn {
    display: inline-flex !important;
    min-width: 40px !important;
    min-height: 40px !important;
    width: 40px !important;
    height: 40px !important;
    align-items: center !important;
    justify-content: center !important;
  }
  body.sovra-mode-app .mobile-bottom-nav,
  body.sovra-mode-app .app-bottom-nav {
    display: flex !important;
    bottom: 48px !important;
    z-index: 9998 !important;
  }
  body.sovra-mode-home .mobile-bottom-nav,
  body.sovra-mode-home .app-bottom-nav {
    display: none !important;
  }
}

/* Calls & Hybrid Mesh Dialer High-Contrast Theme Fix */
#calls-view,
#calls-view h1,
#calls-view h2,
#calls-view h3,
#calls-view h4,
#calls-view p,
#calls-view span,
#calls-view div {
  color: #f1f5f9;
}
#calls-view .dialpad-btn,
#calls-view .dialer-key {
  color: #f8fafc !important;
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
}

#studioDashboardShell {
  width: 100%;
}

.studio-top-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.studio-layout-shell {
  display: flex;
  gap: 20px;
  width: 100%;
  align-items: flex-start;
}

.studio-sidebar {
  width: 250px;
  min-width: 250px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.studio-sidebar-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  margin-bottom: 10px;
}

.studio-sidebar-nav-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #94a3b8;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.studio-sidebar-nav-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  border-color: rgba(255, 255, 255, 0.08);
}

.studio-sidebar-nav-btn.active {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(99, 102, 241, 0.16));
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  font-weight: 700;
  box-shadow: 0 2px 12px rgba(56, 189, 248, 0.15);
}

.studio-main-workspace {
  flex: 1;
  min-width: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.studio-live-stage {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.studio-live-video-box {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #020617;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sovra-global-live-hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10001;
  background: linear-gradient(90deg, rgba(185, 28, 28, 0.98), rgba(153, 27, 27, 0.98));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: #fff;
  border-bottom: 2px solid #ef4444;
  box-shadow: 0 4px 24px rgba(239, 68, 68, 0.5);
  padding: 8px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: sovraFadeIn 0.3s ease-out;
}

@keyframes sovraLivePulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  100% { transform: scale(1.15); opacity: 1; }
}

@keyframes sovraFadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 900px) {
  .studio-layout-shell {
    flex-direction: column;
  }
  .studio-sidebar {
    width: 100%;
    min-width: 100%;
  }
}
`;
  if (isCreatorModeActive) {
    return cachedCss + osStyles + '\nbody.creator-mode-active .creator-banner { display: block !important; }\n';
  }
  return cachedCss + osStyles;
}
