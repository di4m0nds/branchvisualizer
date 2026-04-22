// apps/branchvisualizer/src/components/workspace/editor/HackerTheme.ts
// Phase 8 — Dual passionate editor themes.
//
// Dark  → "Neon Abyss"   — deep midnight with electric neon accents.
//          Electric pink cursor, violet keywords, golden strings, teal functions.
//          Inspired by: Dracula Pro + Tokyo Night Dark + custom glow layer.
//
// Light → "Ivory Studio" — warm parchment with rich jewel-tone syntax.
//          Vivid red cursor, indigo keywords, amber strings, teal functions.
//          Inspired by: Solarized Light + Rosé Pine Dawn taken further.
//
// Both themes sync with the app's state.theme ('dark' | 'light').
// Call registerThemes(monaco) once; then switch with setEditorTheme(monaco, mode).
// CSS custom properties (applied to :root) are exported for non-Monaco UI.

import type * as MonacoType from 'monaco-editor';

// ─────────────────────────────────────────────────────────────────────────────
// Theme IDs
// ─────────────────────────────────────────────────────────────────────────────

export const DARK_THEME_ID  = 'codeatlas-dark';
export const LIGHT_THEME_ID = 'codeatlas-light';

// Legacy alias kept so existing imports don't break
export const HACKER_THEME_ID = DARK_THEME_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Dark palette — "Neon Abyss"
// ─────────────────────────────────────────────────────────────────────────────

const D = {
  // Backgrounds
  bg:          '#0c0e1a',   // deep midnight blue-black
  bgLine:      '#141828',   // active line highlight
  bgSel:       '#3d2570',   // violet selection
  bgSelInact:  '#1e2040',
  bgGutter:    '#0a0c17',
  bgWidget:    '#111425',   // suggest / hover widget
  bgWidgetBdr: '#2a2f5a',

  // Foregrounds
  fg:          '#c8cce8',   // cool pale lavender white
  fgMuted:     '#4a506a',   // line numbers, guides
  fgActive:    '#9d4edd',   // active line number — vivid violet
  fgMini:      '#1e2240',   // minimap

  // Cursor & highlight
  cursor:      '#ff2d78',   // electric hot pink — absolutely arresting
  cursorLine:  'rgba(255,45,120,0.055)',

  // Borders
  bdr:         '#1e2240',
  bdrActive:   '#9d4edd',

  // Syntax
  kw:   '#c084fc',   // vivid orchid — keywords, control flow
  str:  '#fbbf24',   // warm golden amber — strings
  num:  '#f87171',   // soft coral — numbers
  type: '#38bdf8',   // brilliant sky blue — types, interfaces
  fn:   '#34d399',   // bright emerald — function names
  var_: '#c8cce8',   // same as fg — variables
  cmt:  '#4a5a8a',   // readable blue-gray — comments
  op:   '#e879f9',   // bright magenta — operators
  del:  '#64748b',   // neutral slate — delimiters
  cls:  '#67e8f9',   // bright cyan — classes
  dec:  '#fb923c',   // warm orange — decorators, tags
  ns:   '#a5b4fc',   // soft indigo — namespaces
  err:  '#f43f5e',   // vivid rose
  warn: '#fb923c',   // amber
  info: '#38bdf8',   // sky blue
  hint: '#4a506a',

  // Diff
  addBg: '#0d2d1a',
  modBg: '#1a1a0a',
  delBg: '#2d0d1a',
};

