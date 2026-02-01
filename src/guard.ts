import { z } from 'zod';
import {
  HandoffViolation,
  createDiagnostic,
  type ViolationContext,
  type Diagnostic,
  type AttemptRecord,
} from './types.js';
import { ParseError } from './utils.js';
import { runWithRetryStateAsync, type RetryState } from './retry.js';

type OnFailAction =
  | 'raise'
  | 'throw'
  | 'return_none'
  | 'returnNull'
  | 'return_input'
  | 'returnInput';

export interface GuardOptions {
  input?: z.ZodType;
  output?: z.ZodType;
  nodeName?: string;
  maxAttempts?: number;
  retryOn?: ('validation' | 'parse')[];
  onFail?: OnFailAction | ((error: HandoffViolation) => unknown);
  inputParam?: string;
}

export type GuardOnFailAction = OnFailAction;

export function guard<TArgs extends unknown[], TReturn>(
  options: GuardOptions,
): (fn: (...args: TArgs) => Promise<TReturn>) => (...args: TArgs) => Promise<TReturn> {
  const {
    input: inputSchema,
    output: outputSchema,
    nodeName,
    maxAttempts = 1,
    retryOn = ['validation', 'parse'],
    onFail = 'raise',
    inputParam,
  } = options;

  return function (
    fn: (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    const resolvedNodeName = nodeName ?? fn.name ?? 'anonymous';

    return async function guarded(this: unknown, ...args: TArgs): Promise<TReturn> {
      const inputData = resolveInputData(args, inputParam);

      // Validate input (no retry on input errors)
      if (inputSchema) {
        const inputResult = inputSchema.safeParse(inputData);
        if (!inputResult.success) {
          const firstError = inputResult.error.issues[0];
          const violation = new HandoffViolation({
            context: {
              nodeName: resolvedNodeName,
              contractType: 'input',
              fieldPath: firstError.path.join('.') || 'root',
              expected: firstError.message,
              received:
                JSON.stringify(inputData)?.slice(0, 200) ?? 'undefined',
              receivedType: typeof inputData,
              suggestion: generateSuggestion(firstError),
            },
          });
          return handleFailure(violation, inputData, onFail) as TReturn;
        }
      }

      // Retry loop
      const history: AttemptRecord[] = [];
      let lastError: Diagnostic | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const startTime = Date.now();

        const state: RetryState = {
          attempt,
          maxAttempts,
          remaining: maxAttempts - attempt,
          isRetry: attempt > 1,
          isFinalAttempt: attempt === maxAttempts,
          lastError,
          history: [...history],
          feedback: () => formatFeedback(lastError),
        };

        try {
          const context = this;
          const result = await runWithRetryStateAsync(state, () =>
            fn.apply(context, buildCallArgs(args, state) as TArgs),
          );

          // Validate output
          if (outputSchema) {
            const outputResult = outputSchema.safeParse(result);
            if (!outputResult.success) {
              const firstError = outputResult.error.issues[0];
              const diagnostic = createDiagnostic({
                type: 'validation',
                message: firstError.message,
                field: firstError.path.join('.') || 'root',
                expected: firstError.message,
                received: JSON.stringify(result)?.slice(0, 200),
                suggestion: generateSuggestion(firstError),
              });

              history.push({
                attempt,
                timestamp: new Date(),
                durationMs: Date.now() - startTime,
                diagnostic,
              });

              lastError = diagnostic;

              if (attempt < maxAttempts && retryOn.includes('validation')) {
                continue;
              }

              const violation = new HandoffViolation({
                context: {
                  nodeName: resolvedNodeName,
                  contractType: 'output',
                  fieldPath: firstError.path.join('.') || 'root',
                  expected: firstError.message,
                  received:
                    JSON.stringify(result)?.slice(0, 200) ?? 'undefined',
                  receivedType: typeof result,
                  suggestion: generateSuggestion(firstError),
                },
                history,
              });
              return handleFailure(violation, inputData, onFail) as TReturn;
            }
          }

          // Success
          history.push({
            attempt,
            timestamp: new Date(),
            durationMs: Date.now() - startTime,
            diagnostic: null,
          });

          return result;
        } catch (error) {
          const durationMs = Date.now() - startTime;

          if (error instanceof ParseError) {
            const diagnostic = createDiagnostic({
              type: 'parse',
              message: error.message,
              rawOutput: error.rawOutput,
              suggestion: 'Return valid JSON',
            });

            history.push({
              attempt,
              timestamp: new Date(),
              durationMs,
              diagnostic,
            });

            lastError = diagnostic;

            if (attempt < maxAttempts && retryOn.includes('parse')) {
              continue;
            }

            // Propagate ParseError as-is when not retryable
            if (maxAttempts === 1 || !retryOn.includes('parse')) {
              throw error;
            }

            const violation = new HandoffViolation({
              context: {
                nodeName: resolvedNodeName,
                contractType: 'output',
                fieldPath: 'root',
                expected: 'Valid JSON',
                received: error.rawOutput.slice(0, 200),
                receivedType: 'string',
                suggestion: 'Return valid JSON',
              },
              history,
            });
            return handleFailure(violation, inputData, onFail) as TReturn;
          }

          // Re-throw other errors immediately
          throw error;
        }
      }

      throw new Error('Unexpected end of retry loop');
    };
  };
}

