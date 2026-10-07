/**
 * @file nodes/full-node/src/index.ts
 * Production Standalone Full Node Daemon.
 */

import path from 'node:path';
import { Result, ok, err } from '@sovra/shared';
import { SovraIdentityKey, SovraDeviceKey } from '@sovra/identity';
import { SovraP2PNode } from '@sovra/p2p';
import { MemoryBlockstore, DiskBlockstore, TieredBlockstore } from '@sovra/storage';
import { SignedOperation } from '@sovra/protocol';

export interface FullNodeConfig {
  readonly listenAddresses: readonly string[];
  readonly bootstrapNodes: readonly string[];
  readonly enableDht: boolean;
  readonly enableRelayClient: boolean;
  readonly dataDir?: string | undefined;
  readonly deviceKey?: SovraDeviceKey | undefined;
  readonly identityKey?: SovraIdentityKey | undefined;
}

export class FullNodeDaemon {
  public p2pNode?: SovraP2PNode | undefined;
  public blockstore?: TieredBlockstore | undefined;
  private _isRunning = false;
  private readonly operationHandlers = new Set<(op: SignedOperation<unknown>) => void>();

  constructor(private readonly config: FullNodeConfig) {}

  public getConfig(): FullNodeConfig {
    return this.config;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);

    try {
      // 1. Establish Node Keys
      let deviceKey = this.config.deviceKey;
      if (!deviceKey) {
        const rootKey = this.config.identityKey ?? SovraIdentityKey.generate();
        deviceKey = SovraDeviceKey.generate(
          'fullnode_device',
          'Full Node Workstation',
          rootKey.did,
          Math.floor(Date.now() / 1000) + 365 * 86400,
        );
      }

      // 2. Initialize Dual-Tier Local Storage Blockstore
      const l1Memory = new MemoryBlockstore(64 * 1024 * 1024); // 64 MB L1
      const storagePath = this.config.dataDir
        ? path.join(this.config.dataDir, 'blocks')
        : path.join(process.cwd(), '.sovra-fullnode', 'blocks');
      const l2Disk = new DiskBlockstore(storagePath, 1024 * 1024 * 1024); // 1 GB disk quota
      this.blockstore = new TieredBlockstore(l1Memory, l2Disk);

      // 3. Initialize P2P Swarm Node
      this.p2pNode = new SovraP2PNode({
        deviceKey,
        listenAddresses: this.config.listenAddresses,
        bootstrapConfig: {
          bootstrapNodes: this.config.bootstrapNodes,
        },
      });

      const startRes = await this.p2pNode.start();
      if (!startRes.ok) {
        return err(startRes.error);
      }

      // 4. Join GossipSub Swarm Topics
      await this.p2pNode.pubsub.subscribe('/sovra/v1/feed', () => {});
      await this.p2pNode.pubsub.subscribe('/sovra/v1/ops', (message) => {
        try {
          const rawJson = new TextDecoder().decode(message.data);
          const op = JSON.parse(rawJson) as SignedOperation<unknown>;
          for (const handler of this.operationHandlers) {
            handler(op);
          }
        } catch {}
      });

      this._isRunning = true;
      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public async stop(): Promise<Result<void>> {
    if (!this._isRunning) return ok(undefined);
    this._isRunning = false;

    if (this.p2pNode) {
      await this.p2pNode.stop();
      this.p2pNode = undefined;
    }

    this.operationHandlers.clear();
    return ok(undefined);
  }

  public async publishOperation<T>(op: SignedOperation<T>): Promise<Result<void>> {
    if (!this.p2pNode || !this._isRunning) {
      return err(new Error('Full node daemon is not running'));
    }
    try {
      const payloadBytes = new TextEncoder().encode(JSON.stringify(op));
      const res = await this.p2pNode.pubsub.publish('/sovra/v1/ops', payloadBytes);
      if (!res.ok) {
        return err(res.error);
      }
      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public onOperation(handler: (op: SignedOperation<unknown>) => void): () => void {
    this.operationHandlers.add(handler);
    return () => {
      this.operationHandlers.delete(handler);
    };
  }

  public getP2PNode(): SovraP2PNode | undefined {
    return this.p2pNode;
  }

  public getBlockstore(): TieredBlockstore | undefined {
    return this.blockstore;
  }
}
