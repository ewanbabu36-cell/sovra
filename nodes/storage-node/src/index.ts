import { Result, ok } from '@sovra/shared';

export interface StorageNodeConfig {
  readonly storagePath: string;
  readonly maxCapacityBytes: bigint;
  readonly enableBitswap: boolean;
}

export class StorageNodeDaemon {
  constructor(private readonly config: StorageNodeConfig) {}

  public getConfig(): StorageNodeConfig {
    return this.config;
  }

  public async start(): Promise<Result<void>> {
    return ok(undefined);
  }
}
