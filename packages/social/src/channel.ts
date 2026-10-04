import { Result, ok, err } from '@sovra/shared';
import { ChannelMetadata, ChannelRoleAssignment } from './types.js';

export interface CreateChannelInput {
  readonly ownerPubkey: string;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly category: 'tech' | 'gaming' | 'news' | 'comedy' | 'education' | 'lifestyle' | 'music' | 'other';
  readonly type?: 'broadcast' | 'community' | undefined;
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
}

export interface UpdateChannelInput {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: 'tech' | 'gaming' | 'news' | 'comedy' | 'education' | 'lifestyle' | 'music' | 'other' | undefined;
  readonly avatarUrl?: string | undefined;
  readonly bannerUrl?: string | undefined;
}

/**
 * Sovereign Channel Manager.
 * Governs decentralized broadcast and community channels with sub-identity delegation,
 * role-based access control (Owner, Editor, Moderator), and subscriber swarms.
 */
export class ChannelManager {
  private readonly channelsById = new Map<string, ChannelMetadata>();
  private readonly channelIdByHandle = new Map<string, string>();
  private readonly subscribersByChannel = new Map<string, Set<string>>();

  /**
   * Creates a new channel with the creator as the Owner.
   */
  public createChannel(input: CreateChannelInput): Result<ChannelMetadata> {
    const cleanHandle = input.handle.startsWith('@') ? input.handle.toLowerCase() : `@${input.handle.toLowerCase()}`;

    if (this.channelIdByHandle.has(cleanHandle)) {
      return err(new Error(`Channel handle ${cleanHandle} is already registered`));
    }

    const channelId = `did:key:${input.ownerPubkey}#channel-${Date.now().toString(36)}`;
    const roles: ChannelRoleAssignment[] = [
      {
        pubkey: input.ownerPubkey,
        role: 'owner',
      },
    ];

    const metadata: ChannelMetadata = {
      id: channelId,
      ownerPubkey: input.ownerPubkey,
      handle: cleanHandle,
      name: input.name,
      description: input.description,
      category: input.category,
      avatarUrl: input.avatarUrl,
      bannerUrl: input.bannerUrl,
      type: input.type ?? 'broadcast',
      roles,
      subscriberCount: 0,
      createdAt: Math.floor(Date.now() / 1000),
    };

    this.channelsById.set(channelId, metadata);
    this.channelIdByHandle.set(cleanHandle, channelId);
    this.subscribersByChannel.set(channelId, new Set());

    return ok(metadata);
  }

  /**
   * Updates channel metadata. Must be executed by Owner or Editor.
   */
  public updateChannel(
    channelId: string,
    callerPubkey: string,
    updates: UpdateChannelInput,
  ): Result<ChannelMetadata> {
    const channel = this.channelsById.get(channelId);
    if (!channel) {
      return err(new Error(`Channel ${channelId} not found`));
    }

    if (!this.hasPermission(channel, callerPubkey, 'editor')) {
      return err(new Error(`Caller ${callerPubkey} unauthorized to update channel`));
    }

    const updated: ChannelMetadata = {
      ...channel,
      name: updates.name ?? channel.name,
      description: updates.description ?? channel.description,
      category: updates.category ?? channel.category,
      avatarUrl: updates.avatarUrl ?? channel.avatarUrl,
      bannerUrl: updates.bannerUrl ?? channel.bannerUrl,
    };

    this.channelsById.set(channelId, updated);
    return ok(updated);
  }

  /**
   * Assigns or updates a role. Must be executed by the Channel Owner.
   */
  public assignRole(
    channelId: string,
    callerPubkey: string,
    targetPubkey: string,
    role: 'owner' | 'editor' | 'moderator',
  ): Result<ChannelMetadata> {
    const channel = this.channelsById.get(channelId);
    if (!channel) {
      return err(new Error(`Channel ${channelId} not found`));
    }

    if (channel.ownerPubkey !== callerPubkey) {
      return err(new Error(`Only channel owner can assign administrative roles`));
    }

    const existingRoles = channel.roles.filter(r => r.pubkey !== targetPubkey);
    const newRoles: ChannelRoleAssignment[] = [...existingRoles, { pubkey: targetPubkey, role }];

    const updated: ChannelMetadata = {
      ...channel,
      roles: newRoles,
    };

    this.channelsById.set(channelId, updated);
    return ok(updated);
  }

  /**
   * Subscribes a user to the channel.
   */
  public subscribe(channelId: string, subscriberPubkey: string): Result<number> {
    const channel = this.channelsById.get(channelId);
    if (!channel) {
      return err(new Error(`Channel ${channelId} not found`));
    }

    let subs = this.subscribersByChannel.get(channelId);
    if (!subs) {
      subs = new Set();
      this.subscribersByChannel.set(channelId, subs);
    }

    subs.add(subscriberPubkey);
    const updatedCount = subs.size;

    this.channelsById.set(channelId, {
      ...channel,
      subscriberCount: updatedCount,
    });

    return ok(updatedCount);
  }

  /**
   * Unsubscribes a user from the channel.
   */
  public unsubscribe(channelId: string, subscriberPubkey: string): Result<number> {
    const channel = this.channelsById.get(channelId);
    if (!channel) {
      return err(new Error(`Channel ${channelId} not found`));
    }

    const subs = this.subscribersByChannel.get(channelId);
    if (subs) {
      subs.delete(subscriberPubkey);
      const updatedCount = subs.size;
      this.channelsById.set(channelId, {
        ...channel,
        subscriberCount: updatedCount,
      });
      return ok(updatedCount);
    }

    return ok(channel.subscriberCount);
  }

  public isSubscribed(channelId: string, subscriberPubkey: string): boolean {
    return this.subscribersByChannel.get(channelId)?.has(subscriberPubkey) ?? false;
  }

  public getChannel(channelId: string): ChannelMetadata | undefined {
    return this.channelsById.get(channelId);
  }

  public getChannelByHandle(handle: string): ChannelMetadata | undefined {
    const cleanHandle = handle.startsWith('@') ? handle.toLowerCase() : `@${handle.toLowerCase()}`;
    const id = this.channelIdByHandle.get(cleanHandle);
    return id ? this.channelsById.get(id) : undefined;
  }

  public getChannelsByOwner(ownerPubkey: string): readonly ChannelMetadata[] {
    const list: ChannelMetadata[] = [];
    for (const ch of this.channelsById.values()) {
      if (ch.ownerPubkey === ownerPubkey) list.push(ch);
    }
    return list;
  }

  public getAllChannels(): readonly ChannelMetadata[] {
    return Array.from(this.channelsById.values());
  }

  private hasPermission(
    channel: ChannelMetadata,
    pubkey: string,
    minRole: 'owner' | 'editor' | 'moderator',
  ): boolean {
    if (channel.ownerPubkey === pubkey) return true;
    const assignment = channel.roles.find(r => r.pubkey === pubkey);
    if (!assignment) return false;

    if (minRole === 'moderator') return true;
    if (minRole === 'editor') return assignment.role === 'owner' || assignment.role === 'editor';
    if (minRole === 'owner') return assignment.role === 'owner';
    return false;
  }
}
