import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppSelector } from '@/store/store';
import { invoke, DesktopOnlyError } from '@/lib/platform';
import { useAsyncResource } from '@/hooks/useAsyncResource';

const CANDIDATE_NAMES = ['README.md', 'README.MD', 'README.markdown', 'readme.md', 'README', 'README.rst', 'README.txt'];

async function probeReadme(root: string): Promise<{ filename: string; source: string }> {
  for (const name of CANDIDATE_NAMES) {
    try {
      const text = await invoke<string>('agent_read_file', { root, path: name });
      return { filename: name, source: text };
    } catch (e) {
      if (e instanceof DesktopOnlyError) throw new Error('README viewer requires the desktop app.');
      // Try the next candidate.
    }
  }
  throw new Error('No README found at the repo root.');
}

/**
 * Local README viewer: probes a small list of candidate filenames at the repo
 * root via `agent_read_file` and renders the first hit with react-markdown.
 */
export default function LocalReadmeTab() {
  const root = useAppSelector((s) => s.localPath) ?? '.';
  const { data, loading, error } = useAsyncResource(() => probeReadme(root), [root], { scope: 'local-readme' });

  if (loading) return <p className="p-4 text-xs text-muted-foreground/60">Loading README…</p>;
  if (error) return <p className="p-4 text-xs text-muted-foreground/60">{error}</p>;
  if (!data) return null;

  const { filename, source } = data;
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
