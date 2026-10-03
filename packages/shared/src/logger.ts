/**
 * Sanitized Observability Logger Interface
 * Enforces automated redaction of private keys, mnemonics, and sensitive tokens.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
}

const SENSITIVE_KEY_PATTERNS = [
  /privateKey/i,
  /secret/i,
  /seed/i,
  /mnemonic/i,
  /password/i,
  /token/i,
  /credential/i,
];

export function sanitizeContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export class ConsoleLogger implements ILogger {
  constructor(private readonly namespace: string) {}

  debug(message: string, context?: Record<string, unknown>): void {
    const safeCtx = sanitizeContext(context);
    console.debug(`[DEBUG][${this.namespace}] ${message}`, safeCtx ?? '');
  }

  info(message: string, context?: Record<string, unknown>): void {
    const safeCtx = sanitizeContext(context);
    console.info(`[INFO][${this.namespace}] ${message}`, safeCtx ?? '');
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const safeCtx = sanitizeContext(context);
    console.warn(`[WARN][${this.namespace}] ${message}`, safeCtx ?? '');
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const safeCtx = sanitizeContext(context);
    console.error(`[ERROR][${this.namespace}] ${message}`, error, safeCtx ?? '');
  }
}
