import { describe, it, expect } from 'vitest';
import { parseJson, ParseError } from '../src/index';

describe('parseJson', () => {
  it('should parse valid JSON', () => {
    const result = parseJson('{"key": "value", "num": 42}');
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('should strip markdown code fences', () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = parseJson(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('should throw ParseError on invalid JSON', () => {
    expect(() => parseJson('not json at all')).toThrow(ParseError);
    try {
      parseJson('not json at all');
    } catch (e) {
      expect((e as ParseError).rawOutput).toBeDefined();
    }
  });

  it('should throw ParseError on non-string input', () => {
    expect(() => parseJson(12345)).toThrow(ParseError);
  });

  it('should strip BOM', () => {
    const text = '\ufeff{"key": "value"}';
    const result = parseJson(text);
    expect(result).toEqual({ key: 'value' });
  });
});
