import { useAppSelector } from '@/store/store';
import { fetchREADME } from '@/lib/github';
import { useAsyncResource } from '@/hooks/useAsyncResource';

export default function ReadmeTab() {
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const theme = useAppSelector((s) => s.theme);

  const { data, loading, error } = useAsyncResource(
    () => fetchREADME(repoInfo!.owner, repoInfo!.repo),
    [repoInfo?.owner, repoInfo?.repo],
    { enabled: !!repoInfo, scope: 'readme' },
  );
  const html = data === '' ? '<p class="no-readme">This repository has no README.</p>' : data;

  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">📄</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L5.44 8 3.72 6.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/>
        </svg>
        <span className="text-xs font-medium text-foreground">README</span>
        {repoInfo && (
          <a
            href={`${repoInfo.url}#readme`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            View on GitHub
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10L10 2M10 2H5M10 2v5"/>
            </svg>
          </a>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
              <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
            </svg>
            Loading README…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {html && !loading && (
          <div
            className={`readme-content px-6 py-6 max-w-4xl mx-auto ${theme === 'light' ? 'readme-light' : 'readme-dark'}`}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        )}
      </div>

      {/* Inline styles for GitHub markdown rendering */}
      <style>{`
        .readme-content { font-size: 14px; line-height: 1.7; color: var(--foreground); }
        .readme-dark { --readme-border: rgba(255,255,255,0.1); --readme-code-bg: rgba(255,255,255,0.05); --readme-blockquote: rgba(255,255,255,0.5); }
        .readme-light { --readme-border: rgba(0,0,0,0.1); --readme-code-bg: rgba(0,0,0,0.04); --readme-blockquote: rgba(0,0,0,0.4); }
        .readme-content h1 { font-size: 1.75em; font-weight: 700; border-bottom: 1px solid var(--readme-border); padding-bottom: 0.3em; margin: 1.2em 0 0.6em; }
        .readme-content h2 { font-size: 1.4em; font-weight: 600; border-bottom: 1px solid var(--readme-border); padding-bottom: 0.3em; margin: 1.2em 0 0.5em; }
        .readme-content h3 { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.4em; }
        .readme-content h4, .readme-content h5, .readme-content h6 { font-size: 1em; font-weight: 600; margin: 0.8em 0 0.3em; }
        .readme-content p { margin: 0 0 1em; }
        .readme-content a { color: #60a5fa; text-decoration: none; }
        .readme-content a:hover { text-decoration: underline; }
        .readme-content code { font-family: "SF Mono","Fira Code",monospace; font-size: 0.875em; background: var(--readme-code-bg); padding: 0.2em 0.4em; border-radius: 4px; }
        .readme-content pre { background: var(--readme-code-bg); border: 1px solid var(--readme-border); border-radius: 6px; padding: 1em; overflow-x: auto; margin: 0 0 1em; }
        .readme-content pre code { background: none; padding: 0; font-size: 0.8em; }
        .readme-content blockquote { border-left: 3px solid var(--readme-blockquote); padding-left: 1em; margin: 0 0 1em; color: var(--readme-blockquote); }
        .readme-content ul, .readme-content ol { padding-left: 1.5em; margin: 0 0 1em; }
        .readme-content li { margin: 0.25em 0; }
        .readme-content table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
        .readme-content th, .readme-content td { border: 1px solid var(--readme-border); padding: 0.5em 0.75em; text-align: left; }
        .readme-content th { font-weight: 600; background: var(--readme-code-bg); }
        .readme-content img { max-width: 100%; border-radius: 4px; }
        .readme-content hr { border: none; border-top: 1px solid var(--readme-border); margin: 1.5em 0; }
        .readme-content .no-readme { color: var(--muted-foreground); font-style: italic; }
        .readme-content details { margin: 0 0 1em; }
        .readme-content summary { cursor: pointer; font-weight: 500; }
      `}</style>
    </div>
  );
}

// Basic HTML sanitization — remove script tags and on* attrs for safety
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}
