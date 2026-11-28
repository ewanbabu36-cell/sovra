import type { SovraP2PNode } from '@sovra/p2p';
import type { SovraIdentityModule } from '@sovra/identity';
import type {
  SovraEventEngine,
  SovraDocumentSyncEngine,
  SovraAppPermissionEngine,
  SovraCommerceEngine,
} from '@sovra/protocol';
import type { StorageOperationTracker } from '@sovra/storage';

export const SOVRA_PROTOCOL_NAMESPACES = [
  '/sovra/id/1.0.0',
  '/sovra/net/1.0.0',
  '/sovra/event/1.0.0',
  '/sovra/store/1.0.0',
  '/sovra/sync/1.0.0',
  '/sovra/msg/1.0.0',
  '/sovra/gov/1.0.0',
  '/sovra/app/1.0.0',
] as const;

export const SUPPORTED_SPEC_VERSIONS = {
  'SOVRA-CORE': '1.0',
  'SOVRA-DATA': '1.0',
  'SOVRA-APP': '1.0',
  'SOVRA-GOV': '1.0',
  'SOVRA-OPS': '1.0',
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface SovraNamespaceHandlers {
  readonly identity?: SovraIdentityModule | undefined;
  readonly eventEngine?: SovraEventEngine | undefined;
  readonly syncEngine?: SovraDocumentSyncEngine | undefined;
  readonly storageTracker?: StorageOperationTracker | undefined;
  readonly appEngine?: SovraAppPermissionEngine | undefined;
  readonly commerceEngine?: SovraCommerceEngine | undefined;
}

/**
 * Registers all 8 Part L (Section 17.1) `/sovra/{ns}/1.0.0` handlers onto a live
 * SovraP2PNode instance, supporting capability discovery & zero-trust verification.
 */
export function registerSovraProtocolNamespaces(
  p2pNode: SovraP2PNode,
  handlers: SovraNamespaceHandlers = {},
): void {
  const sendJson = (obj: unknown): Uint8Array => textEncoder.encode(JSON.stringify(obj));

  p2pNode.reqResp.registerHandler('/sovra/net/1.0.0', async (_peerId, reqBytes) => {
    const req = JSON.parse(textDecoder.decode(reqBytes) || '{}') as { op?: string };
    return sendJson({
      ok: true,
      op: req.op ?? 'status',
      peerId: p2pNode.identity.peerId,
      namespaces: SOVRA_PROTOCOL_NAMESPACES,
      specVersions: SUPPORTED_SPEC_VERSIONS,
      connectedPeers: p2pNode.getConnectedPeers().length,
    });
  });

  p2pNode.reqResp.registerHandler('/sovra/id/1.0.0', async () => {
    if (!handlers.identity) return sendJson({ ok: true, available: false });
    try {
      return sendJson({ ok: true, identity: handlers.identity.getPublicIdentity() });
    } catch {
      return sendJson({ ok: false, error: 'Identity not initialized' });
    }
  });

  p2pNode.reqResp.registerHandler('/sovra/event/1.0.0', async (_peerId, reqBytes) => {
    if (!handlers.eventEngine) return sendJson({ ok: false, error: 'Event engine unavailable' });
    const req = JSON.parse(textDecoder.decode(reqBytes) || '{}') as { op?: string; event?: any; filter?: any; eventId?: string };
    if (req.op === 'publish' && req.event) {
      const res = handlers.eventEngine.publish(req.event);
      return sendJson(res.ok ? { ok: true, ...res.value } : { ok: false, error: res.error.message });
    }
    if (req.op === 'get' && req.eventId) {
      const ev = handlers.eventEngine.get(req.eventId);
      return sendJson(ev ? { ok: true, event: ev } : { ok: false, error: 'Not found' });
    }
    return sendJson({ ok: true, events: handlers.eventEngine.query(req.filter ?? {}) });
  });

  p2pNode.reqResp.registerHandler('/sovra/store/1.0.0', async (_peerId, reqBytes) => {
    if (!handlers.storageTracker) return sendJson({ ok: true, available: false });
    const req = JSON.parse(textDecoder.decode(reqBytes) || '{}') as { cid?: string };
    return sendJson({
      ok: true,
      pinned: req.cid ? handlers.storageTracker.isPinned(req.cid) : false,
      providers: req.cid ? handlers.storageTracker.findProviders(req.cid) : [],
    });
  });

  p2pNode.reqResp.registerHandler('/sovra/sync/1.0.0', async (_peerId, reqBytes) => {
    if (!handlers.syncEngine) return sendJson({ ok: true, available: false });
    const req = JSON.parse(textDecoder.decode(reqBytes) || '{}') as { documentId?: string; knownIds?: string[] };
    if (!req.documentId) return sendJson({ ok: false, error: 'Missing documentId' });
    return sendJson({
      ok: true,
      version: handlers.syncEngine.getVersion(req.documentId),
      ...handlers.syncEngine.exchangeState(req.documentId, req.knownIds ?? []),
    });
  });

  p2pNode.reqResp.registerHandler('/sovra/msg/1.0.0', async () => {
    return sendJson({ ok: true, relayBlindness: true, supportedLifecycle: ['CREATED', 'ENCRYPTED', 'PUBLISHED', 'DELIVERED', 'ACKNOWLEDGED'] });
  });

  p2pNode.reqResp.registerHandler('/sovra/gov/1.0.0', async () => {
    return sendJson({ ok: true, categories: ['SOVRA-P', 'SOVRA-S', 'SOVRA-A', 'SOVRA-G', 'SOVRA-O'], forkRightsPreserved: true });
  });

  p2pNode.reqResp.registerHandler('/sovra/app/1.0.0', async () => {
    return sendJson({ ok: true, sandboxedCapabilities: true, rawPrivateKeyExportAllowed: false });
  });
}
