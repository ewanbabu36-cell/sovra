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
`;
  if (isCreatorModeActive) {
    return cachedCss + osStyles + '\nbody.creator-mode-active .creator-banner { display: block !important; }\n';
  }
  return cachedCss + osStyles;
}
