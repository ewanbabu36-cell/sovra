import { NatStatus, NatTraversalService } from './types.js';

export class NatManager implements NatTraversalService {
  private _status: NatStatus = 'direct';
  private publicMultiaddrs: string[] = [];

  constructor(
    localAddresses: readonly string[] = [],
    private readonly checkReachabilityFn?: () => Promise<{
      reachable: boolean;
      observedAddr?: string;
    }>,
  ) {
    this.publicMultiaddrs = [...localAddresses];
  }

  public get status(): NatStatus {
    return this._status;
  }

  public setStatus(newStatus: NatStatus): void {
    this._status = newStatus;
  }

  public async detectNat(): Promise<NatStatus> {
    if (this.checkReachabilityFn) {
      try {
        const result = await this.checkReachabilityFn();
        if (result.reachable) {
          this._status = 'direct';
          if (result.observedAddr && !this.publicMultiaddrs.includes(result.observedAddr)) {
            this.publicMultiaddrs.push(result.observedAddr);
          }
        } else {
          this._status = 'relayed';
        }
      } catch {
        this._status = 'relayed';
      }
    }
    return this._status;
  }

  public getPublicMultiaddrs(): readonly string[] {
    return this.publicMultiaddrs;
  }

  public addObservedAddress(address: string): void {
    if (!this.publicMultiaddrs.includes(address)) {
      this.publicMultiaddrs.push(address);
    }
  }
}
