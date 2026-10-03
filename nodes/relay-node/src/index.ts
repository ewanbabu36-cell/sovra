import { Result, ok } from '@sovra/shared';

export interface RelayNodeConfig {
  readonly listenPort: number;
  readonly maxReservations: number;
  readonly maxCircuits: number;
  readonly bufferDurationSeconds: number;
}

export class RelayDaemon {
  constructor(private readonly config: RelayNodeConfig) {}

  public getConfig(): RelayNodeConfig {
    return this.config;
  }

  public async start(): Promise<Result<void>> {
    return ok(undefined);
  }
}
