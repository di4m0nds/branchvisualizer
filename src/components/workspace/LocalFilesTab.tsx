import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/store/AppContext';
import { invoke, DesktopOnlyError } from '@/lib/platform';
import { FileRow } from './FilesTabPrimitives';
import { openInNvim } from '@/hooks/useOpenInNvim';
import { toast } from '@/services/toast';

interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  depth: number;
}

/**
 * Local working-tree view backed by the Rust `walk_tree` command. Uses the
 * shared FileRow primitives so it looks identical to the GitHub FilesTab.
 * Row click opens the file in the session's nvim terminal (via the
 * useOpenInNvim event bus).
 */
export default function LocalFilesTab() {
  const { state } = useAppContext();
  const root = state.localPath ?? '.';
  const sessionId = state.activeSessionId ?? '__no_session';
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    invoke<TreeEntry[]>('walk_tree', { root, maxDepth: 0 })
      .then((rows) => { if (alive) setEntries(rows); })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof DesktopOnlyError ? 'Files require the desktop app.' : String(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [root]);

  const visible = useMemo(() => {
    // Only render a row when every parent segment is expanded.
    return entries.filter((e) => {
      if (e.depth === 0) return true;
      const segments = e.path.split(/[/\\]/);
      segments.pop();
      let acc = '';
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!expanded.has(acc)) return false;
      }
      return true;
    });
  }, [entries, expanded]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function onRowClick(entry: TreeEntry) {
    if (entry.isDir) { toggle(entry.path); return; }
    openInNvim(sessionId, entry.path);
    toast.info(`Opening ${entry.name} in nvim…`);
  }

  if (loading) return <Placeholder text="Loading working tree…" />;
  if (error) return <Placeholder text={error} />;
  if (entries.length === 0) return <Placeholder text="Empty directory." />;

  return (
    <div className="h-full overflow-y-auto py-1">
      {visible.map((e) => (
        <FileRow
          key={e.path}
          name={e.name}
          path={e.path}
          isDir={e.isDir}
          depth={e.depth}
          isOpen={expanded.has(e.path)}
          onClick={() => onRowClick(e)}
          onOpenInNvim={() => openInNvim(sessionId, e.path)}
        />
      ))}
      {entries.length >= 5000 && (
        <div className="px-3 py-2 text-[10px] text-muted-foreground/60 italic border-t border-border/30">
          walk truncated at 5000 entries — narrow the root for more depth.
        </div>
      )}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 text-center px-4">
      {text}
    </div>
  );
}
