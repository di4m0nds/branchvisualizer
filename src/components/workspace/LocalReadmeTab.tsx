import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppContext } from '@/store/AppContext';
import { invoke, DesktopOnlyError } from '@/lib/platform';

const CANDIDATE_NAMES = ['README.md', 'README.MD', 'README.markdown', 'readme.md', 'README', 'README.rst', 'README.txt'];

/**
 * Local README viewer: probes a small list of candidate filenames at the repo
 * root via `agent_read_file` and renders the first hit with react-markdown.
 */
export default function LocalReadmeTab() {
  const { state } = useAppContext();
  const root = state.localPath ?? '.';
  const [source, setSource] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('README.md');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSource(null);
    setError(null);
    (async () => {
      for (const name of CANDIDATE_NAMES) {
        try {
          const text = await invoke<string>('agent_read_file', { root, path: name });
          if (!alive) return;
          setFilename(name);
          setSource(text);
          setLoading(false);
          return;
        } catch (e) {
          if (e instanceof DesktopOnlyError) {
            if (alive) { setError('README viewer requires the desktop app.'); setLoading(false); }
            return;
          }
          // Try the next candidate.
        }
      }
      if (alive) { setError('No README found at the repo root.'); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [root]);

  if (loading) return <p className="p-4 text-xs text-muted-foreground/60">Loading README…</p>;
  if (error) return <p className="p-4 text-xs text-muted-foreground/60">{error}</p>;
  if (!source) return null;

  const isMarkdown = /\.(md|markdown|MD)$/.test(filename) || filename === 'README';
  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider mb-3">{filename}</div>
      {isMarkdown ? (
        <article className="prose prose-invert max-w-none prose-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
        </article>
      ) : (
        <pre className="text-xs font-mono whitespace-pre-wrap">{source}</pre>
      )}
    </div>
  );
}
