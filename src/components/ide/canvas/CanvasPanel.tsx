import { Suspense, lazy, useEffect, useState } from 'react';
import { Copy, MessageSquareShare, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector } from '@/store/store';
import { invoke, isTauri } from '@/lib/platform';
import {
  createDiagram, deleteDiagram, diagramText, duplicateDiagram, loadDiagrams,
  renameDiagram, useDiagramIndex, useDiagramsLoaded, type DiagramMeta,
} from '@/lib/diagrams/diagramStore';
import { prefillChat } from '@/hooks/useSendToChat';
import { toast } from '@/services/toast';
import type { Project, Session } from '@/types/session';

// ─── Excalidraw workspace (right-column view) ────────────────────────────────
// Project-level diagrams: a list rail + one mounted Excalidraw editor. The
// editor module (and the Excalidraw bundle) is lazy — the app pays for it only
// when a diagram is opened. "Send to agent" serializes the diagram's structure
// into the chat composer, which is the "implement this architecture" flow.

const DiagramFrame = lazy(() => import('./DiagramFrame'));

export default function CanvasPanel({ session }: { session: Session }) {
  const project = useAppSelector(
    (s) => s.projects.find((p) => p.id === session.projectId) ?? null,
  );
  if (!project) {
    return <div className="p-4 text-sm text-muted-foreground">No project for this session.</div>;
  }
  return <CanvasInner project={project} sessionId={session.id} />;
}

function CanvasInner({ project, sessionId }: { project: Project; sessionId: string }) {
  const index = useDiagramIndex(project);
  const loaded = useDiagramsLoaded(project);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => { void loadDiagrams(project); }, [project]);
  // Auto-select the first diagram once loaded.
  useEffect(() => {
    if (loaded && !selectedId && index.length > 0) setSelectedId(index[0].id);
  }, [loaded, selectedId, index]);

  const selected = index.find((m) => m.id === selectedId) ?? null;

  const add = async () => {
    const meta = await createDiagram(project, `Diagram ${index.length + 1}`);
    setSelectedId(meta.id);
  };

  const importScene = async () => {
    if (!isTauri()) { toast.error('Import requires the desktop app'); return; }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, filters: [{ name: 'Excalidraw', extensions: ['excalidraw', 'json'] }] });
    if (!picked || Array.isArray(picked)) return;
    try {
      const data = await invoke<{ base64: string }>('read_attachment', { path: picked, maxBytes: 16 * 1024 * 1024 });
      const json = new TextDecoder().decode(Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)));
      JSON.parse(json); // validate before writing
      const name = picked.split(/[/\\]/).pop()?.replace(/\.(excalidraw|json)$/i, '') ?? 'Imported diagram';
      const meta = await createDiagram(project, name, json);
      setSelectedId(meta.id);
    } catch (e) {
      toast.error('Import failed', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const sendToAgent = async (meta: DiagramMeta) => {
    const text = await diagramText(project, meta.id);
    if (!text) return;
    const prefilled = prefillChat(sessionId, `${text}\n\n`);
    if (prefilled) toast.success('Diagram added to composer', { description: 'Describe what to do with it and send.' });
    else toast.error('Open the chat panel first');
  };

  const commitRename = async (meta: DiagramMeta) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (name && name !== meta.name) await renameDiagram(project, meta.id, name);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      {/* Diagram rail */}
      <div className="w-48 flex-shrink-0 flex flex-col min-h-0 border-r border-border">
        <div className="flex items-center gap-1 p-2 border-b border-border">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 flex-1">Diagrams</span>
          <button
            onClick={() => void importScene()}
            className="p-1 rounded border border-border text-muted-foreground hover:text-foreground"
            title="Import .excalidraw file"
          >
            <Upload className="w-3 h-3" />
          </button>
          <button
            onClick={() => void add()}
            className="p-1 rounded border border-border text-muted-foreground hover:text-foreground"
            title="New diagram"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {!loaded ? (
            <p className="text-[11px] text-muted-foreground/60 p-2">Loading…</p>
          ) : index.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60 p-2">
              No diagrams yet. Sketch architecture, flows, or UI concepts — the agent can read them.
            </p>
          ) : (
            index.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'group flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors',
                  selectedId === m.id ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-accent/30',
                )}
              >
                {renaming === m.id ? (
                  <input
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(m);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="flex-1 min-w-0 bg-muted/30 border border-border rounded px-1 py-0.5 text-[11px] focus:outline-none"
                  />
                ) : (
                  <button className="flex-1 min-w-0 text-left truncate" onClick={() => setSelectedId(m.id)}>
                    {m.name}
                  </button>
                )}
                <span className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={() => void sendToAgent(m)}
                    className="p-0.5 text-muted-foreground hover:text-primary"
                    title="Send structure to the agent composer"
                  >
                    <MessageSquareShare className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => { setRenaming(m.id); setRenameValue(m.name); }}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => void duplicateDiagram(project, m.id)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Duplicate"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      void deleteDiagram(project, m.id);
                      if (selectedId === m.id) setSelectedId(null);
                    }}
                    className="p-0.5 text-muted-foreground hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
        <div className="px-2 py-1.5 border-t border-border text-[9px] text-muted-foreground/50 leading-relaxed">
          Reference in chat with @diagram:&lt;name&gt;. Single-user editing (no live collab).
        </div>
      </div>

      {/* Editor */}
      {selected ? (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading Excalidraw…</div>}>
          <DiagramFrame key={selected.id} project={project} meta={selected} />
        </Suspense>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Create or select a diagram.
        </div>
      )}
    </div>
  );
}
