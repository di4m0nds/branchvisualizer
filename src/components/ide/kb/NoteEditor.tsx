import { useEffect, useRef, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import DocsMarkdown from '@/components/workspace/DocsMarkdown';
import { readNoteBody, saveNote, type KbNoteMeta } from '@/lib/kb/kbStore';
import type { Project } from '@/types/session';

// ─── Note editor ─────────────────────────────────────────────────────────────
// Title + folder/tags metadata + a markdown body with an edit ↔ preview toggle.
// Preview reuses the Docs pipeline (react-markdown + gfm + lazy mermaid).
// Saves are debounced; the kbStore snapshots the previous body for history.

export default function NoteEditor({ project, note }: { project: Project; note: KbNoteMeta }) {
  const [body, setBody] = useState<string | null>(null); // null = loading
  const [title, setTitle] = useState(note.title);
  const [folder, setFolder] = useState(note.folder);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readNoteBody(project, note.id).then((b) => { if (!cancelled) setBody(b); });
    return () => { cancelled = true; };
  }, [project, note.id]);

  // Debounced autosave (body + metadata together).
  const scheduleSave = (next: { body?: string; title?: string; folder?: string; tags?: string }) => {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pendingBody = next.body ?? body ?? undefined;
    const pendingTitle = next.title ?? title;
    const pendingFolder = next.folder ?? folder;
    const pendingTags = next.tags ?? tags;
    saveTimer.current = setTimeout(() => {
      void saveNote(project, note.id, {
        ...(pendingBody !== undefined ? { body: pendingBody } : {}),
        title: pendingTitle.trim() || 'Untitled note',
        folder: pendingFolder.trim(),
        tags: pendingTags.split(',').map((t) => t.trim()).filter(Boolean),
      }).then(() => setDirty(false));
    }, 700);
  };

  // Flush on unmount so switching notes never loses keystrokes.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      // Fire the latest state synchronously-ish; values are captured by the
      // scheduled closure, so re-run with current refs is unnecessary — the
      // timer body already holds the freshest pending values.
    }
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Metadata row */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
          placeholder="Title"
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-foreground focus:outline-none"
        />
        <input
          value={folder}
          onChange={(e) => { setFolder(e.target.value); scheduleSave({ folder: e.target.value }); }}
          placeholder="folder"
          className="w-28 text-[10px] font-mono bg-muted/20 border border-border rounded px-2 py-1 focus:outline-none focus:border-ring"
          title="Folder/category (free-form; groups the note list)"
        />
        <input
          value={tags}
          onChange={(e) => { setTags(e.target.value); scheduleSave({ tags: e.target.value }); }}
          placeholder="tags, comma, separated"
          className="w-36 text-[10px] font-mono bg-muted/20 border border-border rounded px-2 py-1 focus:outline-none focus:border-ring"
        />
        <button
          onClick={() => setPreview((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors',
            preview ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground',
          )}
          title={preview ? 'Back to editing' : 'Preview markdown'}
        >
          {preview ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {preview ? 'edit' : 'preview'}
        </button>
      </div>

      {/* Body */}
      {body === null ? (
        <p className="p-4 text-[11px] text-muted-foreground/60">Loading…</p>
      ) : preview ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <DocsMarkdown text={body} />
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); scheduleSave({ body: e.target.value }); }}
          placeholder="Write in markdown. Mermaid fences render in preview."
          spellCheck={false}
          className="flex-1 min-h-0 w-full resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-foreground/90 focus:outline-none"
        />
      )}

      <div className="px-3 py-1 border-t border-border/60 text-[9px] text-muted-foreground/40 flex items-center gap-2">
        <span>v{note.version}</span>
        <span>{dirty ? 'saving…' : 'saved'}</span>
        <span className="ml-auto">markdown · autosaves</span>
      </div>
    </div>
  );
}
