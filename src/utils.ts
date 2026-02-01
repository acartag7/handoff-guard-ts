export class ParseError extends Error {
  readonly rawOutput: string;

  constructor(message: string, rawOutput: string = '') {
    super(message);
    this.name = 'ParseError';
    this.rawOutput = rawOutput;
  }
}

export function parseJson<T = unknown>(input: unknown): T {
  if (typeof input !== 'string') {
    throw new ParseError(
      `Expected string, got ${typeof input}`,
      String(input).slice(0, 500),
    );
  }

  let text = input;

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Strip markdown code fences
  const stripped = text.trim();
  if (stripped.startsWith('```')) {
    const lines = stripped.split('\n', 1);
    let body = stripped.slice(lines[0].length + 1);
    if (body.trimEnd().endsWith('```')) {
      body = body.trimEnd().slice(0, -3);
    }
    text = body.trim();
  } else {
    text = stripped;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    throw new ParseError(message, input);
  }
}
