import { describe, it, expect } from 'vitest';
import { truncateForModel, isAbortError, isRetryableError, MODEL_TOOL_RESULT_CAP } from './agentUtils';

describe('truncateForModel', () => {
  it('passes through content under the cap unchanged', () => {
    const s = 'x'.repeat(100);
    expect(truncateForModel(s)).toBe(s);
  });

  it('truncates content over the cap and keeps head + tail', () => {
    const big = 'A'.repeat(20000) + 'B'.repeat(20000);
    const out = truncateForModel(big);
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('chars elided');
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('B')).toBe(true);
  });

  it('respects a custom limit', () => {
    const out = truncateForModel('y'.repeat(1000), 100);
    expect(out).toContain('chars elided');
    // head (70) + tail (30) + marker — comfortably under the original 1000.
    expect(out.length).toBeLessThan(300);
  });

  it('exposes a sane default cap', () => {
    expect(MODEL_TOOL_RESULT_CAP).toBeGreaterThan(1000);
  });
});

describe('isAbortError', () => {
  it('detects DOMException AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
  });

  it('detects a named Error', () => {
    const e = new Error('stopped');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
  });

  it('is false for ordinary errors', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('never retries an abort', () => {
    expect(isRetryableError(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });

  it('retries 429 and 5xx status codes', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
  });

  it('does not retry 4xx (other than 429)', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it('retries transient network messages', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableError(new Error('model overloaded'))).toBe(true);
  });

  it('does not retry an unrelated error', () => {
    expect(isRetryableError(new Error('invalid request payload'))).toBe(false);
  });
});
