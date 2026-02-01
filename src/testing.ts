import { runWithRetryStateAsync, type RetryState } from './retry.js';
import type { Diagnostic } from './types.js';

interface MockRetryOptions {
  attempt?: number;
  maxAttempts?: number;
  lastError?: Diagnostic | null;
  feedbackText?: string;
}

export async function mockRetry<T>(
  options: MockRetryOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const { attempt = 2, maxAttempts = 3, feedbackText } = options;

  let lastError = options.lastError ?? null;
  if (!lastError && feedbackText) {
    lastError = {
      type: 'validation',
      message: feedbackText,
    };
  }

  const state: RetryState = {
    attempt,
    maxAttempts,
    remaining: maxAttempts - attempt,
    isRetry: attempt > 1,
    isFinalAttempt: attempt === maxAttempts,
    lastError,
    history: [],
    feedback: () =>
      lastError ? `Mock feedback for: ${lastError.message}` : null,
  };

  return runWithRetryStateAsync(state, fn);
}
