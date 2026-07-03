import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Highlight, themes, type Language } from 'prism-react-renderer';
import { cn } from '@/lib/utils';
import { toast } from '@/services/toast';

// Shared dark code frame with a copy-to-clipboard affordance and Prism syntax
// highlighting. Used by fenced markdown code blocks and the raw
// <code_file>/<code_diff> renderers so their look and copy behavior stay
// identical.

// Normalize the fence's language token to a Prism language id. Unknown ids are
// passed through — Prism renders them uncolored rather than throwing.
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  py: 'python', rs: 'rust', yml: 'yaml', md: 'markdown', kt: 'kotlin',
  'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rb: 'ruby', golang: 'go',
};

function prismLang(lang?: string): Language {
  const key = (lang ?? '').trim().toLowerCase();
  return (LANG_ALIASES[key] ?? key ?? 'text') as Language;
}

export default function CodeFrame({
  code, lang, className,
}: {
  code: string;
  lang?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className={cn('group relative rounded-md border border-border bg-[#0a0a0a] overflow-hidden', className)}>
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-white/5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#71717a]">
          {lang || 'code'}
        </span>
        <button
          onClick={copy}
          title="Copy"
          className="flex items-center gap-1 text-[10px] text-[#a1a1aa] hover:text-white transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <Highlight theme={themes.vsDark} code={code.replace(/\n$/, '')} language={prismLang(lang)}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className="px-2.5 py-2 text-[11px] font-mono whitespace-pre overflow-auto max-h-80"
            style={{ ...style, background: 'transparent', margin: 0 }}
          >
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps}>
                  {line.map((token, key) => {
                    const tokenProps = getTokenProps({ token });
                    return <span key={key} {...tokenProps} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
