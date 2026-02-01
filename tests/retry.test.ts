import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { guard, retry, HandoffViolation, ParseError } from '../src/index';

const SimpleOutput = z.object({
  result: z.string(),
  score: z.number(),
});

describe('no retry default', () => {
  it('should not retry with max_attempts=1', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
    })(async (state: any) => {
      return { result: 'ok' } as any; // Missing 'score'
    });

    await expect(myFunc({ x: 1 })).rejects.toThrow(HandoffViolation);
  });

  it('should propagate ParseError with max_attempts=1', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
    })(async (state: any) => {
      throw new ParseError('bad json', 'not json');
    });

    await expect(myFunc({ x: 1 })).rejects.toThrow(ParseError);
  });
});

describe('retry loop', () => {
  it('should succeed on second attempt', async () => {
    let callCount = 0;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      callCount++;
      if (callCount === 1) {
        return { result: 'ok' } as any; // Missing 'score'
      }
      return { result: 'ok', score: 42 };
    });

    const result = await myFunc({ x: 1 });
    expect(result.score).toBe(42);
    expect(callCount).toBe(2);
  });

  it('should exhaust max attempts and throw', async () => {
    let callCount = 0;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      callCount++;
      return { result: 'ok' } as any; // Always invalid
    });

    await expect(myFunc({ x: 1 })).rejects.toThrow(HandoffViolation);
    expect(callCount).toBe(3);
  });
});

describe('retry proxy', () => {
  it('should be falsy on first attempt', async () => {
    let seenIsRetry: boolean | null = null;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      if (seenIsRetry === null) {
        seenIsRetry = retry.isRetry;
      }
      return { result: 'ok', score: 1 };
    });

    await myFunc({ x: 1 });
    expect(seenIsRetry).toBe(false);
  });

  it('should be truthy on retry', async () => {
    const proxyValues: boolean[] = [];

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      proxyValues.push(retry.isRetry);
      if (retry.isRetry) {
        return { result: 'ok', score: 1 };
      }
      return { result: 'bad' } as any;
    });

    await myFunc({ x: 1 });
    expect(proxyValues[0]).toBe(false);
    expect(proxyValues[1]).toBe(true);
  });

  it('should return feedback text on retry', async () => {
    let feedbackText: string | null = null;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      if (retry.isRetry) {
        feedbackText = retry.feedback();
        return { result: 'ok', score: 1 };
      }
      return { result: 'bad' } as any;
    });

    await myFunc({ x: 1 });
    expect(feedbackText).not.toBeNull();
    expect(
      feedbackText!.toLowerCase().includes('validation') ||
        feedbackText!.toLowerCase().includes('failed'),
    ).toBe(true);
  });

  it('should return null feedback on first attempt', async () => {
    let feedbackText: string | null = 'sentinel';

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      if (!retry.isRetry) {
        feedbackText = retry.feedback();
      }
      return { result: 'ok', score: 1 };
    });

    await myFunc({ x: 1 });
    expect(feedbackText).toBeNull();
  });
});

describe('violation history', () => {
  it('should track history in violation', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      return { result: 'bad' } as any;
    });

    try {
      await myFunc({ x: 1 });
    } catch (e) {
      const exc = e as HandoffViolation;
      expect(exc.history.length).toBe(3);
      for (let i = 0; i < exc.history.length; i++) {
        expect(exc.history[i].attempt).toBe(i + 1);
        expect(exc.history[i].durationMs).toBeDefined();
      }
    }
  });

  it('should set totalAttempts property', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      return { result: 'bad' } as any;
    });

    try {
      await myFunc({ x: 1 });
    } catch (e) {
      expect((e as HandoffViolation).totalAttempts).toBe(2);
    }
  });

  it('should include history in toDict', async () => {
    const myFunc = guard({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      return { result: 'bad' } as any;
    });

    try {
      await myFunc({ x: 1 });
    } catch (e) {
      const d = (e as HandoffViolation).toDict();
      expect(d).toHaveProperty('totalAttempts');
      expect(d.totalAttempts).toBe(2);
      expect(d).toHaveProperty('history');
      expect((d.history as unknown[]).length).toBe(2);
    }
  });
});

