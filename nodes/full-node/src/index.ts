import { Result, ok } from '@sovra/shared';

export interface FullNodeConfig {
  readonly listenAddresses: readonly string[];
  readonly bootstrapNodes: readonly string[];
  readonly enableDht: boolean;
  readonly enableRelayClient: boolean;
}

export class FullNodeDaemon {
  constructor(private readonly config: FullNodeConfig) {}

  public getConfig(): FullNodeConfig {
    return this.config;
  }

  public async start(): Promise<Result<void>> {
    return ok(undefined);
  }
}
