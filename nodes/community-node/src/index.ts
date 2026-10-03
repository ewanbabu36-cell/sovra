import { Result, ok } from '@sovra/shared';

export interface CommunityNodeConfig {
  readonly communityId: string;
  readonly pinMediaAssets: boolean;
  readonly enableMemberDirectory: boolean;
}

export class CommunityNodeDaemon {
  constructor(private readonly config: CommunityNodeConfig) {}

  public getConfig(): CommunityNodeConfig {
    return this.config;
  }

  public async start(): Promise<Result<void>> {
    return ok(undefined);
  }
}
