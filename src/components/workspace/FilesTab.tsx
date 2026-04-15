import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/store/AppContext';
import { fetchFileTree, type FileNode } from '@/lib/github';
import { setToken } from '@/lib/github';

// ─── File icon ────────────────────────────────────────────────────────────

function FileIcon({ name, type }: { name: string; type: 'blob' | 'tree' }) {
  if (type === 'tree') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-amber-400 flex-shrink-0">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
      </svg>
    );
  }

  // File icon colored by extension
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const extColor: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-400', js: 'text-yellow-400', jsx: 'text-yellow-400',
    json: 'text-green-400', md: 'text-gray-400', css: 'text-pink-400', scss: 'text-pink-400',
    html: 'text-orange-400', py: 'text-blue-300', go: 'text-cyan-400', rs: 'text-orange-500',
    sh: 'text-green-300', yml: 'text-red-400', yaml: 'text-red-400', toml: 'text-red-400',
  };
  const color = extColor[ext] ?? 'text-muted-foreground';

  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className={`${color} flex-shrink-0`}>
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/>
    </svg>
  );
}

// ─── File node row ─────────────────────────────────────────────────────────

function FileRow({
  node,
  depth,
  repoUrl,
  defaultBranch,
}: {
  node: FileNode;
  depth: number;
  repoUrl: string;
  defaultBranch: string;
}) {
  const [open, setOpen] = useState(depth < 1); // auto-open root level trees

  const ghUrl = `${repoUrl}/blob/${defaultBranch}/${node.path}`;
  const ghTreeUrl = `${repoUrl}/tree/${defaultBranch}/${node.path}`;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 px-2 rounded hover:bg-accent/50 cursor-pointer group
                   text-xs text-foreground/80 hover:text-foreground transition-colors"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (node.type === 'tree') setOpen(o => !o);
        }}
      >
        {/* Expand chevron for directories */}
        {node.type === 'tree' && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          >
            <path d="M3 2l4 3-4 3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {node.type === 'blob' && <span className="w-[10px] flex-shrink-0" />}

        <FileIcon name={node.name} type={node.type} />
        <span className="flex-1 min-w-0 truncate font-mono">{node.name}</span>

        {/* Size for blobs */}
        {node.type === 'blob' && node.size != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100 flex-shrink-0">
            {formatSize(node.size)}
          </span>
        )}

        {/* External link */}
        <a
          href={node.type === 'blob' ? ghUrl : ghTreeUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex-shrink-0 transition-opacity"
          title="View on GitHub"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        </a>
      </div>

      {/* Children */}
      {node.type === 'tree' && open && node.children && (
        <div>
          {node.children.map(child => (
            <FileRow
              key={child.path}
              node={child}
              depth={depth + 1}
              repoUrl={repoUrl}
              defaultBranch={defaultBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ─── Main component ────────────────────────────────────────────────────────

export default function FilesTab() {
  const { state } = useAppContext();
  const { repoInfo, token } = state;

  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repoInfo) return;
    const key = `${repoInfo.owner}/${repoInfo.repo}`;
    if (loadedForRef.current === key) return;
    loadedForRef.current = key;

    setToken(token);
    setLoading(true);
    setError(null);

    // Fetch the default branch's tree SHA first, then the full tree
    const run = async () => {
      const res = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${repoInfo.defaultBranch}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`Failed to fetch branch info (${res.status})`);
      const data = await res.json();
      const treeSha: string = data.commit.commit.tree.sha;
      const nodes = await fetchFileTree(repoInfo.owner, repoInfo.repo, treeSha);
      setTree(nodes);
    };

    run()
      .catch(e => { setError(e.message); loadedForRef.current = null; })
      .finally(() => setLoading(false));
  }, [repoInfo, token]);

  // Flat search results
  const searchResults = search.trim()
    ? flattenTree(tree ?? []).filter(n =>
        n.name.toLowerCase().includes(search.toLowerCase()) ||
        n.path.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 100)
    : null;

  if (!repoInfo) return <EmptyState />;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Search bar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-muted/20">
        <input
          type="search"
          placeholder="Search files…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground
                     border border-border rounded px-2 py-1 focus:outline-none focus:border-ring"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
              <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
            </svg>
            Loading file tree…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground">
              {!token && 'Adding a GitHub token may help with rate limits or private repos.'}
            </p>
          </div>
        )}

        {!loading && !error && tree && searchResults === null && (
          tree.map(node => (
            <FileRow
              key={node.path}
              node={node}
              depth={0}
              repoUrl={repoInfo.url}
              defaultBranch={repoInfo.defaultBranch}
            />
          ))
        )}

        {!loading && !error && searchResults !== null && (
          searchResults.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              No files match "{search}"
            </div>
          ) : (
            searchResults.map(node => (
              <div key={node.path}
                className="flex items-center gap-2 py-1 px-3 hover:bg-accent/50 rounded cursor-pointer
                           text-xs font-mono text-foreground/80 hover:text-foreground"
              >
                <FileIcon name={node.name} type={node.type} />
                <span className="flex-1 min-w-0 truncate">{node.path}</span>
                <a
                  href={`${repoInfo.url}/blob/${repoInfo.defaultBranch}/${node.path}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 flex-shrink-0"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 10L10 2M10 2H5M10 2v5"/>
                  </svg>
                </a>
              </div>
            ))
          )
        )}
      </div>

      {/* Footer stats */}
      {tree && !loading && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-border bg-muted/20
                        text-[10px] text-muted-foreground flex items-center gap-2">
          <span>{countFiles(tree).toLocaleString()} files</span>
          <span className="opacity-40">·</span>
          <span>{countDirs(tree).toLocaleString()} directories</span>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
      <span className="text-3xl opacity-20">📂</span>
      <span className="text-sm">No repository loaded</span>
    </div>
  );
}

function flattenTree(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) result.push(...flattenTree(node.children));
  }
  return result;
}

function countFiles(nodes: FileNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'blob') count++;
    else if (n.children) count += countFiles(n.children);
  }
  return count;
}

function countDirs(nodes: FileNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'tree') { count++; if (n.children) count += countDirs(n.children); }
  }
  return count;
}
