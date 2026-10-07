import { SovraClient } from './client.js';
import * as routes from './routes.js';
import * as ui from './ui/index.js';
import * as hooks from './hooks/index.js';

declare global {
  interface Window {
    Sovra?: {
      client: SovraClient;
      routes: typeof routes;
      ui: typeof ui;
      hooks: typeof hooks;
      version: string;
      isBundleLoaded: boolean;
    };
  }
}

const client = new SovraClient();

if (typeof window !== 'undefined') {
  window.Sovra = {
    client,
    routes,
    ui,
    hooks,
    version: '1.0.0',
    isBundleLoaded: true,
  };
  console.log('[Sovra] Compiled client bundle loaded successfully.');
}

export { client, routes, ui, hooks };
