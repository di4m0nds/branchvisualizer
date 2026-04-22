// apps/branchvisualizer/src/components/workspace/editor/FileFinder.tsx
// Phase 8 — Emacs / Helm-style find-file command palette.
// Dual-theme: CSS vars switch automatically with app theme.
//
// Keyboard triggers:
//   • Vim ex :e / :find / :Files   • Ctrl+X Ctrl+F (emacs chord)
//   • <Space>ff (leader)           • codeatlas:open-file-finder event
//
// Behaviour:
//   • Fetches /api/fs/tree once (30 s cache) → flattened file list
//   • Real-time fuzzy filter (subsequence, scored by path length)
//   • Arrow keys / Ctrl+N/P navigate; Tab cycles; Enter opens; Esc closes
//   • Highlights matched characters in cursor colour

import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { useAppContext } from '@/store/AppContext';
import { emitNavLog } from './ErrorLens';

// ---------------------------------------------------------------------------
// API base
// ---------------------------------------------------------------------------

const API_BASE =
  ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001')
    .replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FSNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FSNode[];
}

interface FlatFile {
  path: string;
  name: string;
  ext: string;
}

// ---------------------------------------------------------------------------
// File-tree cache (module-level, 30 s TTL)
// ---------------------------------------------------------------------------

let _cacheNodes: FlatFile[] | null = null;
let _cacheExpiry = 0;

async function fetchFlatFiles(): Promise<FlatFile[]> {
  if (_cacheNodes && Date.now() < _cacheExpiry) return _cacheNodes;
  const res = await fetch(`${API_BASE}/api/fs/tree`, { credentials: 'include' });
  if (!res.ok) return [];
  const nodes: FSNode[] = await res.json() as FSNode[];
  const flat = flattenTree(nodes);
  _cacheNodes  = flat;
  _cacheExpiry = Date.now() + 30_000;
  return flat;
}

function flattenTree(nodes: FSNode[]): FlatFile[] {
  const result: FlatFile[] = [];
  const recurse = (ns: FSNode[]) => {
    for (const n of ns) {
      if (n.type === 'file') {
        const ext = n.name.includes('.') ? n.name.split('.').pop()! : '';
        result.push({ path: n.path, name: n.name, ext });
      }
      if (n.children) recurse(n.children);
    }
  };
  recurse(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Fuzzy score
// ---------------------------------------------------------------------------

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.includes(q)) return 500 - t.length;
  let qi = 0, score = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIdx === ti - 1 ? 10 : 1;
      lastIdx = ti;
      qi++;
    }
  }
  return qi < q.length ? -1 : score - t.length;
}

// ---------------------------------------------------------------------------
// Language icons (ASCII, terminal-safe)
// ---------------------------------------------------------------------------

const EXT_ICON: Record<string, string> = {
  ts: 'τ', tsx: 'τ', js: 'λ', jsx: 'λ', mjs: 'λ',
  py: 'ψ', rs: 'R', go: 'G', java: 'J', kt: 'K',
  cpp: 'C', c: 'c', cs: '#', rb: 'r', php: 'P',
  swift: 'S', html: 'h', css: 's', scss: 's', less: 's',
  json: '{', yaml: '~', yml: '~', toml: '~', md: '¶',
  sh: '$', bash: '$', dockerfile: 'D', sql: '∑',
  graphql: '⌘', gql: '⌘', xml: '<', svg: '◈', txt: '·',
};

function fileIcon(ext: string): string {
  return EXT_ICON[ext.toLowerCase()] ?? '·';
}

// ---------------------------------------------------------------------------
// Highlight matching chars
// ---------------------------------------------------------------------------

function highlightMatch(query: string, text: string): Array<{ ch: string; hi: boolean }> {
  if (!query) return text.split('').map(ch => ({ ch, hi: false }));
  const q = query.toLowerCase();
  const result: Array<{ ch: string; hi: boolean }> = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    const hi = qi < q.length && text[i].toLowerCase() === q[qi];
    if (hi) qi++;
    result.push({ ch: text[i], hi });
  }
  return result;
}

// ---------------------------------------------------------------------------
// FileFinder component
// ---------------------------------------------------------------------------

