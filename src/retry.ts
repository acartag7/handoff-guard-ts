import { AsyncLocalStorage } from 'node:async_hooks';
import type { Diagnostic, AttemptRecord } from './types.js';

export type { Diagnostic, AttemptRecord };

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  remaining: number;
  isRetry: boolean;
  isFinalAttempt: boolean;
  lastError: Diagnostic | null;
  history: AttemptRecord[];
  feedback: () => string | null;
}

const retryStorage = new AsyncLocalStorage<RetryState>();

function getDefaultState(): RetryState {
  return {
    attempt: 1,
    maxAttempts: 1,
    remaining: 0,
    isRetry: false,
    isFinalAttempt: true,
    lastError: null,
    history: [],
    feedback: () => null,
  };
}

export const retry: RetryState = new Proxy({} as RetryState, {
  get(_target, prop: string) {
    const state = retryStorage.getStore();
    if (!state) {
      const defaults = getDefaultState();
      return defaults[prop as keyof RetryState];
    }
    return state[prop as keyof RetryState];
  },
});

export function runWithRetryState<T>(state: RetryState, fn: () => T): T {
  return retryStorage.run(state, fn);
}

export function runWithRetryStateAsync<T>(
  state: RetryState,
  fn: () => Promise<T>,
): Promise<T> {
  return retryStorage.run(state, fn);
}
