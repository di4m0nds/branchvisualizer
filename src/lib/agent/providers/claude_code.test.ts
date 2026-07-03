import { describe, expect, it } from 'vitest';
import { extractApprovalParts, splitCompound } from './claude_code';

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
