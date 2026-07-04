import { useState } from 'react';
import type { CommitFile } from '@/lib/github';

// ─── File status icon ─────────────────────────────────────────────────────────

function FileStatusDot({ status }: { status: CommitFile['status'] }) {
  const cfg = {
    added: { cls: 'bg-green-400', title: 'Added' },
    removed: { cls: 'bg-red-400', title: 'Removed' },
    modified: { cls: 'bg-amber-400', title: 'Modified' },
    renamed: { cls: 'bg-blue-400', title: 'Renamed' },
    copied: { cls: 'bg-sky-400', title: 'Copied' },
    changed: { cls: 'bg-amber-400', title: 'Changed' },
    unchanged: { cls: 'bg-muted-foreground/30', title: 'Unchanged' },
  } as const;
  const { cls, title } = cfg[status] ?? cfg.modified;
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} title={title} />;
}

// ─── Changed files list ───────────────────────────────────────────────────────

export default function FilesList({ files, repoUrl, sha }: { files: CommitFile[]; repoUrl: string | null; sha: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? files : files.slice(0, 8);
  const hidden = files.length - 8;

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map(f => {
        const displayName = f.status === 'renamed' && f.previousFilename
          ? `${f.previousFilename} → ${f.filename.split('/').pop()}`
          : f.filename;
        const fileUrl = repoUrl ? `${repoUrl}/blob/${sha}/${f.filename}` : null;

        return (
          <div key={f.filename} className="flex items-center gap-1.5 min-w-0 group">
            <FileStatusDot status={f.status} />
            {fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground
                           truncate hover:text-foreground transition-colors"
                title={f.filename}
              >
                {displayName}
              </a>
            ) : (
              <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate" title={f.filename}>
                {displayName}
              </span>
            )}
            {(f.additions > 0 || f.deletions > 0) && (
              <span className="flex-shrink-0 text-[10px] font-mono tabular-nums flex items-center gap-0.5">
                {f.additions > 0 && <span className="text-green-400">+{f.additions}</span>}
                {f.deletions > 0 && <span className="text-red-400">-{f.deletions}</span>}
              </span>
            )}
          </div>
        );
      })}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="self-start text-[10px] text-muted-foreground hover:text-foreground
                     transition-colors mt-0.5 flex items-center gap-0.5"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
          {hidden} more file{hidden !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
