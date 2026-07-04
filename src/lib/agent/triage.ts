// ─── Error triage detection ──────────────────────────────────────────────────
// Detect failing commands and stack traces in tool output / terminal buffers
// so the IDE can surface a structured error card with a one-click "Diagnose"
// handoff to the agent. Pure and dependency-free (unit-tested in node).

export interface TriageHit {
  kind: 'exit_code' | 'stack_trace';
  exitCode: number | null;
  /** Best-effort language/runtime guess for the card label. */
  flavor: string | null;
}

/** Tool results end with `[exit N]` (see tools.ts run_command formatting). */
const EXIT_RE = /\[exit (\d+)\]\s*$/;

const STACK_PATTERNS: Array<[RegExp, string]> = [
  [/Traceback \(most recent call last\):/, 'python'],
  [/^\s*File ".+", line \d+, in /m, 'python'],
  [/(?:^|\n)\s*at .+ \(.+:\d+:\d+\)/, 'node'],
  [/(?:Unhandled|Uncaught) (?:exception|error|promise rejection)/i, 'node'],
  [/thread '.+' panicked at/, 'rust'],
  [/^error\[E\d+\]:/m, 'rust'],
  [/Exception in thread ".+" [\w.]+(?:Exception|Error)/, 'java'],
  [/^\s+at [\w.$]+\([\w.]+\.java:\d+\)/m, 'java'],
  [/panic: .+\n\ngoroutine \d+/, 'go'],
  [/Segmentation fault|core dumped/i, 'native'],
];

/**
 * Inspect a run_command tool result (or a terminal tail). Returns a hit when
 * the command failed (nonzero exit) or the output contains a recognizable
 * stack trace — nonzero exit wins as the primary signal.
 */
export function detectFailure(output: string): TriageHit | null {
  const exit = output.match(EXIT_RE);
  const exitCode = exit ? Number(exit[1]) : null;

  let flavor: string | null = null;
  for (const [re, name] of STACK_PATTERNS) {
    if (re.test(output)) { flavor = name; break; }
  }

  if (exitCode !== null && exitCode !== 0) {
    return { kind: 'exit_code', exitCode, flavor };
  }
  if (flavor) {
    return { kind: 'stack_trace', exitCode: null, flavor };
  }
  return null;
}

/** Trim a failure's output for the diagnose prompt: keep the informative tail. */
export function failureTail(output: string, maxChars = 3000): string {
  if (output.length <= maxChars) return output;
  return `…${output.slice(-maxChars)}`;
}
