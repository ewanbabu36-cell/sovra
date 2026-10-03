import { SecurityError } from '@sovra/shared';

export class MessagingError extends SecurityError {
  constructor(message: string, code = 'ERR_MESSAGING_FAILURE', context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'MessagingError';
  }
}

export class SessionEstablishmentError extends MessagingError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'ERR_MESSAGING_SESSION_ESTABLISHMENT_FAILED', context);
    this.name = 'SessionEstablishmentError';
  }
}

export class DecryptionError extends MessagingError {
  constructor(
    message = 'Message payload could not be decrypted',
    context?: Record<string, unknown>,
  ) {
    super(message, 'ERR_MESSAGING_DECRYPTION_FAILED', context);
    this.name = 'DecryptionError';
  }
}

export class OutdatedPreKeyBundleError extends MessagingError {
  constructor(peerDid: string) {
    super(
      `Pre-key bundle for peer '${peerDid}' is stale or exhausted`,
      'ERR_MESSAGING_STALE_PREKEY',
      { peerDid },
    );
    this.name = 'OutdatedPreKeyBundleError';
  }
}
