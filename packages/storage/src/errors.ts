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
