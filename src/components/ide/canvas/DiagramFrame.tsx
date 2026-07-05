import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Excalidraw, exportToBlob, exportToSvg, serializeAsJSON,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { useAppSelector } from '@/store/store';
import { isTauri } from '@/lib/platform';
import { writeExport } from '@/lib/projectStore';
import { readDiagramScene, writeDiagramScene, type DiagramMeta } from '@/lib/diagrams/diagramStore';
import { toast } from '@/services/toast';
import type { Project } from '@/types/session';

// ─── Excalidraw mount for one diagram ────────────────────────────────────────
// Heavy import — this module is React.lazy'd from CanvasPanel so the main
// bundle never pays for Excalidraw (same pattern as the lazy mermaid block).
// Autosave: onChange → 1s debounce → serializeAsJSON → project asset store.
// Single-user, last-writer-wins (real-time collab needs a sync server and is
// deliberately out of scope).

const AUTOSAVE_MS = 1000;

export default function DiagramFrame({ project, meta }: { project: Project; meta: DiagramMeta }) {
  const theme = useAppSelector((s) => s.theme);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null | 'loading'>('loading');
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the persisted scene once per diagram.
  useEffect(() => {
    let cancelled = false;
    setInitialData('loading');
    void readDiagramScene(project, meta.id).then((raw) => {
      if (cancelled) return;
      if (!raw) { setInitialData(null); return; }
      try {
        const scene = JSON.parse(raw) as ExcalidrawInitialDataState & { appState?: Record<string, unknown> };
        // Volatile view state (collaborators/scroll) is not restored.
        const appState = { ...(scene.appState ?? {}) };
        delete appState.collaborators;
        delete appState.scrollX;
        delete appState.scrollY;
        lastSavedRef.current = raw;
        setInitialData({ elements: scene.elements ?? [], appState, files: scene.files });
      } catch {
        setInitialData(null);
      }
    });
    return () => { cancelled = true; };
  }, [project, meta.id]);

  const scheduleSave = useMemo(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
      // Skip no-op writes (pure view changes serialize identically).
      if (json === lastSavedRef.current) return;
      lastSavedRef.current = json;
      setSaving(true);
      void writeDiagramScene(project, meta.id, json)
        .catch((e) => toast.error('Diagram save failed', { description: e instanceof Error ? e.message : String(e) }))
        .finally(() => setSaving(false));
    }, AUTOSAVE_MS);
  }, [project, meta.id]);

  // Flush pending save on unmount/diagram switch.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const api = apiRef.current;
    if (!api) return;
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
    if (json !== lastSavedRef.current) {
      void writeDiagramScene(project, meta.id, json).catch(() => { /* best effort */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  const exportImage = async (kind: 'png' | 'svg') => {
    const api = apiRef.current;
    if (!api) return;
    if (!isTauri()) { toast.error('Export requires the desktop app'); return; }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({
      defaultPath: `${meta.name.replace(/\s+/g, '-')}.${kind}`,
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    });
    if (!dest) return;
    try {
      if (kind === 'png') {
        const blob = await exportToBlob({
          elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles(),
          mimeType: 'image/png',
        });
        const b64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
        await writeExport(dest, b64, true);
      } else {
        const svg = await exportToSvg({
          elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles(),
        });
        await writeExport(dest, svg.outerHTML);
      }
      toast.success(`Exported ${kind.toUpperCase()}`, { description: dest });
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportScene = async () => {
    const api = apiRef.current;
    if (!api) return;
    if (!isTauri()) { toast.error('Export requires the desktop app'); return; }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({
      defaultPath: `${meta.name.replace(/\s+/g, '-')}.excalidraw`,
      filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
    });
    if (!dest) return;
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
    await writeExport(dest, json);
    toast.success('Diagram exported', { description: dest });
  };

  if (initialData === 'loading') {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading diagram…</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/60 text-[10px] text-muted-foreground">
        <span className="truncate">{meta.name}</span>
        <span className="ml-1 opacity-60">{saving ? 'saving…' : 'autosaves'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => void exportScene()} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent/40">.excalidraw</button>
          <button onClick={() => void exportImage('png')} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent/40">PNG</button>
          <button onClick={() => void exportImage('svg')} className="px-1.5 py-0.5 rounded border border-border hover:bg-accent/40">SVG</button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={initialData ?? undefined}
          onChange={scheduleSave}
          theme={theme === 'dark' ? 'dark' : 'light'}
        />
      </div>
    </div>
  );
}
