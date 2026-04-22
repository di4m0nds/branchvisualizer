// apps/branchvisualizer/src/components/workspace/editor/VimStatusBar.tsx
// Phase 8 — Vim status bar. Dual-theme (Neon Abyss / Ivory Studio).
// Mode badge colours are deliberately vivid in both themes.
// Bar chrome uses CSS vars so it matches the rest of the editor UI.
//
//  ┌─────────────────────────────────────────────────────────────────────┐
//  │ [NORMAL]  jj  ·  @q  ·  "a                                   VIM   │
//  └─────────────────────────────────────────────────────────────────────┘

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Mode colour map — intentionally high-contrast in both dark & light
// ---------------------------------------------------------------------------

const MODE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  NORMAL:    { bg: '#34d399', fg: '#0a0a14', label: 'NORMAL' },   // emerald
  INSERT:    { bg: '#38bdf8', fg: '#0a0a14', label: 'INSERT' },   // sky blue
  VISUAL:    { bg: '#fbbf24', fg: '#0a0a14', label: 'VISUAL' },   // amber
  'V-LINE':  { bg: '#fb923c', fg: '#0a0a14', label: 'V-LINE' },   // orange
  'V-BLOCK': { bg: '#f43f5e', fg: '#ffffff', label: 'V-BLCK' },   // rose
  REPLACE:   { bg: '#c084fc', fg: '#0a0a14', label: 'REPLCE' },   // orchid
  COMMAND:   { bg: '#a5b4fc', fg: '#0a0a14', label: ':CMD  ' },   // lavender
  PENDING:   { bg: 'transparent', fg: '#c084fc', label: 'WAIT  ' },
};

const DEFAULT_MODE = MODE_STYLE.NORMAL;

function parseMode(text: string): string {
  const t = text.toUpperCase();
  if (t.includes('VISUAL BLOCK') || t.includes('V-BLOCK')) return 'V-BLOCK';
  if (t.includes('VISUAL LINE')  || t.includes('V-LINE'))  return 'V-LINE';
  if (t.includes('VISUAL'))   return 'VISUAL';
  if (t.includes('INSERT'))   return 'INSERT';
  if (t.includes('REPLACE'))  return 'REPLACE';
  if (t.includes('COMMAND') || text.trimStart().startsWith(':')) return 'COMMAND';
  return 'NORMAL';
}

// ---------------------------------------------------------------------------
// Blink helper
// ---------------------------------------------------------------------------

function useBlinkState(active: boolean, interval = 550): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) { setOn(true); return; }
    const id = setInterval(() => setOn(v => !v), interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return on;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VimStatusBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active,     setActive]     = useState(false);
  const [mode,       setMode]       = useState('NORMAL');
  const [statusText, setStatusText] = useState('');

  const blinkCursor = useBlinkState(mode === 'INSERT', 500);

  const attachNode = () => {
    const node = window.__codeatlasVimMode?.statusBarNode;
    if (!node || !containerRef.current) return;
    if (!containerRef.current.contains(node)) {
      containerRef.current.textContent = '';
      containerRef.current.appendChild(node);
      node.style.display = 'none';
    }
  };

  useEffect(() => {
    const onEnabled = (e: Event) => {
      setActive(true);
      setMode('NORMAL');
      const detail = (e as CustomEvent).detail as { statusBarNode?: HTMLDivElement };
      if (detail?.statusBarNode && containerRef.current) {
        containerRef.current.textContent = '';
        containerRef.current.appendChild(detail.statusBarNode);
        detail.statusBarNode.style.display = 'none';
      }
    };
    const onDisabled = () => { setActive(false); setMode('NORMAL'); setStatusText(''); };
    const onReady    = () => {
      if (window.__codeatlasVimMode?.isEnabled()) { setActive(true); attachNode(); }
    };

    window.addEventListener('codeatlas:vim-enabled',  onEnabled);
    window.addEventListener('codeatlas:vim-disabled', onDisabled);
    window.addEventListener('codeatlas:editor-ready', onReady);
    if (window.__codeatlasVimMode?.isEnabled()) { setActive(true); attachNode(); }

    return () => {
      window.removeEventListener('codeatlas:vim-enabled',  onEnabled);
      window.removeEventListener('codeatlas:vim-disabled', onDisabled);
      window.removeEventListener('codeatlas:editor-ready', onReady);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new MutationObserver(() => {
      const raw = node.textContent ?? '';
      setMode(parseMode(raw));
      setStatusText(raw.replace(/--.*--/g, '').trim());
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  if (!active) return null;

  const mStyle = MODE_STYLE[mode] ?? DEFAULT_MODE;

  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      height:     '24px',
      background: 'var(--hk-bg)',
      borderTop:  '1px solid var(--hk-bdr)',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize:   '11px',
      flexShrink: 0,
      overflow:   'hidden',
      userSelect: 'none',
    }}>

      {/* Mode badge */}
      <div style={{
        padding:        '0 12px',
        height:         '100%',
        display:        'flex',
        alignItems:     'center',
        background:     mStyle.bg,
        color:          mStyle.fg,
        fontWeight:     800,
        fontSize:       '10px',
        letterSpacing:  '0.13em',
        flexShrink:     0,
        minWidth:       '76px',
        justifyContent: 'center',
        borderRight:    `1px solid var(--hk-bdr)`,
      }}>
        {mStyle.label}
      </div>

      {/* INSERT cursor blink indicator */}
      {mode === 'INSERT' && (
        <div style={{ padding: '0 6px', color: '#38bdf8', flexShrink: 0 }}>
          <span style={{ opacity: blinkCursor ? 1 : 0, fontSize: '15px', lineHeight: 1 }}>│</span>
        </div>
      )}

      {/* Hidden status node (vim writes to this) */}
      <div
        ref={containerRef}
        style={{
          flex:         1,
          padding:      '0 8px',
          color:        mStyle.bg,
          opacity:      0.9,
          overflow:     'hidden',
          whiteSpace:   'nowrap',
          textOverflow: 'ellipsis',
          fontSize:     '11px',
        }}
      />

      {/* Visible status hint */}
      {statusText && (
        <div style={{
          padding:      '0 8px',
          color:        'var(--hk-fg-muted)',
          fontSize:     '10px',
          flexShrink:   0,
          overflow:     'hidden',
          maxWidth:     '220px',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {statusText}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* VIM label — coloured to match mode badge */}
      <div style={{
        padding:       '0 10px',
        color:         mStyle.bg,
        fontSize:      '9px',
        opacity:       0.5,
        letterSpacing: '0.2em',
        flexShrink:    0,
        fontWeight:    700,
      }}>
        VIM
      </div>
    </div>
  );
}
