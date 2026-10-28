import { describe, it, expect } from 'vitest';
import { sanitizePromptInput } from '../../api/lib/prompt-sanitizer.js';

describe('prompt-sanitizer', () => {
  it('strips HTML tags', () => {
    expect(sanitizePromptInput('<b>hello</b>')).toBe('hello');
  });

  it('strips code blocks', () => {
    const input = 'before ```code``` after';
    expect(sanitizePromptInput(input)).toBe('before  after');
  });

  it('limits length to 2000 chars by default', () => {
    const long = 'a'.repeat(3000);
    expect(sanitizePromptInput(long).length).toBeLessThanOrEqual(2000);
  });

  it('respects custom maxLength', () => {
    const long = 'a'.repeat(500);
    expect(sanitizePromptInput(long, 100).length).toBeLessThanOrEqual(100);
  });

  it('handles null input', () => {
    expect(sanitizePromptInput(null)).toBe('');
  });

  it('handles undefined input', () => {
    expect(sanitizePromptInput(undefined)).toBe('');
  });

  it('handles numeric input', () => {
    expect(sanitizePromptInput(123)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizePromptInput('  hello  ')).toBe('hello');
  });

  it('returns empty for empty input', () => {
    expect(sanitizePromptInput('')).toBe('');
  });

  it('strips JSON-like injections', () => {
    expect(sanitizePromptInput('test {"role":"system"} end')).toBe('test  end');
  });

  it('strips backslashes', () => {
    expect(sanitizePromptInput('hello\\nworld')).toBe('hellonworld');
  });

  it('strips control characters', () => {
    expect(sanitizePromptInput('hello\x00world')).toBe('helloworld');
  });
});