export interface FileFinderProps {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export default function FileFinder({ open, onClose, initialQuery = '' }: FileFinderProps) {
  const { dispatch } = useAppContext();
  const [query,   setQuery]   = useState(initialQuery);
  const [files,   setFiles]   = useState<FlatFile[]>([]);
  const [cursor,  setCursor]  = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const itemRefs  = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setCursor(0);
    setLoading(true);
    fetchFlatFiles()
      .then(f => { setFiles(f); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, initialQuery]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const matches = useMemo(() => {
    if (!query.trim()) return files.slice(0, 100);
    return files
      .map(f => ({ f, score: fuzzyScore(query, f.path) }))
      .filter(x => x.score > -1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map(x => x.f);
  }, [query, files]);

  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const openFile = useCallback(async (file: FlatFile) => {
    onClose();
    try {
      const res = await fetch(
        `${API_BASE}/api/fs/read?path=${encodeURIComponent(file.path)}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const data = await res.json() as { path: string; content: string; language: string };
      dispatch({ type: 'OPEN_FILE', payload: { path: data.path, content: data.content, language: data.language } });
      emitNavLog({ type: 'open', path: data.path, detail: 'find-file' });
    } catch { /* ignore */ }
  }, [dispatch, onClose]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setCursor(c => Math.min(c + 1, matches.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setCursor(c => Math.max(c - 1, 0));
        break;
      case 'n':
        if (e.ctrlKey) { e.preventDefault(); setCursor(c => Math.min(c + 1, matches.length - 1)); }
        break;
      case 'p':
        if (e.ctrlKey) { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
        break;
      case 'Tab':
        e.preventDefault();
        setCursor(c => e.shiftKey
          ? Math.max(c - 1, 0)
          : Math.min(c + 1, matches.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (matches[cursor]) void openFile(matches[cursor]);
        break;
    }
  }, [cursor, matches, onClose, openFile]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         9999,
        background:     'rgba(0,0,0,0.75)',
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'center',
        paddingTop:     '80px',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:      'min(700px, 90vw)',
          background: 'var(--hk-bg)',
          border:     '1px solid var(--hk-bdr-act)',
          boxShadow:  '0 0 0 1px var(--hk-bdr), 0 20px 60px rgba(0,0,0,0.6)',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize:   '12px',
          overflow:   'hidden',
          borderRadius: '4px',
        }}
      >
        {/* Header */}
        <div style={{
          padding:      '6px 12px',
          borderBottom: '1px solid var(--hk-bdr)',
          background:   'var(--hk-bg-line)',
          display:      'flex',
          alignItems:   'center',
          gap:          '10px',
        }}>
          <span style={{
            color:         'var(--hk-cursor)',
            fontSize:      '10px',
            fontWeight:    700,
            letterSpacing: '0.06em',
          }}>
            M-x find-file
          </span>
          <span style={{ color: 'var(--hk-fg-muted)', fontSize: '10px', opacity: 0.7 }}>
            {loading ? 'loading…' : `${matches.length} / ${files.length}`}
          </span>
        </div>

        {/* Minibuffer input */}
        <div style={{
          display:      'flex',
          alignItems:   'center',
          padding:      '10px 12px',
          borderBottom: '1px solid var(--hk-bdr)',
          background:   'var(--hk-bg)',
          gap:          '8px',
        }}>
          <span style={{
            color:      'var(--hk-cursor)',
            flexShrink: 0,
            fontSize:   '12px',
            fontWeight: 600,
          }}>
            Find file:
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={handleKey}
            placeholder="fuzzy path…"
            style={{
              flex:       1,
              background: 'transparent',
              border:     'none',
              outline:    'none',
              color:      'var(--hk-fg)',
              fontFamily: 'inherit',
              fontSize:   '13px',
              caretColor: 'var(--hk-cursor)',
            }}
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{ maxHeight: '340px', overflowY: 'auto' }}
        >
          {matches.length === 0 && !loading && (
            <div style={{ padding: '12px', color: 'var(--hk-fg-muted)', fontStyle: 'italic', opacity: 0.6 }}>
              {query ? 'No files match.' : 'No files found.'}
            </div>
          )}
          {matches.map((file, i) => {
            const isActive = i === cursor;
            const parts    = highlightMatch(query, file.path);
            return (
              <div
                key={file.path}
                ref={el => { itemRefs.current[i] = el; }}
                onClick={() => void openFile(file)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        '8px',
                  padding:    '5px 12px',
                  cursor:     'pointer',
                  background: isActive ? 'var(--hk-bg-sel)' : 'transparent',
                  borderLeft: isActive
                    ? '3px solid var(--hk-cursor)'
                    : '3px solid transparent',
                  transition: 'background 80ms',
                }}
              >
                {/* Icon */}
                <span style={{
                  color:     isActive ? 'var(--hk-cursor)' : 'var(--hk-fg-muted)',
                  width:     '12px',
                  flexShrink: 0,
                  textAlign: 'center',
                  fontSize:  '11px',
                }}>
                  {fileIcon(file.ext)}
                </span>
                {/* Path with highlight */}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {parts.map((p, pi) => (
                    <span
                      key={pi}
                      style={{
                        color:      p.hi ? 'var(--hk-cursor)' : (isActive ? 'var(--hk-fg)' : 'var(--hk-fg-muted)'),
                        fontWeight: p.hi ? 700 : 400,
                      }}
                    >
                      {p.ch}
                    </span>
                  ))}
                </span>
                {/* Filename */}
                <span style={{
                  color:      isActive ? 'var(--hk-cls)' : 'var(--hk-fg-muted)',
                  fontSize:   '11px',
                  flexShrink: 0,
                  opacity:    isActive ? 1 : 0.6,
                }}>
                  {file.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div style={{
          padding:      '4px 12px',
          borderTop:    '1px solid var(--hk-bdr)',
          background:   'var(--hk-bg-line)',
          display:      'flex',
          gap:          '16px',
          color:        'var(--hk-fg-muted)',
          fontSize:     '10px',
          opacity:      0.7,
        }}>
          <span>↵ open</span>
          <span>↑↓ navigate</span>
          <span>Tab cycle</span>
          <span>Esc cancel</span>
          <span style={{ marginLeft: 'auto', opacity: 0.5 }}>Ctrl+N/P</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: open FileFinder via DOM event (called from vim ex-commands)
// ---------------------------------------------------------------------------

export function openFileFinder(query = ''): void {
  window.dispatchEvent(new CustomEvent('codeatlas:open-file-finder', { detail: { query } }));
}
