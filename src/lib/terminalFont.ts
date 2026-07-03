// Composes the CSS `font-family` string handed to xterm. The user's chosen
// family (if any) goes first, then up to two auto-detected Nerd Fonts as a
// glyph fallback (so nvim-tree / lualine icons render even when the user's
// primary font isn't Nerd-patched), then the built-in monospace stack.

const DEFAULT_STACK =
  'ui-monospace, "Geist Mono", "SFMono-Regular", Menlo, monospace';

export function buildTerminalFontFamily(
  user: string | null,
  nerd: string[] = [],
): string {
  const head = user ? `"${user}"` : '';
  const nerdTail = nerd
    .slice(0, 2)
    .map((n) => `"${n}"`)
    .join(', ');
  return [head, nerdTail, DEFAULT_STACK].filter(Boolean).join(', ');
}