const DARK_RULES: MonacoType.editor.ITokenThemeRule[] = [
  { token: '',                   foreground: D.fg.slice(1) },
  { token: 'comment',            foreground: D.cmt.slice(1), fontStyle: 'italic' },
  { token: 'comment.doc',        foreground: D.cmt.slice(1), fontStyle: 'italic' },
  { token: 'keyword',            foreground: D.kw.slice(1), fontStyle: 'bold' },
  { token: 'keyword.control',    foreground: D.kw.slice(1), fontStyle: 'bold' },
  { token: 'keyword.operator',   foreground: D.op.slice(1) },
  { token: 'keyword.other',      foreground: D.kw.slice(1) },
  { token: 'string',             foreground: D.str.slice(1) },
  { token: 'string.escape',      foreground: D.dec.slice(1) },
  { token: 'string.template',    foreground: D.str.slice(1) },
  { token: 'string.quoted',      foreground: D.str.slice(1) },
  { token: 'number',             foreground: D.num.slice(1) },
  { token: 'number.hex',         foreground: D.num.slice(1) },
  { token: 'number.float',       foreground: D.num.slice(1) },
  { token: 'regexp',             foreground: D.dec.slice(1) },
  { token: 'type',               foreground: D.type.slice(1) },
  { token: 'type.identifier',    foreground: D.type.slice(1) },
  { token: 'class',              foreground: D.cls.slice(1), fontStyle: 'bold' },
  { token: 'interface',          foreground: D.type.slice(1), fontStyle: 'italic' },
  { token: 'function',           foreground: D.fn.slice(1) },
  { token: 'function.call',      foreground: D.fn.slice(1) },
  { token: 'identifier',         foreground: D.var_.slice(1) },
  { token: 'variable',           foreground: D.var_.slice(1) },
  { token: 'variable.predefined',foreground: D.kw.slice(1) },
  { token: 'constant',           foreground: D.num.slice(1), fontStyle: 'bold' },
  { token: 'operator',           foreground: D.op.slice(1) },
  { token: 'delimiter',          foreground: D.del.slice(1) },
  { token: 'delimiter.bracket',  foreground: D.del.slice(1) },
  { token: 'delimiter.curly',    foreground: D.del.slice(1) },
  { token: 'tag',                foreground: D.dec.slice(1) },
  { token: 'tag.id',             foreground: D.cls.slice(1) },
  { token: 'attribute.name',     foreground: D.type.slice(1) },
  { token: 'attribute.value',    foreground: D.str.slice(1) },
  { token: 'metatag',            foreground: D.dec.slice(1) },
  { token: 'annotation',         foreground: D.dec.slice(1) },
  { token: 'decorator',          foreground: D.dec.slice(1), fontStyle: 'italic' },
  { token: 'namespace',          foreground: D.ns.slice(1), fontStyle: 'italic' },
  { token: 'import',             foreground: D.kw.slice(1) },
  { token: 'invalid',            foreground: D.err.slice(1), fontStyle: 'underline' },
  { token: 'support',            foreground: D.cls.slice(1) },
  { token: 'support.function',   foreground: D.fn.slice(1) },
  { token: 'entity',             foreground: D.dec.slice(1) },
  { token: 'entity.name',        foreground: D.cls.slice(1), fontStyle: 'bold' },
];

