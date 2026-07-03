import type { ProbeState } from './transport';

// Presentation helpers shared by the model picker (chat strip) and the settings
// providers panel. Kept in a non-component module so exporting them doesn't trip
// react-refresh's "only export components" rule.

/** How each provider authenticates — surfaced as a badge + blurb so the two
 *  Claude providers ("Claude" = direct API key vs "Claude Code" = local CLI on a
 *  subscription) and Antigravity (local Python SDK) are unmistakable. Providers
 *  not listed here fall back to their `description`. */
export const AUTH_KIND: Record<string, { badge: string; blurb: string; tone: string }> = {
  anthropic: {
    badge: 'API KEY',
    blurb: 'Direct Anthropic API · needs ANTHROPIC_API_KEY',
    tone: 'text-sky-400 border-sky-400/40 bg-sky-400/10',
  },
  claude_code: {
    badge: 'SUBSCRIPTION',
    blurb: 'Local `claude` CLI · OAuth / Claude Code plan',
    tone: 'text-violet-400 border-violet-400/40 bg-violet-400/10',
  },
  antigravity: {
    badge: 'PYTHON SDK',
    blurb: 'Google Antigravity SDK · Gemini agents via local Python',
    tone: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
  },
};

export function stateColor(s: ProbeState): string {
  if (s === 'connected') return 'bg-green-400';
  if (s === 'detected') return 'bg-amber-400';
  return 'bg-muted-foreground/40';
}

export function tierColor(t?: string): string {
  if (t === 'paid') return 'text-blue-400 border-blue-400/40 bg-blue-400/10';
  if (t === 'free') return 'text-green-400 border-green-400/40 bg-green-400/10';
  return 'text-muted-foreground border-border bg-muted/20';
}

export function stateLabel(s: ProbeState): string {
  return s === 'connected' ? 'connected' : s === 'detected' ? 'detected' : 'not detected';
}

/** Compact chip label for a raw model id — strip the `claude-` prefix and the
 *  `[1m]` context suffix so the trigger stays short. */
export function shortModel(id: string): string {
  return id.replace(/^claude-/, '').replace(/\[1m\]$/, '');
}
