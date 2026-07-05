import { cn } from '@/lib/utils';
import { getAppState, useAppSelector } from '@/store/store';
import { openPathInNvim } from '@/hooks/useOpenInNvim';

// ─── Universal clickable file path ───────────────────────────────────────────
// Every file mention in the IDE routes through this: for a LOCAL session the
// click opens the file in the session's nvim terminal (same bus as the Files
// tab); for GitHub repos it falls back to the blob URL; otherwise it renders
// as a plain span. Keep children = the visible text (defaults to the path).

export default function FileLink({ path, repoUrl, sha, className, children }: {
  /** Workspace-relative (or absolute-under-root) file path. */
  path: string;
  /** GitHub fallback: repo html url (+ optional commit sha for blob links). */
  repoUrl?: string | null;
  sha?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  // Subscribe narrowly: only re-render when the active session identity flips.
  const activeSessionId = useAppSelector((s) => s.activeSessionId);
  const { sessions } = getAppState();
  const session = sessions.find((s) => s.id === activeSessionId);
  const nvimable = !!session && session.repoSource === 'local' && !!session.cwd;

  if (nvimable) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); openPathInNvim(path); }}
        title={`Open ${path} in nvim`}
        className={cn('font-mono text-left hover:text-primary hover:underline decoration-dotted underline-offset-2 transition-colors', className)}
      >
        {children ?? path}
      </button>
    );
  }
  if (repoUrl) {
    return (
      <a
        href={`${repoUrl}/blob/${sha ?? 'HEAD'}/${path}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={`View ${path} on GitHub`}
        className={cn('font-mono hover:text-primary hover:underline decoration-dotted underline-offset-2', className)}
      >
        {children ?? path}
      </a>
    );
  }
  return <span className={cn('font-mono', className)}>{children ?? path}</span>;
}
