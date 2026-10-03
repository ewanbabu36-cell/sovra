import { SecurityError } from '@sovra/shared';

export class CryptoError extends SecurityError {
  constructor(message: string, code = 'ERR_CRYPTO_FAILURE', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'CryptoError';
  }
}

export class InvalidSignatureError extends CryptoError {
  constructor(
    message = 'Cryptographic signature verification failed',
    context?: Record<string, unknown>,
  ) {
    super(message, 'ERR_CRYPTO_INVALID_SIGNATURE', context);
    this.name = 'InvalidSignatureError';
  }
}

export class KeyGenerationError extends CryptoError {
  constructor(
    message = 'Cryptographic keypair generation failed',
    context?: Record<string, unknown>,
  ) {
    super(message, 'ERR_CRYPTO_KEYGEN_FAILED', context);
    this.name = 'KeyGenerationError';
  }
}
