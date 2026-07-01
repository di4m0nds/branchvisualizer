import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppContext } from '@/store/AppContext';
import { invoke, DesktopOnlyError } from '@/lib/platform';
import { FileRow } from './FilesTabPrimitives';
import { openInNvim } from '@/hooks/useOpenInNvim';

interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  depth: number;
}

const DOC_EXTS = ['md', 'markdown', 'rst', 'txt', 'org', 'adoc', 'pdf', 'docx', 'doc'];

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

// ─── Viewers ─────────────────────────────────────────────────────────────────

function MarkdownViewer({ text }: { text: string }) {
  return (
    <article className="prose prose-invert max-w-none prose-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </article>
  );
}
function TextViewer({ text }: { text: string }) {
  return <pre className="text-xs font-mono whitespace-pre-wrap">{text}</pre>;
}

function DocxViewer({ base64 }: { base64: string }) {
  const [html, setHtml] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Lazy-load mammoth so its bundle isn't paid until a docx is opened.
        const mammoth = await import('mammoth');
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
        if (alive) setHtml(result.value);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [base64]);
  if (err) return <p className="text-xs text-red-400">Failed to render docx: {err}</p>;
  return <div className="prose prose-invert max-w-none prose-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

function PdfViewer({ base64 }: { base64: string }) {
  const [pageCount, setPageCount] = useState<number>(0);
  const [current, setCurrent] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);
  const canvasId = useMemo(() => `pdf-${Math.floor(Math.random() * 1e9)}`, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Configure a fake worker inline — good enough for viewer use here.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (!alive) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(current);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [base64, current, canvasId]);

  if (err) return <p className="text-xs text-red-400">Failed to render PDF: {err}</p>;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <button
          disabled={current <= 1}
          onClick={() => setCurrent((c) => Math.max(1, c - 1))}
          className="px-2 py-0.5 rounded border border-border disabled:opacity-40"
        >prev</button>
        <span>page {current} / {pageCount || '?'}</span>
        <button
          disabled={pageCount > 0 && current >= pageCount}
          onClick={() => setCurrent((c) => c + 1)}
          className="px-2 py-0.5 rounded border border-border disabled:opacity-40"
        >next</button>
      </div>
      <canvas id={canvasId} className="max-w-full border border-border rounded" />
    </div>
  );
}

// ─── Docs tab ────────────────────────────────────────────────────────────────

export default function LocalDocsTab() {
  const { state } = useAppContext();
  const root = state.localPath ?? '.';
  const sessionId = state.activeSessionId ?? '__no_session';
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<TreeEntry | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [viewerErr, setViewerErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    invoke<TreeEntry[]>('walk_tree', { root, maxDepth: 0 })
      .then((rows) => { if (alive) setEntries(rows.filter((e) => !e.isDir && DOC_EXTS.includes(extOf(e.name)))); })
      .catch((e) => { if (alive) setError(e instanceof DesktopOnlyError ? 'Docs require the desktop app.' : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [root]);

  useEffect(() => {
    if (!active) { setText(null); setBase64(null); return; }
    let alive = true;
    setViewerErr(null); setText(null); setBase64(null);
    const ext = extOf(active.name);
    (async () => {
      try {
        if (['md', 'markdown', 'rst', 'txt', 'org', 'adoc'].includes(ext)) {
          const t = await invoke<string>('agent_read_file', { root, path: active.path });
          if (alive) setText(t);
        } else if (ext === 'pdf' || ext === 'docx') {
          const b64 = await invoke<string>('agent_read_file_bytes', { root, path: active.path });
          if (alive) setBase64(b64);
        } else if (ext === 'doc') {
          if (alive) setViewerErr('Legacy .doc — use nvim or a native viewer.');
        }
      } catch (e) {
        if (alive) setViewerErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [active, root]);

  if (loading) return <Placeholder text="Scanning for docs…" />;
  if (error) return <Placeholder text={error} />;
  if (entries.length === 0) return <Placeholder text="No markdown / pdf / docx / txt files found." />;

  return (
    <div className="h-full flex overflow-hidden">
      {/* Document list */}
      <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto py-1">
        {entries.map((e) => (
          <FileRow
            key={e.path}
            name={e.name}
            path={e.path}
            isDir={false}
            depth={0}
            isActive={active?.path === e.path}
            onClick={() => setActive(e)}
            onOpenInNvim={() => openInNvim(sessionId, e.path)}
          />
        ))}
      </div>

      {/* Viewer */}
      <div className="flex-1 min-w-0 overflow-auto p-6">
        {!active && <p className="text-xs text-muted-foreground/60">Select a document.</p>}
        {active && (
          <>
            <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span>{active.path}</span>
              <button
                onClick={() => openInNvim(sessionId, active.path)}
                className="ml-auto px-1.5 py-0.5 rounded border border-border text-[9px] hover:text-foreground"
              >
                open in nvim
              </button>
            </div>
            {viewerErr && <p className="text-xs text-red-400">{viewerErr}</p>}
            {text && ['md', 'markdown', 'org', 'adoc'].includes(extOf(active.name)) && <MarkdownViewer text={text} />}
            {text && ['txt', 'rst'].includes(extOf(active.name)) && <TextViewer text={text} />}
            {base64 && extOf(active.name) === 'pdf' && <PdfViewer base64={base64} />}
            {base64 && extOf(active.name) === 'docx' && <DocxViewer base64={base64} />}
          </>
        )}
      </div>
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
