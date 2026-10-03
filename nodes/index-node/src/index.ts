import { Result, ok } from '@sovra/shared';

export interface IndexNodeConfig {
  readonly queryListenPort: number;
  readonly maxIndexedEvents: number;
}

export class IndexNodeDaemon {
  constructor(private readonly config: IndexNodeConfig) {}

  public getConfig(): IndexNodeConfig {
    return this.config;
  }

  public async start(): Promise<Result<void>> {
    return ok(undefined);
  }
}
