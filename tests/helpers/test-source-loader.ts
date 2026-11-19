import fs from 'node:fs';
import path from 'node:path';

let cachedServerContent: string | null = null;

/**
 * Loads the aggregated server and client views source code.
 * Recombines scripts/dev-server.ts with scripts/views/ (layout, scripts, styles)
 * and scripts/routes/ to maintain 100% backward-compatibility for legacy test suites.
 */
export function loadServerContent(customDevServerPath?: string): string {
  if (cachedServerContent) {
    return cachedServerContent;
  }

  const root = process.cwd();
  const dsPath = customDevServerPath ? path.resolve(customDevServerPath) : path.resolve(root, 'scripts', 'dev-server.ts');
  const scriptsDir = path.dirname(dsPath);
  const viewsDir = path.join(scriptsDir, 'views');
  const routesDir = path.join(scriptsDir, 'routes');

  const parts: string[] = [];
  if (fs.existsSync(dsPath)) {
    parts.push(fs.readFileSync(dsPath, 'utf-8'));
  }

  if (fs.existsSync(viewsDir)) {
    for (const file of ['layout.view.ts', 'scripts.view.ts', 'styles.view.ts', 'index.view.ts']) {
      const p = path.join(viewsDir, file);
      if (fs.existsSync(p)) {
        parts.push(fs.readFileSync(p, 'utf-8'));
      }
    }
  }

  if (fs.existsSync(routesDir)) {
    try {
      for (const file of fs.readdirSync(routesDir)) {
        if (file.endsWith('.ts')) {
          parts.push(fs.readFileSync(path.join(routesDir, file), 'utf-8'));
        }
      }
    } catch (_) {}
  }

  // Modern Modular Frontend Architecture: styles and modules in apps/sovra-app/src
  const appSrcDir = path.resolve(root, 'apps', 'sovra-app', 'src');
  if (fs.existsSync(appSrcDir)) {
    try {
      const readAllFiles = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'test') {
            readAllFiles(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.css') || entry.name.endsWith('.js'))) {
            parts.push(fs.readFileSync(fullPath, 'utf-8'));
          }
        }
      };
      readAllFiles(appSrcDir);
    } catch (_) {}
  }

  const full = parts.join('\n');
  if (!customDevServerPath) {
    cachedServerContent = full;
  }
  return full;
}
