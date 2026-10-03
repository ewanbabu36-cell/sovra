/**
 * Core Shared Types for Sovra
 */

export type Nullable<T> = T | null;

export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface Disposable {
  dispose(): void | Promise<void>;
}
