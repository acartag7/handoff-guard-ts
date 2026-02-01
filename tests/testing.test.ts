import { describe, it, expect } from 'vitest';
import { mockRetry, retry } from '../src/index';

describe('mockRetry', () => {
  it('should set retry context', async () => {
    await mockRetry({ attempt: 2, maxAttempts: 3 }, async () => {
      expect(retry.attempt).toBe(2);
      expect(retry.maxAttempts).toBe(3);
      expect(retry.isRetry).toBe(true);
    });

    // After exit, proxy returns defaults
    expect(retry.isRetry).toBe(false);
  });

  it('should support feedback text', async () => {
    await mockRetry(
      { attempt: 3, maxAttempts: 5, feedbackText: 'Fix the output' },
      async () => {
        expect(retry.isRetry).toBe(true);
        expect(retry.attempt).toBe(3);
        expect(retry.maxAttempts).toBe(5);
        const fb = retry.feedback();
        expect(fb).not.toBeNull();
        expect(fb!).toContain('Fix the output');
      },
    );
  });
});
