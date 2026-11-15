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
  if (!cachedCss) {
    if (fs.existsSync(cssFilePath)) {
      cachedCss = fs.readFileSync(cssFilePath, 'utf-8');
    } else if (fs.existsSync(distCssPath)) {
      cachedCss = fs.readFileSync(distCssPath, 'utf-8');
    } else {
      cachedCss = '/* sovra.css loading */';
    }
  }
  if (isCreatorModeActive) {
    return cachedCss + '\nbody.creator-mode-active .creator-banner { display: block !important; }\n';
  }
  return cachedCss;
}
