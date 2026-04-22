// apps/branchvisualizer/src/components/workspace/editor/NavigationLog.tsx
// Phase 8 — Navigation log panel. Dual-theme (Neon Abyss / Ivory Studio).
// All chrome colours come from CSS vars injected by HackerTheme.
// Type badge colours stay vivid in both themes.
//
// Event types (emitted by MonacoEditor / ErrorLens / EditorTab):
//   open   = file opened        search = vim / find search
//   edit   = content changed    error  = diagnostic
//   save   = file saved         lsp    = LSP action
//   jump   = cursor jumped

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NavLogEntry } from './ErrorLens';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 200;

// Vivid colours that look great on both dark & light
const TYPE_COLOR: Record<NavLogEntry['type'], string> = {
  open:   '#34d399',  // emerald green
  edit:   '#fbbf24',  // amber
  save:   '#38bdf8',  // sky blue
  jump:   '#a5b4fc',  // soft indigo
  search: '#c084fc',  // orchid
  error:  '#f43f5e',  // vivid rose
  lsp:    '#fb923c',  // warm orange
};

const TYPE_LABEL: Record<NavLogEntry['type'], string> = {
  open:   'OPEN',
  edit:   'EDIT',
  save:   'SAVE',
  jump:   'JUMP',
  search: 'SRCH',
  error:  'ERR!',
  lsp:    'LSP ',
};

function formatTime(ts: number): string {
  const d  = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function shortenPath(p: string): string {
  const parts = p.replace(/^\/+/, '').split('/');
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NavigationLogProps {
  visible?: boolean;
}

export default function NavigationLog({ visible = true }: NavigationLogProps) {
  const [entries, setEntries] = useState<NavLogEntry[]>([]);
  const [paused,  setPaused]  = useState(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef    = useRef(false);
  pausedRef.current  = paused;

  useEffect(() => {
    const handler = (e: CustomEvent<NavLogEntry>) => {
      if (pausedRef.current) return;
      setEntries(prev => {
        const next = [...prev, e.detail];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    };
    window.addEventListener('codeatlas:nav-log', handler as EventListener);
    return () => window.removeEventListener('codeatlas:nav-log', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [entries, paused]);

  const clearLog = useCallback(() => setEntries([]), []);

  if (!visible) return null;

  return (
    <div style={{
      display:    'flex',
      flexDirection: 'column',
      height:     '100%',
      background: 'var(--hk-bg)',
      borderLeft: '1px solid var(--hk-bdr)',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize:   '10px',
      overflow:   'hidden',
    }}>
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '4px 8px',
        borderBottom:   '1px solid var(--hk-bdr)',
        background:     'var(--hk-bg)',
        flexShrink:     0,
      }}>
        <span style={{
          color:         'var(--hk-cursor)',
          opacity:       0.7,
          letterSpacing: '0.1em',
          fontSize:      '9px',
          fontWeight:    700,
        }}>
          ▸ NAV LOG
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            onClick={() => setPaused(p => !p)}
            title={paused ? 'Resume' : 'Pause auto-scroll'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color:      paused ? 'var(--hk-warn)' : 'var(--hk-fg-muted)',
              fontSize:   '10px', padding: '0 3px',
              transition: 'color 120ms',
            }}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button
            onClick={clearLog}
            title="Clear log"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color:      'var(--hk-fg-muted)',
              fontSize:   '10px', padding: '0 3px',
              transition: 'color 120ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--hk-err)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--hk-fg-muted)'; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Entries */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}
      >
        {entries.length === 0 && (
          <div style={{ padding: '8px 10px', color: 'var(--hk-fg-muted)', fontStyle: 'italic', opacity: 0.5 }}>
            awaiting events…
          </div>
        )}
        {entries.map((entry, i) => (
          <LogRow key={i} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div style={{
        padding:    '2px 8px',
        borderTop:  '1px solid var(--hk-bdr)',
        background: 'var(--hk-bg)',
        color:      'var(--hk-fg-muted)',
        fontSize:   '9px',
        opacity:    0.6,
        flexShrink: 0,
      }}>
        {entries.length} entries{paused ? ' · PAUSED' : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual row
// ---------------------------------------------------------------------------

function LogRow({ entry }: { entry: NavLogEntry }) {
  const color = TYPE_COLOR[entry.type] ?? '#9896a8';
  const label = TYPE_LABEL[entry.type] ?? entry.type.toUpperCase().slice(0, 4);

  return (
    <div style={{
      display:    'flex',
      alignItems: 'baseline',
      gap:        '6px',
      padding:    '1px 8px',
      lineHeight: '1.6',
      whiteSpace: 'nowrap',
      overflow:   'hidden',
    }}>
      {/* Timestamp */}
      <span style={{ color: 'var(--hk-fg-muted)', opacity: 0.5, flexShrink: 0, userSelect: 'none', fontSize: '9px' }}>
        {formatTime(entry.ts)}
      </span>
      {/* Type badge */}
      <span style={{
        color,
        fontWeight:    700,
        flexShrink:    0,
        minWidth:      '34px',
        fontSize:      '9px',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      {/* Path + line */}
      <span style={{
        color:        'var(--hk-fg)',
        opacity:      0.7,
        flex:         1,
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        fontSize:     '10px',
      }}>
        {shortenPath(entry.path)}
        {entry.line != null && (
          <span style={{ color: 'var(--hk-fn)', opacity: 0.8 }}>:{entry.line}</span>
        )}
      </span>
      {/* Detail */}
      {entry.detail && (
        <span style={{
          color:      color,
          opacity:    0.6,
          flexShrink: 0,
          fontStyle:  'italic',
          fontSize:   '9px',
        }}>
          {entry.detail}
        </span>
      )}
    </div>
  );
}
