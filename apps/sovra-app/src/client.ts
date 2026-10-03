import { Result, ok } from '@sovra/shared';
import { PublicIdentity } from '@sovra/identity';

export interface DeviceScreenTimeLimits {
  readonly dailyAppLimitMinutes: number;
  readonly feedLimitMinutes: number;
  readonly shortVideoLimitMinutes: number;
  readonly exploreLimitMinutes: number;
  readonly quietHoursEnabled: boolean;
  readonly quietHoursStart: string; // "22:00"
  readonly quietHoursEnd: string; // "07:00"
}

export interface SovraClientState {
  readonly currentIdentity: PublicIdentity | null;
  readonly isCreatorModeActive: boolean;
  readonly screenTimeLimits: DeviceScreenTimeLimits;
}

export class SovraClient {
  private state: SovraClientState;

  constructor() {
    this.state = {
      currentIdentity: null,
      isCreatorModeActive: false,
      screenTimeLimits: {
        dailyAppLimitMinutes: 60,
        feedLimitMinutes: 30,
        shortVideoLimitMinutes: 20,
        exploreLimitMinutes: 15,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    };
  }

  public getState(): SovraClientState {
    return this.state;
  }

  public toggleCreatorMode(active: boolean): Result<boolean> {
    this.state = {
      ...this.state,
      isCreatorModeActive: active,
    };
    return ok(this.state.isCreatorModeActive);
  }
}
