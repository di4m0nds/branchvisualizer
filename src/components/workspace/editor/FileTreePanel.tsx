// apps/branchvisualizer/src/components/workspace/editor/FileTreePanel.tsx
// Phase 8 -- File-tree sidebar.
// Fetches GET /api/fs/tree with a 30-second in-memory TTL cache.
// Translates opencode file-tree patterns (collapsible, kind indicators,
// indentation formula) into React using existing CodeAtlas patterns.

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { useAppContext } from '@/store/AppContext';

// ---------------------------------------------------------------------------
// API base (mirrors pattern in lib/github.ts)
// ---------------------------------------------------------------------------

const API_BASE =
  ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001')
    .replace(/\/$/, '');

// ---------------------------------------------------------------------------
// FSNode (mirrors backend shape in apps/api/src/routes/fs.ts)
// ---------------------------------------------------------------------------

interface FSNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FSNode[];
}

// ---------------------------------------------------------------------------
// Module-level TTL cache (30 s, in-memory — never localStorage)
// ---------------------------------------------------------------------------

interface CacheEntry {
  nodes: FSNode[];
  expiry: number;
}
const treeCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function cacheGet(root: string): FSNode[] | null {
  const entry = treeCache.get(root);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { treeCache.delete(root); return null; }
  return entry.nodes;
}
function cacheSet(root: string, nodes: FSNode[]): void {
  treeCache.set(root, { nodes, expiry: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Kind / change-indicator helpers (translated from opencode file-tree.tsx)
// ---------------------------------------------------------------------------

export type Kind = 'add' | 'del' | 'mod';

const kindLabel = (k: Kind): string => k === 'add' ? 'A' : k === 'del' ? 'D' : 'M';

const kindColor = (k: Kind): string => {
  if (k === 'add') return '#3fb950';  // green
  if (k === 'del') return '#f85149';  // red
  return '#d29922';                    // yellow
};

// ---------------------------------------------------------------------------
// File-type icon (inline SVGs only — no external library)
// ---------------------------------------------------------------------------

function FileIcon({ ext, style }: { ext: string; style?: React.CSSProperties }) {
  const d = getIconPath(ext);
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16"
      fill="currentColor" aria-hidden="true"
      style={style}
    >
      <path d={d} />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {open
        ? <path d="M1.75 4.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V6.75a.25.25 0 0 0-.25-.25H7.5L5.957 4.957A1.75 1.75 0 0 0 4.72 4.5H1.75z" />
        : <path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.5L5.957 2.957A1.75 1.75 0 0 0 4.72 2.5H1.75z" />
      }
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 16 16"
      fill="currentColor" aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
    >
      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}

function getIconPath(ext: string): string {
  switch (ext) {
    case 'ts': case 'tsx':
      return 'M1.5 2.75A1.25 1.25 0 0 1 2.75 1.5h10.5A1.25 1.25 0 0 1 14.5 2.75v10.5a1.25 1.25 0 0 1-1.25 1.25H2.75a1.25 1.25 0 0 1-1.25-1.25V2.75zm7.25 3v1h1.5v4h1.5V9h.5V5.75H8.75zm-4 0V11h1.5V9.5H7v-1H5.25v-.75H7v-1H5l-1 1h-.25v.25z';
    case 'js': case 'jsx': case 'mjs':
      return 'M2.75 1.5A1.25 1.25 0 0 0 1.5 2.75v10.5A1.25 1.25 0 0 0 2.75 14.5h10.5a1.25 1.25 0 0 0 1.25-1.25V2.75A1.25 1.25 0 0 0 13.25 1.5H2.75zm6 4.25h1.5V10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5.75h1.5V10a.5.5 0 0 0 .5.5h.25a.5.5 0 0 0 .5-.5V5.75z';
    case 'json':
      return 'M2 2.5A2.5 2.5 0 0 1 4.5 0H12a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H4.5A2.5 2.5 0 0 1 2 11.5zm2.5 0A1 1 0 0 0 3.5 3.5v8A1 1 0 0 0 4.5 12.5h7V1.5H4.5z';
    case 'css': case 'scss': case 'less':
      return 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.873 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z';
    case 'html': case 'htm':
      return 'M4.72.22a.75.75 0 0 1 1.06 0L8 2.44l2.22-2.22a.75.75 0 1 1 1.06 1.06L9.06 3.5l2.22 2.22a.75.75 0 1 1-1.06 1.06L8 4.56 5.78 6.78a.75.75 0 0 1-1.06-1.06L6.94 3.5 4.72 1.28a.75.75 0 0 1 0-1.06z';
    case 'md': case 'mdx':
      return 'M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13H14.85c.63 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2zm2.99.5L9.5 8H11V5h2v3h1.5z';
    case 'py':
      return 'M7.987 2.773a5.54 5.54 0 0 0-5.5 5.5v.5h3v-.5a2.5 2.5 0 0 1 2.5-2.5h.5a2.5 2.5 0 0 0 2.5-2.5v-.5h-3zM8 9.227a5.54 5.54 0 0 0 5.5-5.5v-.5h-3v.5A2.5 2.5 0 0 1 8 6.227h-.5a2.5 2.5 0 0 0-2.5 2.5v.5h3z';
    case 'rs':
      return 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z';
    case 'go':
      return 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-6.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5zM8 6a2 2 0 1 1 0 4A2 2 0 0 1 8 6z';
    case 'svg':
      return 'M2.75 1.5A1.25 1.25 0 0 0 1.5 2.75v10.5A1.25 1.25 0 0 0 2.75 14.5h10.5a1.25 1.25 0 0 0 1.25-1.25V2.75A1.25 1.25 0 0 0 13.25 1.5H2.75zM8 4a4 4 0 1 1 0 8A4 4 0 0 1 8 4z';
    case 'yaml': case 'yml': case 'toml':
      return 'M2.5 1.75v11.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V5.5L9.5 1H2.75a.25.25 0 0 0-.25.25zM1 1.75C1 .784 1.784 0 2.75 0H9.5a.75.75 0 0 1 .53.22l4.5 4.5c.141.14.22.331.22.53v9a1.75 1.75 0 0 1-1.75 1.75H2.75A1.75 1.75 0 0 1 1 14.25z';
    case 'sh': case 'bash': case 'zsh':
      return 'M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25zm2.03 2.53 5 5a.75.75 0 0 0 1.06 0l5-5a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 8.689 3.97 4.72a.75.75 0 0 0-1.06 0 .75.75 0 0 0 .12.56z';
    default:
      return 'M2.75 1.5A1.25 1.25 0 0 0 1.5 2.75v10.5A1.25 1.25 0 0 0 2.75 14.5h10.5a1.25 1.25 0 0 0 1.25-1.25V2.75A1.25 1.25 0 0 0 13.25 1.5H2.75zM1 2.75C1 1.784 1.784 1 2.75 1H9.5a.75.75 0 0 1 .53.22l4.5 4.5c.141.14.22.331.22.53v9a1.75 1.75 0 0 1-1.75 1.75H2.75A1.75 1.75 0 0 1 1 14.25z';
  }
}

// ---------------------------------------------------------------------------
// Flatten tree to a flat list for keyboard navigation
// ---------------------------------------------------------------------------

interface FlatNode {
  node: FSNode;
  level: number;
  isExpanded?: boolean;
}

function flatten(
  nodes: FSNode[],
  level: number,
  expanded: Set<string>,
  query: string,
): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    const matchesQuery = !query || node.name.toLowerCase().includes(query.toLowerCase());
    const hasMatchingDescendant = query
      ? hasMatch(node, query)
      : true;
    if (!matchesQuery && !hasMatchingDescendant) continue;

    if (node.type === 'directory') {
      result.push({ node, level, isExpanded: expanded.has(node.path) });
      if (expanded.has(node.path) && node.children) {
        result.push(...flatten(node.children, level + 1, expanded, query));
      }
    } else {
      if (matchesQuery) result.push({ node, level });
    }
  }
  return result;
}

function hasMatch(node: FSNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query.toLowerCase())) return true;
  if (node.children) return node.children.some(c => hasMatch(c, query));
  return false;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FileTreePanelProps {
  kinds?: ReadonlyMap<string, Kind>;
}