const DARK_COLORS: MonacoType.editor.IColors = {
  'editor.background':                          D.bg,
  'editor.foreground':                          D.fg,
  'editor.lineHighlightBackground':             D.cursorLine,
  'editor.lineHighlightBorder':                 '#00000000',
  'editor.selectionBackground':                 D.bgSel + '80',
  'editor.inactiveSelectionBackground':         D.bgSelInact + '60',
  'editor.selectionHighlightBackground':        D.bgSel + '40',
  'editor.wordHighlightBackground':             '#1a1a4a60',
  'editor.wordHighlightStrongBackground':       '#2a2a6080',
  'editor.findMatchBackground':                 '#5a2d7a60',
  'editor.findMatchHighlightBackground':        '#3d1f5a40',
  'editor.findRangeHighlightBackground':        '#2a1a4a20',
  'editorLineNumber.foreground':                D.fgMuted,
  'editorLineNumber.activeForeground':          D.fgActive,
  'editorCursor.foreground':                    D.cursor,
  'editorCursor.background':                    D.bg,
  'editorIndentGuide.background':               D.bdr,
  'editorIndentGuide.activeBackground':         D.bdrActive,
  'editorIndentGuide.background1':              D.bdr,
  'editorIndentGuide.activeBackground1':        D.bdrActive,
  'editorRuler.foreground':                     D.bdr,
  'editorBracketMatch.background':              '#3d2570',
  'editorBracketMatch.border':                  D.cursor,
  'editorOverviewRuler.border':                 D.bdr,
  'editorOverviewRuler.errorForeground':        D.err,
  'editorOverviewRuler.warningForeground':      D.warn,
  'editorOverviewRuler.infoForeground':         D.info,
  'editorOverviewRuler.findMatchForeground':    D.fn,
  'editorOverviewRuler.selectionHighlightForeground': D.cursor + '80',
  'editorError.foreground':                     D.err,
  'editorWarning.foreground':                   D.warn,
  'editorInfo.foreground':                      D.info,
  'editorHint.foreground':                      D.hint,
  'editorGutter.background':                    D.bgGutter,
  'editorGutter.addedBackground':               '#1a4a2a',
  'editorGutter.modifiedBackground':            '#3d2570',
  'editorGutter.deletedBackground':             '#4a1a2a',
  'editorSuggestWidget.background':             D.bgWidget,
  'editorSuggestWidget.border':                 D.bgWidgetBdr,
  'editorSuggestWidget.foreground':             D.fg,
  'editorSuggestWidget.selectedBackground':     '#1e2050',
  'editorSuggestWidget.highlightForeground':    D.cursor,
  'editorSuggestWidget.focusHighlightForeground': D.fn,
  'editorHoverWidget.background':               D.bgWidget,
  'editorHoverWidget.border':                   D.bgWidgetBdr,
  'editorHoverWidget.foreground':               D.fg,
  'editorWidget.background':                    D.bgWidget,
  'editorWidget.border':                        D.bgWidgetBdr,
  'editorWidget.foreground':                    D.fg,
  'editorWidget.resizeBorder':                  D.bdrActive,
  'input.background':                           '#0e1022',
  'input.foreground':                           D.fg,
  'input.border':                               D.bdrActive,
  'input.placeholderForeground':                D.fgMuted,
  'inputValidation.errorBackground':            '#2a0010',
  'inputValidation.errorBorder':                D.err,
  'list.activeSelectionBackground':             '#1e2050',
  'list.activeSelectionForeground':             D.fg,
  'list.hoverBackground':                       '#141828',
  'list.highlightForeground':                   D.cursor,
  'list.focusHighlightForeground':              D.fn,
  'scrollbar.shadow':                           '#00000000',
  'scrollbarSlider.background':                 '#3d2570',
  'scrollbarSlider.hoverBackground':            '#6d35c0',
  'scrollbarSlider.activeBackground':           '#9d4edd',
  'minimap.background':                         D.bgGutter,
  'minimap.errorHighlight':                     D.err,
  'minimap.warningHighlight':                   D.warn,
  'minimap.findMatchHighlight':                 D.fn,
  'minimap.selectionHighlight':                 D.bgSel + '60',
  'minimapSlider.background':                   '#3d257040',
  'minimapSlider.hoverBackground':              '#3d257080',
  'minimapSlider.activeBackground':             '#9d4edd60',
  'peekView.border':                            D.bdrActive,
  'peekViewEditor.background':                  '#0e1022',
  'peekViewEditor.matchHighlightBackground':    '#3d257080',
  'peekViewResult.background':                  D.bgWidget,
  'peekViewResult.fileForeground':              D.fg,
  'peekViewResult.lineForeground':              D.fgMuted,
  'peekViewResult.matchHighlightBackground':    '#3d257060',
  'peekViewResult.selectionBackground':         '#1e2050',
  'peekViewResult.selectionForeground':         D.fn,
  'peekViewTitle.background':                   '#111425',
  'peekViewTitleLabel.foreground':              D.fn,
  'peekViewTitleDescription.foreground':        D.fgMuted,
  'diffEditor.insertedTextBackground':          '#1a4a2a40',
  'diffEditor.removedTextBackground':           '#4a1a2a40',
  'diffEditor.insertedLineBackground':          '#0d2d1a40',
  'diffEditor.removedLineBackground':           '#2d0d1a40',
  'focusBorder':                                D.bdrActive,
};

// ─────────────────────────────────────────────────────────────────────────────
// Light palette — "Ivory Studio"
// ─────────────────────────────────────────────────────────────────────────────

