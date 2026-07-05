import { describe, expect, it } from 'vitest';
import { detectFailure, failureTail } from './triage';

describe('detectFailure', () => {
  it('flags nonzero exit codes (tool-result format)', () => {
    const hit = detectFailure('some output\n[exit 1]');
    expect(hit).toEqual({ kind: 'exit_code', exitCode: 1, flavor: null });
  });

  it('ignores clean exits without traces', () => {
    expect(detectFailure('all good\n[exit 0]')).toBeNull();
    expect(detectFailure('plain output, no exit marker')).toBeNull();
  });

  it('detects python tracebacks (even with exit 0 wrapper absent)', () => {
    const out = 'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\nZeroDivisionError: division by zero';
    const hit = detectFailure(out);
    expect(hit?.kind).toBe('stack_trace');
    expect(hit?.flavor).toBe('python');
  });

  it('detects node, rust, java, and go signatures with flavor', () => {
    expect(detectFailure("thread 'main' panicked at src/main.rs:2:5\n[exit 101]")).toEqual({
      kind: 'exit_code', exitCode: 101, flavor: 'rust',
    });
    expect(detectFailure('    at doWork (src/app.js:10:5)')?.flavor).toBe('node');
    expect(detectFailure('Exception in thread "main" java.lang.NullPointerException')?.flavor).toBe('java');
    expect(detectFailure('panic: boom\n\ngoroutine 1 [running]:')?.flavor).toBe('go');
  });

  it('nonzero exit wins as the primary signal over trace-only', () => {
    const hit = detectFailure('error[E0308]: mismatched types\n[exit 1]');
    expect(hit?.kind).toBe('exit_code');
    expect(hit?.flavor).toBe('rust');
  });
});

describe('failureTail', () => {
  it('keeps short output intact and trims long output to the tail', () => {
    expect(failureTail('short')).toBe('short');
    const long = 'x'.repeat(5000) + 'THE END';
    const tail = failureTail(long, 100);
    expect(tail.length).toBeLessThanOrEqual(101);
    expect(tail.endsWith('THE END')).toBe(true);
    expect(tail.startsWith('…')).toBe(true);
  });
});
