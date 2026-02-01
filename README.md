# handoff-guard

TypeScript port of [handoff-guard](https://github.com/acartag7/handoff-guard) (Python). Same API semantics, idiomatic TypeScript implementation.

Validation for LLM agents that retries with feedback.

## Install

```bash
pnpm add handoff-guard
```

## Quick Start

```ts
import { guard, retry, parseJson } from 'handoff-guard';
import { z } from 'zod';

const WriterOutput = z.object({
  draft: z.string().min(100),
  wordCount: z.number().min(50),
  tone: z.string(),
  title: z.string(),
});

const writer = guard({
  output: WriterOutput,
  nodeName: 'writer',
  maxAttempts: 3,
  inputParam: 'state',
})(async (opts: { state: { prompt: string } }) => {
  let prompt = opts.state.prompt;
  if (retry.isRetry) {
    const feedback = retry.feedback();
    if (feedback) {
      prompt += `\n\nYour previous attempt failed:\n${feedback}`;
    }
  }

  const response = '{"draft":"...","wordCount":100,"tone":"neutral","title":"Example"}';
  return parseJson(response);
});

const result = await writer({ state: { prompt: 'Write JSON with draft/wordCount/tone/title.' } });
console.log(result.title);
```

## API

### guard(options)

```ts
type GuardOptions = {
  input?: z.ZodType;
  output?: z.ZodType;
  nodeName?: string;
  maxAttempts?: number;
  retryOn?: ('validation' | 'parse')[];
  onFail?: 'raise' | 'throw' | 'return_none' | 'returnNull' | 'return_input' | 'returnInput' | ((error: HandoffViolation) => unknown);
  inputParam?: string;
};
```

### retry proxy

```ts
import { retry } from 'handoff-guard';

retry.isRetry;
retry.attempt;
retry.maxAttempts;
retry.remaining;
retry.isFinalAttempt;
retry.feedback();
retry.lastError;
retry.history;
```

### parseJson

```ts
import { parseJson } from 'handoff-guard';

const data = parseJson('```json\n{"key":"value"}\n```');
```

### HandoffViolation

```ts
import { HandoffViolation } from 'handoff-guard';

try {
  await writer({ prompt: '...' });
} catch (error) {
  if (error instanceof HandoffViolation) {
    console.log(error.nodeName);
    console.log(error.totalAttempts);
    console.log(error.history);
    console.log(error.toDict());
  }
}
```

## Module Formats

- ESM: `import { guard } from 'handoff-guard'`
- CJS: `const { guard } = require('handoff-guard')`
