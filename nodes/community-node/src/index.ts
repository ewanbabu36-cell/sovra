/**
 * @file nodes/community-node/src/index.ts
 * Standalone Community Node Daemon.
 */

import { Result, ok, err } from '@sovra/shared';
import { SovraIdentityKey, SovraDeviceKey } from '@sovra/identity';
import { SovraP2PNode } from '@sovra/p2p';
import { MemoryBlockstore, CID } from '@sovra/storage';

export interface CommunityMemberRecord {
  readonly did: string;
  readonly role: 'owner' | 'admin' | 'moderator' | 'member';
  readonly joinedAt: number;
}

export interface CommunityNodeConfig {
  readonly communityId: string;
  readonly pinMediaAssets: boolean;
  readonly enableMemberDirectory: boolean;
  readonly listenAddresses?: readonly string[] | undefined;
  readonly deviceKey?: SovraDeviceKey | undefined;
}

export class CommunityNodeDaemon {
  public p2pNode?: SovraP2PNode | undefined;
  public blockstore?: MemoryBlockstore | undefined;
  private readonly members = new Map<string, CommunityMemberRecord>();
  private readonly pinnedCids = new Set<string>();
  private _isRunning = false;

  constructor(private readonly config: CommunityNodeConfig) {}

  public getConfig(): CommunityNodeConfig {
    return this.config;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public async start(): Promise<Result<void>> {
    if (this._isRunning) return ok(undefined);

    try {
      // 1. Initialize Storage Blockstore if media pinning enabled
      if (this.config.pinMediaAssets) {
        this.blockstore = new MemoryBlockstore(128 * 1024 * 1024); // 128 MB cache
      }

      // 2. Initialize P2P Swarm Node
      let deviceKey = this.config.deviceKey;
      if (!deviceKey) {
        const rootKey = SovraIdentityKey.generate();
        deviceKey = SovraDeviceKey.generate(
          `community_${this.config.communityId}`,
          `Community Node [${this.config.communityId}]`,
          rootKey.did,
          Math.floor(Date.now() / 1000) + 365 * 86400,
        );
      }

      this.p2pNode = new SovraP2PNode({
        deviceKey,
        ...(this.config.listenAddresses ? { listenAddresses: this.config.listenAddresses } : {}),
      });

      const p2pRes = await this.p2pNode.start();
      if (!p2pRes.ok) {
        return err(p2pRes.error);
      }

      // 3. Subscribe to Community Topic
      const communityTopic = `/sovra/community/${this.config.communityId}`;
      await this.p2pNode.pubsub.subscribe(communityTopic, (msg) => {
        try {
          const payload = JSON.parse(new TextDecoder().decode(msg.data));
          if (payload.type === 'MEMBER_JOIN' && this.config.enableMemberDirectory) {
            this.addMember(payload.did, 'member');
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

    return ok(undefined);
  }

  public addMember(did: string, role: CommunityMemberRecord['role'] = 'member'): Result<CommunityMemberRecord> {
    if (!this.config.enableMemberDirectory) {
      return err(new Error('Member directory is disabled on this community node'));
    }
    const record: CommunityMemberRecord = {
      did,
      role,
      joinedAt: Date.now(),
    };
    this.members.set(did, record);
    return ok(record);
  }

  public removeMember(did: string): Result<boolean> {
    if (!this.config.enableMemberDirectory) {
      return err(new Error('Member directory is disabled on this community node'));
    }
    const existed = this.members.delete(did);
    return ok(existed);
  }

  public getMember(did: string): CommunityMemberRecord | undefined {
    return this.members.get(did);
  }

  public listMembers(): readonly CommunityMemberRecord[] {
    return Array.from(this.members.values());
  }

  public async pinAsset(cidStr: string, data?: Uint8Array): Promise<Result<void>> {
    if (!this.config.pinMediaAssets || !this.blockstore) {
      return err(new Error('Media pinning is disabled on this community node'));
    }
    try {
      this.pinnedCids.add(cidStr);
      if (data) {
        const cid = CID.parse(cidStr);
        await this.blockstore.put(cid, data);
      }
      return ok(undefined);
    } catch (e: any) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  public isAssetPinned(cidStr: string): boolean {
    return this.pinnedCids.has(cidStr);
  }
}
