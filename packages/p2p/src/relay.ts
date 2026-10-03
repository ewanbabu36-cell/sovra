import { Result, ok, err } from '@sovra/shared';
import { RelayReservation, RelayService } from './types.js';
import { RelayUnavailableError } from './errors.js';

export class CircuitRelayClient implements RelayService {
  private activeRelays = new Set<string>();
  private reservations = new Map<string, RelayReservation>();

  constructor(initialRelays: readonly string[] = []) {
    for (const relay of initialRelays) {
      this.activeRelays.add(relay);
    }
  }

  public isRelayAvailable(): boolean {
    return this.activeRelays.size > 0;
  }

  public getActiveRelays(): readonly string[] {
    return Array.from(this.activeRelays);
  }

  public addRelay(relayMultiaddr: string): void {
    this.activeRelays.add(relayMultiaddr);
  }

  public removeRelay(relayMultiaddr: string): void {
    this.activeRelays.delete(relayMultiaddr);
    this.reservations.delete(relayMultiaddr);
  }

  public async requestReservation(relayMultiaddr: string): Promise<Result<boolean>> {
    if (!this.activeRelays.has(relayMultiaddr)) {
      return err(new RelayUnavailableError(`Relay ${relayMultiaddr} is not registered or active`));
    }

    const parts = relayMultiaddr.split('/p2p/');
    const relayPeerId = parts[1] ?? 'unknown-relay';

    // Simulate 2-hour reservation
    const expiresAt = Math.floor(Date.now() / 1000) + 7200;
    const reservation: RelayReservation = {
      relayMultiaddr,
      relayPeerId,
      expiresAt,
      active: true,
    };

    this.reservations.set(relayMultiaddr, reservation);
    return ok(true);
  }

  public getReservations(): readonly RelayReservation[] {
    return Array.from(this.reservations.values());
  }

  /**
   * Attempts connection through configured relays with automatic failover.
   * If primary relay fails, tries next active relay in set.
   */
  public async routeThroughAvailableRelay<T>(
    targetPeerId: string,
    action: (relayMultiaddr: string) => Promise<T>,
  ): Promise<Result<T>> {
    const relays = Array.from(this.activeRelays);
    if (relays.length === 0) {
      return err(new RelayUnavailableError('No active circuit relays available for routing'));
    }

    let lastError: unknown;
    for (const relay of relays) {
      try {
        const result = await action(relay);
        return ok(result);
      } catch (e) {
        lastError = e;
        // Continue to fallback relay
      }
    }

    return err(
      new RelayUnavailableError('All circuit relay candidates failed to route connection', {
        targetPeerId,
        candidateCount: relays.length,
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
      }),
    );
  }
}