describe('parse retry', () => {
  it('should retry on ParseError', async () => {
    let callCount = 0;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      callCount++;
      if (callCount === 1) {
        throw new ParseError('bad json', 'not json');
      }
      return { result: 'ok', score: 1 };
    });

    const result = await myFunc({ x: 1 });
    expect(result.score).toBe(1);
    expect(callCount).toBe(2);
  });

  it('should not retry ParseError when parse excluded from retryOn', async () => {
    const myFunc = guard({
      output: SimpleOutput,
      maxAttempts: 3,
      retryOn: ['validation'],
    })(async (state: any) => {
      throw new ParseError('bad json', 'not json');
    });

    await expect(myFunc({ x: 1 })).rejects.toThrow(ParseError);
  });

  it('should truncate rawOutput in diagnostic to 500 chars', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      throw new ParseError('bad json', 'x'.repeat(2000));
    });

    try {
      await myFunc({ x: 1 });
    } catch (e) {
      const exc = e as HandoffViolation;
      const lastDiag = exc.history[exc.history.length - 1].diagnostic;
      expect(lastDiag).not.toBeNull();
      expect(lastDiag!.rawOutput).toBeDefined();
      expect(lastDiag!.rawOutput!.length).toBeLessThanOrEqual(500);
    }
  });

  it('should not retry non-parse errors', async () => {
    let callCount = 0;

    const myFunc = guard({
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      callCount++;
      throw new Error('missing');
    });

    await expect(myFunc({ x: 1 })).rejects.toThrow(Error);
    expect(callCount).toBe(1);
  });

  it('should keep retry state isolated across concurrent invocations', async () => {
    const outputs: number[] = [];

    const myFunc = guard({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any) => {
      if (!retry.isRetry) {
        throw new ParseError('bad json', JSON.stringify(state));
      }
      outputs.push(retry.attempt);
      return { result: 'ok', score: retry.attempt } as any;
    });

    const [a, b] = (await Promise.all([
      myFunc({ x: 1 }),
      myFunc({ x: 2 }),
    ])) as Array<{ result: string; score: number }>;

    expect(a.score).toBe(2);
    expect(b.score).toBe(2);
    expect(outputs).toEqual([2, 2]);
  });

  it('should inject retry as second arg when provided', async () => {
    const myFunc = guard<[{ x: number }, { attempt: number } | undefined], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (state: any, retryState?: { attempt: number }) => {
      if (!retryState || retryState.attempt === 1) {
        return { result: 'bad' } as any;
      }
      return { result: 'ok', score: retryState.attempt } as any;
    });

    const result = await myFunc({ x: 1 }, undefined);
    expect(result.score).toBe(2);
  });

  it('should inject retry into options object when retry is undefined', async () => {
    const myFunc = guard<[{ x: number; retry?: { attempt: number } }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (opts) => {
      if (!opts.retry || opts.retry.attempt === 1) {
        return { result: 'bad' } as any;
      }
      return { result: 'ok', score: opts.retry.attempt } as any;
    });

    const result = await myFunc({ x: 1, retry: undefined });
    expect(result.score).toBe(2);
  });

  it('should not inject retry into options object when missing', async () => {
    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 2,
    })(async (opts) => {
      if ('retry' in opts) {
        throw new Error('retry should not be injected');
      }
      return { result: 'ok', score: 1 };
    });

    const result = await myFunc({ x: 1 });
    expect(result.score).toBe(1);
  });
});

describe('on_fail after retry', () => {
  it('should return null after retry exhaustion with return_none', async () => {
    const myFunc = guard({
      output: SimpleOutput,
      maxAttempts: 2,
      onFail: 'return_none',
    })(async (state: any) => {
      return { result: 'bad' } as any;
    });

    const result = await myFunc({ x: 1 });
    expect(result).toBeNull();
  });
});

describe('input validation no retry', () => {
  it('should not retry on input validation failure', async () => {
    const StrictInput = z.object({
      name: z.string(),
      value: z.number(),
    });

    let callCount = 0;

    const myFunc = guard({
      input: StrictInput,
      output: SimpleOutput,
      maxAttempts: 3,
    })(async (state: any) => {
      callCount++;
      return { result: 'ok', score: 1 };
    });

    await expect(myFunc({ name: 'test' } as any)).rejects.toThrow(
      HandoffViolation,
    );
    expect(callCount).toBe(0); // Function never called
  });
});

describe('retry on validation only', () => {
  it('should retry only on validation errors', async () => {
    let callCount = 0;

    const myFunc = guard<[{ x: number }], { result: string; score: number }>({
      output: SimpleOutput,
      maxAttempts: 3,
      retryOn: ['validation'],
    })(async (state: any) => {
      callCount++;
      if (callCount < 3) {
        return { result: 'bad' } as any;
      }
      return { result: 'ok', score: 1 };
    });

    const result = await myFunc({ x: 1 });
    expect(result.score).toBe(1);
    expect(callCount).toBe(3);
  });
});
