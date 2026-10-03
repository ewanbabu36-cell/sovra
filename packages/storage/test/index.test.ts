import { describe, it, expect } from 'vitest';
import {
  ContentNotFoundError,
  IntegrityVerificationError,
  PrivateStoragePolicyViolationError,
} from '../src/index.js';

describe('@sovra/storage', () => {
  it('instantiates ContentNotFoundError with valid context', () => {
    const error = new ContentNotFoundError('bafybeic5test');
    expect(error.code).toBe('ERR_STORAGE_NOT_FOUND');
    expect(error.context).toEqual({ cid: 'bafybeic5test' });
  });

  it('instantiates IntegrityVerificationError with hash comparison', () => {
    const error = new IntegrityVerificationError('bafybeic5test', 'expected123', 'actual456');
    expect(error.code).toBe('ERR_STORAGE_INTEGRITY_FAILED');
    expect(error.context).toEqual({
      cid: 'bafybeic5test',
      expectedHash: 'expected123',
      actualHash: 'actual456',
    });
  });

  it('instantiates PrivateStoragePolicyViolationError protecting privacy', () => {
    const error = new PrivateStoragePolicyViolationError();
    expect(error.code).toBe('ERR_STORAGE_PRIVATE_POLICY_VIOLATION');
    expect(error.message).toContain('unencrypted private data');
  });
});
