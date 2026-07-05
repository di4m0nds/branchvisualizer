import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, FolderOpen, History, Pin, PinOff, Plus, Search, Trash2, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector } from '@/store/store';
import { ResizeHandle } from '@/components/workspace/ResizeHandle';
import { loadIdeLayout, saveIdeLayout } from '@/lib/ideLayout';
import { isTauri } from '@/lib/platform';
import { getProjectStore, importAsset, writeExport } from '@/lib/projectStore';
import {
  createNote, deleteNote, loadKb, readNoteBody, saveNote, searchNotes,
  useKbIndex, useKbLoaded, type KbNoteMeta,
} from '@/lib/kb/kbStore';
import { toast } from '@/services/toast';
import NoteEditor from './NoteEditor';
import NoteHistoryDialog from './NoteHistoryDialog';
import type { Project, Session } from '@/types/session';

// ─── Project knowledge base panel (right-column view) ────────────────────────
// Notes live at the PROJECT level: every session of the project sees the same
// set, and the agent references them (@kb: mentions, pinned injection, tools).
// Left rail = folders/search/pinned list; right pane = editor with preview.

export default function KnowledgePanel({ session }: { session: Session }) {
  const project = useAppSelector(
    (s) => s.projects.find((p) => p.id === session.projectId) ?? null,
  );
  if (!project) {
    return <div className="p-4 text-sm text-muted-foreground">No project for this session.</div>;
  }
  return <KnowledgeInner project={project} />;
}

