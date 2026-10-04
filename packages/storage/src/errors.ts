import { SovraError } from '@sovra/shared';

export class StorageError extends SovraError {
  constructor(message: string, code = 'ERR_STORAGE_FAILURE', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'StorageError';
  }
}

export class ContentNotFoundError extends StorageError {
  constructor(cid: string, context?: Record<string, unknown>) {
    super(`Content with CID '${cid}' not found across providers`, 'ERR_STORAGE_NOT_FOUND', {
      ...context,
      cid,
    });
    this.name = 'ContentNotFoundError';
  }
}

export class IntegrityVerificationError extends StorageError {
  constructor(cid: string, expectedHash: string, actualHash: string) {
    super(
      `Content integrity verification failed for CID '${cid}'`,
      'ERR_STORAGE_INTEGRITY_FAILED',
      {
        cid,
        expectedHash,
        actualHash,
      },
    );
    this.name = 'IntegrityVerificationError';
  }
}

export class PrivateStoragePolicyViolationError extends StorageError {
  constructor(message = 'Attempted to publish unencrypted private data to public storage') {
    super(message, 'ERR_STORAGE_PRIVATE_POLICY_VIOLATION');
    this.name = 'PrivateStoragePolicyViolationError';
  }
}

export class InvalidCidError extends StorageError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_INVALID_CID', context);
    this.name = 'InvalidCidError';
  }
}

export class BlockstoreCapacityError extends StorageError {
  constructor(message = 'Blockstore storage capacity exceeded and all candidate blocks are pinned') {
    super(message, 'ERR_BLOCKSTORE_CAPACITY_EXCEEDED');
    this.name = 'BlockstoreCapacityError';
  }
}

export class DagTraversalError extends StorageError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_DAG_TRAVERSAL_FAILED', context);
    this.name = 'DagTraversalError';
  }
}

export class BitSwapTimeoutError extends StorageError {
  constructor(cid: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(
      `BitSwap query timed out after ${timeoutMs}ms for CID '${cid}'`,
      'ERR_BITSWAP_TIMEOUT',
      { cid, timeoutMs, ...context },
    );
    this.name = 'BitSwapTimeoutError';
  }
}

export class BitSwapProtocolError extends StorageError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_BITSWAP_PROTOCOL_ERROR', context);
    this.name = 'BitSwapProtocolError';
  }
}

export class QuotaExceededError extends StorageError {
  constructor(message = 'Storage capacity quota exceeded', context?: Record<string, unknown>) {
    super(message, 'ERR_STORAGE_QUOTA_EXCEEDED', context);
    this.name = 'QuotaExceededError';
  }
}

export class AuthorQuotaExceededError extends StorageError {
  constructor(authorDid: string, quotaBytes: bigint, context?: Record<string, unknown>) {
    super(
      `Storage quota for author '${authorDid}' exceeded (${quotaBytes.toString()} bytes limit)`,
      'ERR_AUTHOR_QUOTA_EXCEEDED',
      { authorDid, quotaBytes: quotaBytes.toString(), ...context },
    );
    this.name = 'AuthorQuotaExceededError';
  }
}

export class PinNotFoundError extends StorageError {
  constructor(cid: string, context?: Record<string, unknown>) {
    super(`Pin record for CID '${cid}' not found in registry`, 'ERR_PIN_NOT_FOUND', {
      cid,
      ...context,
    });
    this.name = 'PinNotFoundError';
  }
}

