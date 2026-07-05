import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import DocsMarkdown from '@/components/workspace/DocsMarkdown';
import {
  listVersions, readVersion, restoreVersion, type NoteVersion,
} from '@/lib/kb/kbStore';
import { toast } from '@/services/toast';
import type { Project } from '@/types/session';

// ─── Note version history ────────────────────────────────────────────────────
// Snapshots are written on every body save (desktop only, capped). Pick one to
// preview, restore to make it the current body (the restore itself snapshots
// the present body first, so nothing is lost).

export default function NoteHistoryDialog({ project, noteId, onClose }: {
  project: Project;
  noteId: string;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selected, setSelected] = useState<NoteVersion | null>(null);
  const [previewBody, setPreviewBody] = useState<string>('');

  useEffect(() => {
    void listVersions(project, noteId).then(setVersions);
  }, [project, noteId]);

  useEffect(() => {
    if (!selected) return;
    void readVersion(project, selected.path).then(setPreviewBody);
  }, [project, selected]);

  const restore = async () => {
    if (!selected) return;
    await restoreVersion(project, noteId, selected.path);
    toast.success('Version restored');
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[640px] max-w-[92vw] max-h-[75vh] rounded-lg border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 h-11 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Version history</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-48 flex-shrink-0 border-r border-border overflow-y-auto p-1.5">
            {versions === null ? (
              <p className="text-[11px] text-muted-foreground/60 p-2">Loading…</p>
            ) : versions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 p-2">
                No snapshots yet — one is written each time the body changes. (Browser mode keeps no history.)
              </p>
            ) : (
              versions.map((v) => (
                <button
                  key={v.path}
                  onClick={() => setSelected(v)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded text-[10px] font-mono transition-colors',
                    selected?.path === v.path ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:bg-accent/30',
                  )}
                >
                  {v.modifiedAt ? new Date(v.modifiedAt).toLocaleString() : v.label}
                </button>
              ))
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4">
              {selected ? (
                <DocsMarkdown text={previewBody} />
              ) : (
                <p className="text-[11px] text-muted-foreground/60">Select a snapshot to preview.</p>
              )}
            </div>
            {selected && (
              <div className="px-4 py-2 border-t border-border flex justify-end">
                <button
                  onClick={() => void restore()}
                  className="px-3 py-1.5 rounded border border-primary/40 text-primary bg-primary/10 text-xs hover:bg-primary/20"
                >
                  Restore this version
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
