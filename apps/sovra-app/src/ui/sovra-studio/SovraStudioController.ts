/**
 * @file apps/sovra-app/src/ui/sovra-studio/SovraStudioController.ts
 * Unified SOVRA Studio Controller for Channels, Pages, and Groups
 */

import { SpaceStudioData, SpaceType } from './types.js';

export class SovraStudioController {
  private currentSpaceId: string | null = null;
  private currentSpaceType: SpaceType | null = null;
  private cachedData: SpaceStudioData | null = null;

  public setSpace(spaceId: string, spaceType: SpaceType): void {
    this.currentSpaceId = spaceId;
    this.currentSpaceType = spaceType;
  }

  public getActiveSpace(): { spaceId: string | null; spaceType: SpaceType | null } {
    return {
      spaceId: this.currentSpaceId,
      spaceType: this.currentSpaceType,
    };
  }

  public setCache(data: SpaceStudioData): void {
    this.cachedData = data;
  }

  public getCache(): SpaceStudioData | null {
    return this.cachedData;
  }

  public reset(): void {
    this.currentSpaceId = null;
    this.currentSpaceType = null;
    this.cachedData = null;
  }
}
