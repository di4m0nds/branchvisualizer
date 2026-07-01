// ─── File tree primitives ──────────────────────────────────────────────────
// Extracted from FilesTab.tsx so the GitHub tree view and the local walk view
// share icons, coloring, and row shape.

import { cn } from '@/lib/utils';

/** Colored file/folder glyph — folder for `tree`, extension-tinted glyph for `blob`. */
export function FileIcon({ name, type }: { name: string; type: 'blob' | 'tree' }) {
  if (type === 'tree') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-amber-400 flex-shrink-0">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
      </svg>
    );
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const extColor: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-400', js: 'text-yellow-400', jsx: 'text-yellow-400',
    json: 'text-green-400', md: 'text-gray-400', css: 'text-pink-400', scss: 'text-pink-400',
    html: 'text-orange-400', py: 'text-blue-300', go: 'text-cyan-400', rs: 'text-orange-500',
    sh: 'text-green-300', yml: 'text-red-400', yaml: 'text-red-400', toml: 'text-red-400',
    pdf: 'text-red-500', docx: 'text-blue-500', doc: 'text-blue-500', txt: 'text-muted-foreground',
  };
  const color = extColor[ext] ?? 'text-muted-foreground';
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className={`${color} flex-shrink-0`}>
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
    </svg>
  );
}

/** A single row inside the tree — click surface + indentation + icon + label. */
export function FileRow({
  name,
  path,
  isDir,
  depth,
  isOpen,
  isActive,
  onClick,
  onOpenInNvim,
  right,
}: {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  isOpen?: boolean;
  isActive?: boolean;
  onClick: () => void;
  onOpenInNvim?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer text-xs',
        'transition-colors',
        isActive ? 'bg-accent/60 text-foreground' : 'hover:bg-accent/25 text-foreground/85',
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      title={path}
    >
      {isDir && (
        <span className={cn('text-[9px] font-mono transition-transform', isOpen ? 'rotate-90' : '')}>▶</span>
      )}
      <FileIcon name={name} type={isDir ? 'tree' : 'blob'} />
      <span className="truncate flex-1 font-mono">{name}</span>
      {onOpenInNvim && !isDir && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenInNvim(); }}
          className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-[9px] font-mono px-1 rounded border border-border text-muted-foreground hover:text-foreground"
          title="Open in nvim"
        >
          nvim
        </button>
      )}
      {right}
    </div>
  );
}