function KnowledgeInner({ project }: { project: Project }) {
  const index = useKbIndex(project);
  const loaded = useKbLoaded(project);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KbNoteMeta[] | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [railWidth, setRailWidth] = useState(() => loadIdeLayout().kbSidebarWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void loadKb(project); }, [project]);

  // Persist the rail width alongside the rest of the IDE layout (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      const disk = loadIdeLayout();
      if (disk.kbSidebarWidth !== railWidth) saveIdeLayout({ ...disk, kbSidebarWidth: railWidth });
    }, 250);
    return () => clearTimeout(t);
  }, [railWidth]);

  // Debounced full-text search (bodies included).
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(() => {
      void searchNotes(project, query).then(setResults);
    }, 150);
    return () => clearTimeout(t);
  }, [query, project]);

  const visible = results ?? index;
  const selected = index.find((n) => n.id === selectedId) ?? null;

  // Group: pinned first, then by folder.
  const grouped = useMemo(() => {
    const pinned = visible.filter((n) => n.pinned);
    const rest = visible.filter((n) => !n.pinned);
    const byFolder = new Map<string, KbNoteMeta[]>();
    for (const n of rest) {
      const key = n.folder || '';
      byFolder.set(key, [...(byFolder.get(key) ?? []), n]);
    }
    return {
      pinned,
      folders: [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [visible]);

  const newNote = async () => {
    const meta = await createNote(project, { title: 'Untitled note' });
    setSelectedId(meta.id);
  };

  const importNote = async () => {
    if (!isTauri()) { toast.error('Import requires the desktop app'); return; }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: true, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
    if (!picked) return;
    for (const path of Array.isArray(picked) ? picked : [picked]) {
      const name = path.split(/[/\\]/).pop()?.replace(/\.(md|markdown|txt)$/i, '') ?? 'Imported note';
      try {
        // Land the file in a temp asset location, read it, then register as a note.
        const tmp = `kb/.import-${Date.now()}.md`;
        await importAsset(project, path, tmp);
        const body = (await getProjectStore(project).read(tmp)) ?? '';
        await getProjectStore(project).remove(tmp);
        const meta = await createNote(project, { title: name, body });
        setSelectedId(meta.id);
      } catch (e) {
        toast.error(`Couldn't import ${name}`, { description: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  const exportNote = async (note: KbNoteMeta) => {
    if (!isTauri()) { toast.error('Export requires the desktop app'); return; }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({ defaultPath: `${note.slug}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!dest) return;
    const body = await readNoteBody(project, note.id);
    await writeExport(dest, body);
    toast.success('Note exported', { description: dest });
  };

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden bg-background">
      {/* ── Left rail: search + note tree ── */}
      <div className="flex flex-col min-h-0 border-r border-border" style={{ flex: `0 0 ${railWidth}%` }}>
        <div className="flex items-center gap-1.5 p-2 border-b border-border">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="w-full pl-7 pr-2 py-1.5 rounded border border-border bg-muted/20 text-[11px] focus:outline-none focus:border-ring"
            />
          </div>
          <button
            onClick={() => void importNote()}
            className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
            title="Import markdown files as notes"
          >
            <Upload className="w-3 h-3" />
          </button>
          <button
            onClick={() => void newNote()}
            className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
            title="New note"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
          {!loaded ? (
            <p className="text-[11px] text-muted-foreground/60 p-2">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="p-2">
              <p className="text-[11px] text-muted-foreground/60">
                {query ? 'No notes match.' : 'No notes yet. Project knowledge lives here — coding standards, architecture decisions, prompts, business context — and every session of this project (and the agent) can use it.'}
              </p>
            </div>
          ) : (
            <>
              {grouped.pinned.length > 0 && (
                <NoteGroup label="Pinned" notes={grouped.pinned} selectedId={selectedId} onSelect={setSelectedId} />
              )}
              {grouped.folders.map(([folder, notes]) => (
                <NoteGroup
                  key={folder || '(root)'}
                  label={folder || 'Notes'}
                  icon={folder ? <FolderOpen className="w-3 h-3" /> : undefined}
                  notes={notes}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </>
          )}
        </div>

        <div className="px-2 py-1.5 border-t border-border text-[10px] text-muted-foreground/50">
          {index.length} note{index.length === 1 ? '' : 's'} · shared across all sessions of {project.name}
        </div>
      </div>

      <ResizeHandle
        direction="h"
        containerRef={containerRef}
        size={railWidth}
        onSizeChange={setRailWidth}
        min={16}
        max={45}
      />

      {/* ── Right pane: editor ── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
              <button
                onClick={() => void saveNote(project, selected.id, { pinned: !selected.pinned })}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors',
                  selected.pinned
                    ? 'border-amber-400/40 text-amber-400 bg-amber-400/10'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
                title={selected.pinned ? 'Unpin (stops auto-injecting into agent turns)' : 'Pin (auto-injects into every agent turn)'}
              >
                {selected.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                {selected.pinned ? 'pinned' : 'pin'}
              </button>
              <span className="text-[10px] font-mono text-muted-foreground/50 truncate">@kb:{selected.slug}</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setHistoryFor(selected.id)}
                  className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground"
                  title="Version history"
                >
                  <History className="w-3 h-3" />
                </button>
                <button
                  onClick={() => void exportNote(selected)}
                  className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground"
                  title="Export as .md"
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  onClick={() => {
                    void deleteNote(project, selected.id);
                    setSelectedId(null);
                  }}
                  className="p-1.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40"
                  title="Delete note"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <NoteEditor key={selected.id} project={project} note={selected} />
            {historyFor && (
              <NoteHistoryDialog
                project={project}
                noteId={historyFor}
                onClose={() => setHistoryFor(null)}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-8 text-center">
            <div>
              <p>Select a note, or create one.</p>
              <p className="text-[11px] text-muted-foreground/60 mt-2 leading-relaxed">
                Pinned notes are injected into every agent turn. Reference any note in chat with
                {' '}<code className="font-mono">@kb:&lt;slug&gt;</code>. On local projects, notes are plain
                markdown under <code className="font-mono">.code-agent/kb/</code> — CLI agents read them as files.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteGroup({ label, icon, notes, selectedId, onSelect }: {
  label: string;
  icon?: React.ReactNode;
  notes: KbNoteMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50">
        {icon}{label}
      </div>
      {notes.map((n) => (
        <button
          key={n.id}
          onClick={() => onSelect(n.id)}
          className={cn(
            'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-[11px] transition-colors',
            selectedId === n.id ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-accent/30',
          )}
        >
          {n.pinned && <Pin className="w-2.5 h-2.5 flex-shrink-0 text-amber-400" />}
          <span className="truncate flex-1">{n.title}</span>
          {n.tags.length > 0 && (
            <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[80px]">
              {n.tags.join(' ')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
