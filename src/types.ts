export interface ViolationContext {
  nodeName: string;
  contractType: 'input' | 'output';
  fieldPath: string;
  expected: string;
  received: string;
  receivedType: string;
  suggestion: string;
}

export interface AttemptRecord {
  attempt: number;
  timestamp: Date;
  durationMs: number;
  diagnostic: Diagnostic | null;
}

export interface Diagnostic {
  type: 'validation' | 'parse';
  message: string;
  field?: string;
  expected?: string;
  received?: string;
  suggestion?: string;
  rawOutput?: string;
}

export function createDiagnostic(data: Diagnostic): Diagnostic {
  return {
    ...data,
    rawOutput: data.rawOutput?.slice(0, 500),
  };
}

export class HandoffViolation extends Error {
  readonly nodeName: string;
  readonly fieldPath: string;
  readonly context: ViolationContext;
  readonly totalAttempts: number;
  readonly history: AttemptRecord[];

  constructor(options: { context: ViolationContext; history?: AttemptRecord[] }) {
    super(
      `Validation failed at '${options.context.nodeName}': ${options.context.expected}`,
    );
    this.name = 'HandoffViolation';
    this.nodeName = options.context.nodeName;
    this.fieldPath = options.context.fieldPath;
    this.context = options.context;
    this.history = options.history ?? [];
    this.totalAttempts = this.history.length || 1;
  }

  toDict(): Record<string, unknown> {
    return {
      nodeName: this.nodeName,
      fieldPath: this.fieldPath,
      context: this.context,
      totalAttempts: this.totalAttempts,
      history: this.history.map((record) => ({
        ...record,
        timestamp: record.timestamp.toISOString(),
      })),
    };
  }
}