function resolveInputData<TArgs extends unknown[]>(
  args: TArgs,
  inputParam: string | undefined,
): unknown {
  if (args.length === 0) return undefined;
  const firstArg = args[0];
  if (!inputParam) return firstArg;
  if (
    firstArg &&
    typeof firstArg === 'object' &&
    !Array.isArray(firstArg) &&
    inputParam in (firstArg as Record<string, unknown>)
  ) {
    return (firstArg as Record<string, unknown>)[inputParam];
  }
  return firstArg;
}

function buildCallArgs<TArgs extends unknown[]>(
  args: TArgs,
  state: RetryState,
): unknown[] {
  if (args.length >= 2) {
    if (args[1] === undefined) {
      const nextArgs = [...args];
      nextArgs[1] = state;
      return nextArgs;
    }
    return [...args];
  }

  if (args.length >= 1) {
    const firstArg = args[0];
    if (
      firstArg &&
      typeof firstArg === 'object' &&
      !Array.isArray(firstArg)
    ) {
      const asRecord = firstArg as Record<string, unknown>;
      if ('retry' in asRecord && asRecord.retry === undefined) {
        return [{ ...asRecord, retry: state }, ...args.slice(1)];
      }
    }
  }

  return [...args, state];
}

function handleFailure(
  violation: HandoffViolation,
  inputData: unknown,
  onFail: OnFailAction | ((error: HandoffViolation) => unknown),
): unknown {
  if (onFail === 'raise' || onFail === 'throw') {
    throw violation;
  }
  if (onFail === 'return_none' || onFail === 'returnNull') {
    return null;
  }
  if (onFail === 'return_input' || onFail === 'returnInput') {
    return inputData;
  }
  if (typeof onFail === 'function') {
    return onFail(violation);
  }
  throw violation;
}

function formatFeedback(diagnostic: Diagnostic | null): string | null {
  if (!diagnostic) return null;

  const lines = [`[Retry] Previous attempt failed (${diagnostic.type}):`];
  lines.push(`  Message: ${diagnostic.message}`);
  if (diagnostic.field) lines.push(`  Field: ${diagnostic.field}`);
  if (diagnostic.suggestion) lines.push(`  Suggestion: ${diagnostic.suggestion}`);
  if (diagnostic.rawOutput) {
    lines.push(`  Raw output: ${diagnostic.rawOutput.slice(0, 200)}`);
  }
  return lines.join('\n');
}

function generateSuggestion(error: z.core.$ZodIssueBase): string {
  const field = error.path.join('.') || 'value';

  switch (error.code) {
    case 'too_small':
      return `Increase the length/value of '${field}'`;
    case 'too_big':
      return `Decrease the length/value of '${field}'`;
    case 'invalid_type': {
      const received = error.message.match(/received (\w+)/)?.[1];
      const typed = error as z.core.$ZodIssueInvalidType;
      return received
        ? `'${field}' should be ${typed.expected}, got ${received}`
        : `'${field}' should be ${typed.expected}`;
    }
    case 'invalid_value':
      return `'${field}' must be one of: ${(error as z.core.$ZodIssueInvalidValue).values?.join(', ')}`;
    default:
      return `Fix '${field}': ${error.message}`;
  }
}
