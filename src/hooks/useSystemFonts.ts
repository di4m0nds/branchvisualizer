import { useCallback, useEffect, useState } from 'react';

// ─── queryLocalFonts typing ─────────────────────────────────────────────────
// Chromium-only (widely available since Chrome 103, Tauri v2 webview supports
// it). Not yet in TS lib.dom, so we shim the minimum surface we use.

interface FontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
}

interface QueryLocalFontsCapable {
  queryLocalFonts?: () => Promise<FontData[]>;
}

// A family name looks like a monospace / coding font. Order matters loosely —
// we don't need a perfect classifier, just a broad match on the common suspects
// so the picker isn't cluttered with UI fonts. The `mono` catchall is deliberate.
const MONO_RE =
  /mono|code|consolas|courier|menlo|nerd|sf mono|dejavu sans mono|jetbrains|fira|cascadia|iosevka|hack|inconsolata|source code|ubuntu mono|liberation mono/i;

const NERD_RE = /nerd/i;

export interface SystemFontsResult {
  /** Deduped monospace-ish family names, sorted alphabetically. */
  fonts: string[];
  /** Subset of `fonts` matching /nerd/i — used as icon-glyph fallback. */
  nerdFonts: string[];
  loading: boolean;
  /** `'unsupported'` when queryLocalFonts is missing; `'denied'` when the user
   *  rejects the permission prompt. UI falls back to a manual text input. */
  error: 'unsupported' | 'denied' | null;
  refresh: () => void;
}

/**
 * Enumerates installed system monospace fonts via `window.queryLocalFonts()`.
 * The Chromium API prompts once for permission; declined → `error: 'denied'`.
 * Older webviews or non-Chromium runtimes → `error: 'unsupported'` and the
 * caller should render a text input instead.
 */
export function useSystemFonts(): SystemFontsResult {
  const [fonts, setFonts] = useState<string[]>([]);
  const [nerdFonts, setNerdFonts] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<'unsupported' | 'denied' | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const win = window as unknown as QueryLocalFontsCapable;
    if (typeof win.queryLocalFonts !== 'function') {
      setLoading(false);
      setError('unsupported');
      return;
    }
    setLoading(true);
    setError(null);
    win
      .queryLocalFonts()
      .then((all) => {
        if (cancelled) return;
        const families = new Set<string>();
        for (const f of all) {
          if (MONO_RE.test(f.family)) families.add(f.family);
        }
        const sorted = Array.from(families).sort((a, b) => a.localeCompare(b));
        setFonts(sorted);
        setNerdFonts(sorted.filter((f) => NERD_RE.test(f)));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError('denied');
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { fonts, nerdFonts, loading, error, refresh };
}
