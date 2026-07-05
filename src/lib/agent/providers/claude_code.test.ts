import { describe, expect, it } from 'vitest';
import { extractApprovalParts, is1mCreditError, splitCompound, claudeCodeProvider } from './claude_code';
import { clampContext } from './index';

describe('extractApprovalParts', () => {
  it('parses the CLI phrase and returns each named sub-command', () => {
    const err = 'This Bash command contains multiple operations. The following parts require approval: cat FOO, echo BAR';
    expect(extractApprovalParts(err)).toEqual(['cat FOO', 'echo BAR']);
  });

  it('handles the plural verb "these parts require approval"', () => {
    const err = 'These parts require approval: rm -rf FOO, ls';
    expect(extractApprovalParts(err)).toEqual(['rm -rf FOO', 'ls']);
  });

  it('returns [] when the phrase is missing', () => {
    expect(extractApprovalParts('some other error')).toEqual([]);
  });
});

describe('splitCompound', () => {
  it('splits on top-level && and ||', () => {
    expect(splitCompound('cat FOO && echo BAR || true')).toEqual(['cat FOO', 'echo BAR', 'true']);
  });

  it('splits on ; and |', () => {
    expect(splitCompound('ls; cat FOO | grep bar')).toEqual(['ls', 'cat FOO', 'grep bar']);
  });

  it('leaves operators inside single/double quotes alone', () => {
    expect(splitCompound(`echo "a && b" && echo 'c ; d'`))
      .toEqual([`echo "a && b"`, `echo 'c ; d'`]);
  });

  it('respects backslash escapes', () => {
    expect(splitCompound('echo hello\\ world && ls')).toEqual(['echo hello\\ world', 'ls']);
  });

  it('returns a single entry for a non-compound command', () => {
    expect(splitCompound('cat FOO')).toEqual(['cat FOO']);
  });
});

describe('is1mCreditError', () => {
  it('matches the CLI credit-required message', () => {
    expect(is1mCreditError('API Error: Usage credits required for 1M context · turn on usage credits')).toBe(true);
  });
  it('matches the "switch to standard context" phrasing', () => {
    expect(is1mCreditError('use --model to switch to standard context')).toBe(true);
  });
  it('is false for unrelated errors and empty text', () => {
    expect(is1mCreditError('some other error')).toBe(false);
    expect(is1mCreditError('')).toBe(false);
  });
});

describe('claude_code 1M context gating', () => {
  it('exposes only the standard window for Opus', () => {
    const opus = claudeCodeProvider.models().find((m) => m.id === 'claude-opus-4-8');
    expect(opus?.contextOptions?.map((o) => o.id)).toEqual(['standard']);
  });
  it('offers standard + 1M for Sonnet', () => {
    const sonnet = claudeCodeProvider.models().find((m) => m.id === 'claude-sonnet-4-6');
    expect(sonnet?.contextOptions?.map((o) => o.id)).toEqual(['standard', '1m']);
  });
  it('clamps a 1M pick on a standard-only model down to standard', () => {
    expect(clampContext('claude_code', 'claude-opus-4-8', '1m')).toBe('standard');
    expect(clampContext('claude_code', 'claude-sonnet-4-6', '1m')).toBe('1m');
    expect(clampContext('claude_code', 'claude-haiku-4-5', '1m')).toBe('standard');
  });
});
