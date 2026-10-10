import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { SovraOfflineOutbox } from '../../apps/sovra-app/src/ui/SovraOfflineOutbox.js';

// Minimalistic Node-compliant in-memory IndexedDB Mock for Vitest
class MockIDBStore {
  private data = new Map<string, any>();

  add(val: any) {
    this.data.set(val.id, val);
    const req: any = { onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }

  get(key: string) {
    const val = this.data.get(key);
    const req: any = { onsuccess: null, onerror: null, result: val };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }

  put(val: any) {
    this.data.set(val.id, val);
    const req: any = { onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }

  delete(key: string) {
    this.data.delete(key);
    const req: any = { onsuccess: null, onerror: null };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }

  index(name: string) {
    return {
      getAll: () => {
        const arr = Array.from(this.data.values());
        const req: any = { onsuccess: null, onerror: null, result: arr };
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
      }
    };
  }
}

class MockIDBDatabase {
  private store = new MockIDBStore();
  public objectStoreNames = { contains: () => true };

  transaction(name: string, mode: string) {
    const tx: any = {};
    return {
      objectStore: () => this.store
    };
  }
}

const mockIndexedDB = {
  open: (name: string, version: number) => {
    const db = new MockIDBDatabase();
    const req: any = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
    setTimeout(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
};

describe('Sovra Browser Persistent Offline Outbox (IndexedDB)', () => {
  let outbox: SovraOfflineOutbox;

  beforeAll(() => {
    (global as any).window = {
      indexedDB: mockIndexedDB,
      addEventListener: () => {},
      dispatchEvent: () => {}
    };
  });

  beforeEach(() => {
    outbox = SovraOfflineOutbox.getInstance();
  });

  it('enqueues an offline action and persists it with unique ID and PENDING state', async () => {
    const action = await outbox.enqueue('/api/feed/create', {
      caption: 'Offline sovereign message',
      visibility: 'public'
    });

    expect(action.id).toMatch(/^out_\d+_/);
    expect(action.status).toBe('PENDING');
    expect(action.payload.caption).toBe('Offline sovereign message');

    const pending = await outbox.getPendingActions();
    const found = pending.find(p => p.id === action.id);
    expect(found).toBeDefined();
    expect(found!.endpoint).toBe('/api/feed/create');
  });

  it('drains outbox when network is available and successfully dispatches payload', async () => {
    const originalFetch = global.fetch;
    const dispatchedUrls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      dispatchedUrls.push(String(input));
      return new Response(JSON.stringify({ ok: true, id: 'post_synced_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const action = await outbox.enqueue('/api/feed/create', { caption: 'Sync me when online' });
      const result = await outbox.drainOutbox();

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(dispatchedUrls).toContain('/api/feed/create');

      const remaining = await outbox.getPendingActions();
      const stillPending = remaining.find(p => p.id === action.id);
      expect(stillPending).toBeUndefined(); // Successfully purged on 200 OK
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles server 503 error gracefully by leaving item in queue with retry count incremented', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      return new Response(JSON.stringify({ ok: false, error: 'Database busy' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const action = await outbox.enqueue('/api/feed/create', { caption: 'Will retry' });
      const result = await outbox.drainOutbox();

      expect(result.failed).toBeGreaterThanOrEqual(1);
      const pending = await outbox.getPendingActions();
      const item = pending.find(p => p.id === action.id);
      expect(item).toBeDefined();
      expect(item!.retryCount).toBeGreaterThanOrEqual(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles chat messages queued offline and emits sovra-outbox-synced event upon successful delivery', async () => {
    const originalFetch = global.fetch;
    const syncedEvents: any[] = [];
    (global as any).window.dispatchEvent = (event: any) => {
      if (event && event.type === 'sovra-outbox-synced') {
        syncedEvents.push(event.detail);
      }
    };

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true, message: { id: 'msg-999', status: 'sent' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const chatPayload = {
        id: 'msg-offline-1',
        senderDid: 'did:sovra:alice',
        recipientDid: 'did:sovra:bob',
        text: 'Hello from offline mesh mode',
        timestamp: Date.now()
      };

      const action = await outbox.enqueue('/api/chat/send', chatPayload);
      expect(action.status).toBe('PENDING');

      const result = await outbox.drainOutbox();
      expect(result.processed).toBeGreaterThanOrEqual(1);

      const event = syncedEvents.find(e => e.action && e.action.id === action.id);
      expect(event).toBeDefined();
      expect(event.success).toBe(true);
      expect(event.action.endpoint).toBe('/api/chat/send');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