export default function FileTreePanel({ kinds }: FileTreePanelProps) {
  const { state, dispatch } = useAppContext();
  const [nodes, setNodes] = useState<FSNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeFilePath = state.openFile?.path ?? null;

  // Fetch tree on mount (with cache)
  useEffect(() => {
    const cached = cacheGet('root');
    if (cached) { setNodes(cached); return; }

    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/fs/tree`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FSNode[]>;
      })
      .then(data => {
        cacheSet('root', data);
        setNodes(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  // Flat list for keyboard navigation
  const flat = useMemo(
    () => flatten(nodes, 0, expanded, query),
    [nodes, expanded, query],
  );

  // Clamp focusIdx when flat changes
  useEffect(() => {
    setFocusIdx(i => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // Open a file by dispatching OPEN_FILE
  const openFile = useCallback(async (node: FSNode) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/fs/read?path=${encodeURIComponent(node.path)}`,
        { credentials: 'include' },
      );
      if (res.status === 415) {
        // Binary file — open in preview mode (base64 path) via raw
        const rawRes = await fetch(
          `${API_BASE}/api/fs/read?path=${encodeURIComponent(node.path)}&raw=1`,
          { credentials: 'include' },
        );
        if (!rawRes.ok) return;
        const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
        dispatch({
          type: 'OPEN_FILE',
          payload: { path: node.path, content: '[binary]', language: ext },
        });
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { path: string; content: string; language: string };
      dispatch({
        type: 'OPEN_FILE',
        payload: { path: data.path, content: data.content, language: data.language },
      });
    } catch {
      // ignore fetch errors silently
    }
  }, [dispatch]);

  // Toggle directory expand/collapse
  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (flat.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx(i => Math.min(i + 1, flat.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx(i => Math.max(i - 1, 0));
        break;
      case 'ArrowRight': {
        e.preventDefault();
        const cur = flat[focusIdx];
        if (cur?.node.type === 'directory' && !expanded.has(cur.node.path)) {
          toggleDir(cur.node.path);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const cur = flat[focusIdx];
        if (cur?.node.type === 'directory' && expanded.has(cur.node.path)) {
          toggleDir(cur.node.path);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const cur = flat[focusIdx];
        if (!cur) break;
        if (cur.node.type === 'directory') toggleDir(cur.node.path);
        else void openFile(cur.node);
        break;
      }
      case '/':
        e.preventDefault();
        searchRef.current?.focus();
        break;
      default:
        break;
    }
  }, [flat, focusIdx, expanded, toggleDir, openFile]);

  // Scroll focused item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-idx]');
    const el = items[focusIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontSize: '12px',
      }}
    >
      {/* Tree header: clarify data source */}
      <div style={{
        padding: '4px 8px 3px',
        borderBottom: '1px solid var(--border-color, #2d2d35)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
          style={{ color: 'var(--text-muted, #6b7280)', flexShrink: 0 }}>
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
        </svg>
        <span style={{
          fontSize: '10px',
          color: 'var(--text-muted, #6b7280)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
          title="Showing the API server's workspace directory (FS_ROOT). GitHub project integration in a future phase."
        >
          Workspace files
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted, #6b7280)', opacity: 0.6, flexShrink: 0 }}
          title="Currently shows the API server's working directory. GitHub project file browsing is planned for a future phase.">
          (local)
        </span>
      </div>

      {/* Search bar */}
      <div style={{ padding: '6px 8px 4px', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: '6px', top: '50%',
            transform: 'translateY(-50%)', pointerEvents: 'none',
            color: 'var(--text-muted, #6b7280)',
          }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
            </svg>
          </span>
          <input
            ref={searchRef}
            type="text"
            placeholder="Filter files…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            style={{
              width: '100%',
              padding: '3px 6px 3px 22px',
              background: 'var(--bg-secondary, #1a1a1f)',
              border: '1px solid var(--border-color, #2d2d35)',
              borderRadius: '4px',
              color: 'var(--text-primary, #e2e8f0)',
              fontSize: '11px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Tree list */}
      <div
        ref={listRef}
        role="tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ flex: 1, overflow: 'auto', outline: 'none' }}
      >
        {loading && (
          <div style={{ padding: '12px 8px', color: 'var(--text-muted, #6b7280)', textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: '12px 8px', color: '#f85149', textAlign: 'center' }}>
            {error}
          </div>
        )}
        {!loading && !error && flat.length === 0 && nodes.length > 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--text-muted, #6b7280)', textAlign: 'center' }}>
            No matches
          </div>
        )}
        {flat.map(({ node, level, isExpanded }, idx) => {
          const isFile = node.type === 'file';
          const isActive = node.path === activeFilePath;
          const isFocused = idx === focusIdx;
          const kind = kinds?.get(node.path);
          const ext = isFile ? (node.name.split('.').pop()?.toLowerCase() ?? '') : '';
          const indent = Math.max(0, 8 + level * 12 - (isFile ? 24 : 4));

          return (
            <div
              key={node.path}
              data-idx={idx}
              role={isFile ? 'treeitem' : 'treeitem'}
              aria-selected={isActive}
              aria-expanded={isFile ? undefined : isExpanded}
              onClick={() => {
                setFocusIdx(idx);
                if (isFile) void openFile(node);
                else toggleDir(node.path);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                paddingLeft: `${indent}px`,
                paddingRight: '6px',
                paddingTop: '1px',
                paddingBottom: '1px',
                height: '22px',
                cursor: 'pointer',
                userSelect: 'none',
                borderRadius: '3px',
                margin: '0 2px',
                background: isActive
                  ? 'var(--bg-active, #1e3a6e)'
                  : isFocused
                    ? 'var(--bg-hover, #1a1a2e)'
                    : 'transparent',
                outline: isFocused ? '1px solid var(--accent, #3b82f6)' : 'none',
                outlineOffset: '-1px',
              }}
            >
              {/* Chevron (directories) or spacer (files) */}
              <span style={{ width: '10px', flexShrink: 0, color: 'var(--text-muted, #6b7280)' }}>
                {!isFile && <ChevronIcon open={!!isExpanded} />}
              </span>

              {/* File/Folder icon */}
              <span style={{ width: '14px', flexShrink: 0, color: kind ? kindColor(kind) : 'var(--text-muted, #6b7280)' }}>
                {isFile
                  ? <FileIcon ext={ext} />
                  : <FolderIcon open={!!isExpanded} />
                }
              </span>

              {/* Name */}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: kind ? kindColor(kind) : (isActive ? '#e2e8f0' : 'var(--text-secondary, #a0aec0)'),
                }}
              >
                {node.name}
              </span>

              {/* Change indicator badge */}
              {kind && (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: kindColor(kind),
                  flexShrink: 0,
                  minWidth: '12px',
                  textAlign: 'right',
                }}>
                  {kindLabel(kind)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}