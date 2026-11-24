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
