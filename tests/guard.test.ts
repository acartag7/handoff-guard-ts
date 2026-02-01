import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { guard, HandoffViolation } from '../src/index';

const SimpleInput = z.object({
  name: z.string(),
  value: z.number(),
});

const SimpleOutput = z.object({
  result: z.string(),
  processed: z.boolean(),
});

describe('guard decorator', () => {
  it('should pass with valid input and output', async () => {
    const myFunc = guard<[{ name: string; value: number }], { result: string; processed: boolean }>({
      input: SimpleInput,
      output: SimpleOutput,
    })(async (state) => {
      return { result: `Hello ${state.name}`, processed: true };
    });

    const result = await myFunc({ name: 'World', value: 42 });
    expect(result.result).toBe('Hello World');
    expect(result.processed).toBe(true);
  });

  it('should raise HandoffViolation on invalid input', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      nodeName: 'myFunc',
    })(async (state: any) => {
      return { result: 'ok', processed: true };
    });

    await expect(myFunc({ name: 'Test' } as any)).rejects.toThrow(
      HandoffViolation,
    );

    try {
      await myFunc({ name: 'Test' } as any);
    } catch (e) {
      const v = e as HandoffViolation;
      expect(v.nodeName).toBe('myFunc');
      expect(v.fieldPath).toContain('value');
    }
  });

  it('should raise HandoffViolation on invalid output', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      nodeName: 'myFunc',
    })(async (state: any) => {
      return { result: 'ok' } as any; // Missing 'processed'
    });

    await expect(myFunc({ name: 'Test', value: 1 })).rejects.toThrow(
      HandoffViolation,
    );

    try {
      await myFunc({ name: 'Test', value: 1 });
    } catch (e) {
      const v = e as HandoffViolation;
      expect(v.nodeName).toBe('myFunc');
      expect(v.fieldPath).toContain('processed');
    }
  });

  it('should return null on failure with on_fail return_none', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'return_none',
    })(async (state: any) => {
      return { result: 'ok' } as any;
    });

    const result = await myFunc({ name: 'Test', value: 1 });
    expect(result).toBeNull();
  });

  it('should return null on failure with on_fail returnNull', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'returnNull',
    })(async (state: any) => {
      return { result: 'ok' } as any;
    });

    const result = await myFunc({ name: 'Test', value: 1 });
    expect(result).toBeNull();
  });

  it('should return input on failure with on_fail return_input', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'return_input',
    })(async (state: any) => {
      return { result: 'ok' } as any;
    });

    const inputData = { name: 'Test', value: 1 };
    const result = await myFunc(inputData);
    expect(result).toEqual(inputData);
  });

  it('should return input on failure with on_fail returnInput', async () => {
    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'returnInput',
    })(async (state: any) => {
      return { result: 'ok' } as any;
    });

    const inputData = { name: 'Test', value: 1 };
    const result = await myFunc(inputData);
    expect(result).toEqual(inputData);
  });

  it('should return input when input provided as options object', async () => {
    const myFunc = guard<[{ state: { name: string; value: number } }], { result: string; processed: boolean }>({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'return_input',
      inputParam: 'state',
    })(async (opts) => {
      return { result: 'ok' } as any;
    });

    const inputData = { name: 'Test', value: 1 };
    const result = await myFunc({ state: inputData });
    expect(result).toEqual(inputData);
  });

  it('should not unwrap state when inputParam is not set', async () => {
    const myFunc = guard<[{ state: { name: string; value: number } }], { result: string; processed: boolean }>({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: 'return_input',
    })(async (opts) => {
      return { result: 'ok' } as any;
    });

    const inputData = { name: 'Test', value: 1 };
    const result = await myFunc({ state: inputData } as any);
    expect(result).toEqual({ state: inputData });
  });

  it('should call custom handler on failure', async () => {
    const fallback = { result: 'fallback', processed: false };

    const myFunc = guard({
      input: SimpleInput,
      output: SimpleOutput,
      onFail: () => fallback,
    })(async (state: any) => {
      return { result: 'ok' } as any;
    });

    const result = await myFunc({ name: 'Test', value: 1 });
    expect(result).toEqual(fallback);
  });

  it('should use custom node name in violations', async () => {
    const myFunc = guard({
      input: SimpleInput,
      nodeName: 'custom_name',
    })(async (state: any) => {
      return state;
    });

    await expect(myFunc({ name: 'Test' } as any)).rejects.toThrow(
      HandoffViolation,
    );

    try {
      await myFunc({ name: 'Test' } as any);
    } catch (e) {
      expect((e as HandoffViolation).nodeName).toBe('custom_name');
    }
  });

  it('should work with output validation only', async () => {
    const myFunc = guard({
      output: SimpleOutput,
    })(async (state: any) => {
      return { result: 'ok' } as any; // Missing 'processed'
    });

    await expect(myFunc({ anything: 'goes' })).rejects.toThrow(
      HandoffViolation,
    );
  });

  it('should work with input validation only', async () => {
    const myFunc = guard({
      input: SimpleInput,
    })(async (state: any) => {
      return { anything: 'goes' };
    });

    // Valid input should pass
    const result = await myFunc({ name: 'Test', value: 1 });
    expect(result).toEqual({ anything: 'goes' });

    // Invalid input should fail
    await expect(myFunc({ name: 'Test' } as any)).rejects.toThrow(
      HandoffViolation,
    );
  });

  it('should include suggestion in violation context', async () => {
    const myFunc = guard({
      input: SimpleInput,
    })(async (state: any) => {
      return state;
    });

    try {
      await myFunc({ name: 'Test' } as any);
    } catch (e) {
      expect((e as HandoffViolation).context.suggestion).toBeDefined();
    }
  });

  it('should serialize violation to dict', async () => {
    const myFunc = guard({
      input: SimpleInput,
    })(async (state: any) => {
      return state;
    });

    try {
      await myFunc({ name: 'Test' } as any);
    } catch (e) {
      const d = (e as HandoffViolation).toDict();
      expect(d).toHaveProperty('nodeName');
      expect(d).toHaveProperty('fieldPath');
    }
  });
});