const L = {
  // Backgrounds
  bg:          '#fafaf2',   // warm ivory/parchment — gentle on the eyes
  bgLine:      '#f3f0e6',   // soft warm cream line highlight
  bgSel:       '#ddd6fe',   // light violet selection
  bgSelInact:  '#ede9fe',
  bgGutter:    '#f5f2e8',
  bgWidget:    '#ffffff',
  bgWidgetBdr: '#d4cfc4',

  // Foregrounds
  fg:          '#1e1b2e',   // very deep purple-black — rich depth
  fgMuted:     '#9896a8',   // medium gray-purple
  fgActive:    '#4f46e5',   // indigo — active line number pops
  fgMini:      '#d4cfc4',

  // Cursor & highlight
  cursor:      '#dc2626',   // vivid red — bold and confident on ivory
  cursorLine:  'rgba(220,38,38,0.042)',

  // Borders
  bdr:         '#e4e0d4',
  bdrActive:   '#4f46e5',

  // Syntax
  kw:   '#4f46e5',   // strong indigo — keywords command attention
  str:  '#b45309',   // warm amber-brown — strings feel rich, not harsh
  num:  '#059669',   // emerald green — numbers stand out cleanly
  type: '#7c3aed',   // bold purple — types are royalty
  fn:   '#0d9488',   // deep teal — functions flow
  var_: '#1e1b2e',   // same as fg — variables blend in
  cmt:  '#7b7585',   // muted mauve — comments whisper
  op:   '#6d28d9',   // deep violet — operators punctuate
  del:  '#6b7280',   // neutral gray
  cls:  '#0369a1',   // deep sky blue — classes are reliable
  dec:  '#d97706',   // warm amber — decorators accent
  ns:   '#5b21b6',   // rich purple — namespaces
  err:  '#dc2626',   // red
  warn: '#d97706',   // amber
  info: '#0369a1',   // sky blue
  hint: '#9896a8',

  addBg: '#dcfce7',
  modBg: '#fef9c3',
  delBg: '#fee2e2',
};

const LIGHT_RULES: MonacoType.editor.ITokenThemeRule[] = [
  { token: '',                   foreground: L.fg.slice(1) },
  { token: 'comment',            foreground: L.cmt.slice(1), fontStyle: 'italic' },
  { token: 'comment.doc',        foreground: L.cmt.slice(1), fontStyle: 'italic' },
  { token: 'keyword',            foreground: L.kw.slice(1), fontStyle: 'bold' },
  { token: 'keyword.control',    foreground: L.kw.slice(1), fontStyle: 'bold' },
  { token: 'keyword.operator',   foreground: L.op.slice(1) },
  { token: 'keyword.other',      foreground: L.kw.slice(1) },
  { token: 'string',             foreground: L.str.slice(1) },
  { token: 'string.escape',      foreground: L.dec.slice(1) },
  { token: 'string.template',    foreground: L.str.slice(1) },
  { token: 'string.quoted',      foreground: L.str.slice(1) },
  { token: 'number',             foreground: L.num.slice(1) },
  { token: 'number.hex',         foreground: L.num.slice(1) },
  { token: 'number.float',       foreground: L.num.slice(1) },
  { token: 'regexp',             foreground: L.dec.slice(1) },
  { token: 'type',               foreground: L.type.slice(1) },
  { token: 'type.identifier',    foreground: L.type.slice(1) },
  { token: 'class',              foreground: L.cls.slice(1), fontStyle: 'bold' },
  { token: 'interface',          foreground: L.type.slice(1), fontStyle: 'italic' },
  { token: 'function',           foreground: L.fn.slice(1) },
  { token: 'function.call',      foreground: L.fn.slice(1) },
  { token: 'identifier',         foreground: L.var_.slice(1) },
  { token: 'variable',           foreground: L.var_.slice(1) },
  { token: 'variable.predefined',foreground: L.kw.slice(1) },
  { token: 'constant',           foreground: L.num.slice(1), fontStyle: 'bold' },
  { token: 'operator',           foreground: L.op.slice(1) },
  { token: 'delimiter',          foreground: L.del.slice(1) },
  { token: 'delimiter.bracket',  foreground: L.del.slice(1) },
  { token: 'delimiter.curly',    foreground: L.del.slice(1) },
  { token: 'tag',                foreground: L.dec.slice(1) },
  { token: 'tag.id',             foreground: L.cls.slice(1) },
  { token: 'attribute.name',     foreground: L.type.slice(1) },
  { token: 'attribute.value',    foreground: L.str.slice(1) },
  { token: 'metatag',            foreground: L.dec.slice(1) },
  { token: 'annotation',         foreground: L.dec.slice(1) },
  { token: 'decorator',          foreground: L.dec.slice(1), fontStyle: 'italic' },
  { token: 'namespace',          foreground: L.ns.slice(1), fontStyle: 'italic' },
  { token: 'import',             foreground: L.kw.slice(1) },
  { token: 'invalid',            foreground: L.err.slice(1), fontStyle: 'underline' },
  { token: 'support',            foreground: L.cls.slice(1) },
  { token: 'support.function',   foreground: L.fn.slice(1) },
  { token: 'entity',             foreground: L.dec.slice(1) },
  { token: 'entity.name',        foreground: L.cls.slice(1), fontStyle: 'bold' },
];

