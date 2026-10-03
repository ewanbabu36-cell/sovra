import { Result, ok } from '@sovra/shared';
import { SovraEvent } from '@sovra/protocol';

export interface SearchQuery {
  readonly query: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface SearchResult {
  readonly events: readonly SovraEvent[];
  readonly totalMatches: number;
}

export class SearchWorker {
  public async search(_query: SearchQuery): Promise<Result<SearchResult>> {
    return ok({
      events: [],
      totalMatches: 0,
    });
  }
}