const LIGHT_COLORS: MonacoType.editor.IColors = {
  'editor.background':                          L.bg,
  'editor.foreground':                          L.fg,
  'editor.lineHighlightBackground':             L.cursorLine,
  'editor.lineHighlightBorder':                 '#00000000',
  'editor.selectionBackground':                 L.bgSel + 'cc',
  'editor.inactiveSelectionBackground':         L.bgSelInact + '80',
  'editor.selectionHighlightBackground':        L.bgSel + '60',
  'editor.wordHighlightBackground':             '#ede9fe',
  'editor.wordHighlightStrongBackground':       '#ddd6fe',
  'editor.findMatchBackground':                 '#fbbf2460',
  'editor.findMatchHighlightBackground':        '#fef3c780',
  'editor.findRangeHighlightBackground':        '#fefce820',
  'editorLineNumber.foreground':                L.fgMuted,
  'editorLineNumber.activeForeground':          L.fgActive,
  'editorCursor.foreground':                    L.cursor,
  'editorCursor.background':                    L.bg,
  'editorIndentGuide.background':               L.bdr,
  'editorIndentGuide.activeBackground':         L.bdrActive,
  'editorIndentGuide.background1':              L.bdr,
  'editorIndentGuide.activeBackground1':        L.bdrActive,
  'editorRuler.foreground':                     L.bdr,
  'editorBracketMatch.background':              '#ddd6fe',
  'editorBracketMatch.border':                  L.kw,
  'editorOverviewRuler.border':                 L.bdr,
  'editorOverviewRuler.errorForeground':        L.err,
  'editorOverviewRuler.warningForeground':      L.warn,
  'editorOverviewRuler.infoForeground':         L.info,
  'editorOverviewRuler.findMatchForeground':    L.fn,
  'editorOverviewRuler.selectionHighlightForeground': L.kw + '80',
  'editorError.foreground':                     L.err,
  'editorWarning.foreground':                   L.warn,
  'editorInfo.foreground':                      L.info,
  'editorHint.foreground':                      L.hint,
  'editorGutter.background':                    L.bgGutter,
  'editorGutter.addedBackground':               '#bbf7d0',
  'editorGutter.modifiedBackground':            '#ddd6fe',
  'editorGutter.deletedBackground':             '#fecaca',
  'editorSuggestWidget.background':             L.bgWidget,
  'editorSuggestWidget.border':                 L.bgWidgetBdr,
  'editorSuggestWidget.foreground':             L.fg,
  'editorSuggestWidget.selectedBackground':     '#ede9fe',
  'editorSuggestWidget.highlightForeground':    L.cursor,
  'editorSuggestWidget.focusHighlightForeground': L.fn,
  'editorHoverWidget.background':               L.bgWidget,
  'editorHoverWidget.border':                   L.bgWidgetBdr,
  'editorHoverWidget.foreground':               L.fg,
  'editorWidget.background':                    L.bgWidget,
  'editorWidget.border':                        L.bgWidgetBdr,
  'editorWidget.foreground':                    L.fg,
  'editorWidget.resizeBorder':                  L.bdrActive,
  'input.background':                           '#f5f2e8',
  'input.foreground':                           L.fg,
  'input.border':                               L.bdrActive,
  'input.placeholderForeground':                L.fgMuted,
  'inputValidation.errorBackground':            '#fee2e2',
  'inputValidation.errorBorder':                L.err,
  'list.activeSelectionBackground':             '#ede9fe',
  'list.activeSelectionForeground':             L.fg,
  'list.hoverBackground':                       '#f3f0e6',
  'list.highlightForeground':                   L.cursor,
  'list.focusHighlightForeground':              L.fn,
  'scrollbar.shadow':                           '#00000000',
  'scrollbarSlider.background':                 '#ddd6fe',
  'scrollbarSlider.hoverBackground':            '#c4b5fd',
  'scrollbarSlider.activeBackground':           '#a78bfa',
  'minimap.background':                         L.bgGutter,
  'minimap.errorHighlight':                     L.err,
  'minimap.warningHighlight':                   L.warn,
  'minimap.findMatchHighlight':                 L.fn,
  'minimap.selectionHighlight':                 L.bgSel + '80',
  'minimapSlider.background':                   '#ddd6fe80',
  'minimapSlider.hoverBackground':              '#c4b5fda0',
  'minimapSlider.activeBackground':             '#a78bfac0',
  'peekView.border':                            L.bdrActive,
  'peekViewEditor.background':                  '#f5f2e8',
  'peekViewEditor.matchHighlightBackground':    '#fbbf2460',
  'peekViewResult.background':                  '#ffffff',
  'peekViewResult.fileForeground':              L.fg,
  'peekViewResult.lineForeground':              L.fgMuted,
  'peekViewResult.matchHighlightBackground':    '#fbbf2440',
  'peekViewResult.selectionBackground':         '#ede9fe',
  'peekViewResult.selectionForeground':         L.fn,
  'peekViewTitle.background':                   '#fafaf2',
  'peekViewTitleLabel.foreground':              L.fn,
  'peekViewTitleDescription.foreground':        L.fgMuted,
  'diffEditor.insertedTextBackground':          '#dcfce740',
  'diffEditor.removedTextBackground':           '#fee2e240',
  'diffEditor.insertedLineBackground':          '#dcfce740',
  'diffEditor.removedLineBackground':           '#fee2e240',
  'focusBorder':                                L.bdrActive,
};

// ─────────────────────────────────────────────────────────────────────────────
// Register both themes
// ─────────────────────────────────────────────────────────────────────────────

let _registered = false;

export function registerThemes(monaco: typeof MonacoType): void {
  if (_registered) return;
  _registered = true;
  monaco.editor.defineTheme(DARK_THEME_ID, {
    base: 'vs-dark',
    inherit: false,
    rules: DARK_RULES,
    colors: DARK_COLORS,
  });
  monaco.editor.defineTheme(LIGHT_THEME_ID, {
    base: 'vs',
    inherit: false,
    rules: LIGHT_RULES,
    colors: LIGHT_COLORS,
  });
}

/** Legacy alias — registers only dark theme (still registers both internally). */
export function registerHackerTheme(monaco: typeof MonacoType): void {
  registerThemes(monaco);
}

/** Switch Monaco + root CSS vars to the given app theme. */
export function setEditorTheme(
  monaco: typeof MonacoType,
  appTheme: 'dark' | 'light',
): void {
  const id = appTheme === 'light' ? LIGHT_THEME_ID : DARK_THEME_ID;
  monaco.editor.setTheme(id);
  applyRootCssVars(appTheme);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS custom properties — applied to :root so all components can use them
// ─────────────────────────────────────────────────────────────────────────────

function buildCssVars(mode: 'dark' | 'light'): string {
  const P = mode === 'dark' ? D : L;
  return `
    --hk-bg:       ${P.bg};
    --hk-bg-line:  ${P.bgLine};
    --hk-bg-sel:   ${P.bgSel};
    --hk-bg-w:     ${P.bgWidget};
    --hk-bg-w-bdr: ${P.bgWidgetBdr};
    --hk-fg:       ${P.fg};
    --hk-fg-muted: ${P.fgMuted};
    --hk-fg-act:   ${P.fgActive};
    --hk-cursor:   ${P.cursor};
    --hk-kw:       ${P.kw};
    --hk-str:      ${P.str};
    --hk-num:      ${P.num};
    --hk-type:     ${P.type};
    --hk-fn:       ${P.fn};
    --hk-err:      ${P.err};
    --hk-warn:     ${P.warn};
    --hk-info:     ${P.info};
    --hk-bdr:      ${P.bdr};
    --hk-bdr-act:  ${P.bdrActive};
    --hk-dec:      ${P.dec};
    --hk-cls:      ${P.cls};
    --hk-cmt:      ${P.cmt};
    --hk-op:       ${P.op};
    --hk-ns:       ${P.ns};
  `;
}

/** Inject / update CSS vars on :root */
export function applyRootCssVars(mode: 'dark' | 'light'): void {
  const styleId = 'codeatlas-theme-vars';
  let el = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
    document.head.appendChild(el);
  }
  el.textContent = `:root { ${buildCssVars(mode)} }`;
}

/** CSS string of dark vars (for legacy inline injection). */
export const HACKER_CSS_VARS = buildCssVars('dark');
