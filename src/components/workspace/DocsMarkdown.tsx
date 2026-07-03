import { Component, memo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import CodeFrame from '@/components/agent/CodeFrame';

// Doc-scale sibling of components/agent/Markdown.tsx. Same react-markdown +
// remark-gfm foundation; heading hierarchy is real (not degraded to bold),
// body text is larger, list/table spacing is more generous. Fenced code
// blocks reuse the chat's CodeFrame so syntax highlighting, copy button and
// language badge look identical across chat and docs. Mermaid fences
// (```mermaid``` blocks) render as SVG via lazy-loaded mermaid; a bad fence
// falls back to a plain <pre> so a diagram error never blanks the doc.

function langOf(className?: string): string | undefined {
  const m = /language-(\w+)/.exec(className || '');
  return m?.[1];
}

// ── Mermaid ────────────────────────────────────────────────────────────────
// Lazy-init so the ~1 MB mermaid bundle isn't paid until a diagram fence is
// actually seen. Init happens once per app lifetime; render is instance-scoped
// with a unique id.
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      return m.default;
    });
  }
  return mermaidInitPromise;
}

let mermaidCounter = 0;
function nextMermaidId(): string {
  mermaidCounter += 1;
  return `docs-mermaid-${mermaidCounter}`;
}

export function MermaidBlock({ code }: { code: string }) {
  const [id] = useState(nextMermaidId);
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setErr(null);
    setSvg(null);
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, code);
        if (alive) setSvg(svg);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [code, id]);

  if (err) {
    return (
      <div className="my-3 rounded-md border border-red-500/40 bg-red-500/5 p-2.5 text-xs">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-red-400/80">mermaid error</div>
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-red-300/90">{err}</pre>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{code}</pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 rounded-md border border-border/60 bg-muted/10 p-2.5 text-[11px] text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="my-3 flex justify-center rounded-md border border-border/60 bg-muted/10 p-3 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Component overrides ────────────────────────────────────────────────────

const COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const lang = langOf(className);
    const text = String(children).replace(/\n$/, '');
    if (lang === 'mermaid') {
      return <MermaidBlock code={text} />;
    }
    if (lang || text.includes('\n')) {
      return <CodeFrame code={text} lang={lang} className="my-3" />;
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground" {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    // CodeFrame provides its own frame; unwrap the wrapping <pre> so we don't
    // stack two blocks.
    return <>{children}</>;
  },
  p({ children }) {
    return <p className="leading-relaxed my-2 text-foreground/90">{children}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic">{children}</em>;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
        {children}
      </a>
    );
  },
  ul({ children }) {
    return <ul className="list-disc pl-6 space-y-1 my-2">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-6 space-y-1 my-2">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="text-2xl font-bold text-foreground mt-6 mb-3 pb-1.5 border-b border-border/60">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-xl font-semibold text-foreground mt-5 mb-2.5 pb-1 border-b border-border/40">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-lg font-semibold text-foreground mt-4 mb-2">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-base font-semibold text-foreground mt-3 mb-1.5">{children}</h4>;
  },
  h5({ children }) {
    return <h5 className="text-sm font-semibold text-foreground/90 mt-3 mb-1">{children}</h5>;
  },
  h6({ children }) {
    return <h6 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-3 mb-1">{children}</h6>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-4 border-primary/40 bg-muted/10 pl-4 pr-3 py-2 text-foreground/85 italic">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-6 border-t border-border/50" />;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-md border border-border/60">
        <table className="w-full text-[13.5px] border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-muted/40">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }) {
    return <tr>{children}</tr>;
  },
  th({ children, style }) {
    return (
      <th style={style} className="text-left font-semibold text-foreground px-3 py-2 border-b border-border/60 whitespace-nowrap">
        {children}
      </th>
    );
  },
  td({ children, style }) {
    return (
      <td style={style} className="px-3 py-2 border-b border-border/40 align-top">
        {children}
      </td>
    );
  },
  img({ src, alt }) {
    return <img src={src} alt={alt} className="my-3 max-w-full rounded-md border border-border/60" />;
  },
};

// A malformed doc should never blank the panel; fall back to raw text.
class MarkdownBoundary extends Component<{ raw: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { raw: string }) {
    if (prev.raw !== this.props.raw && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) {
      return <pre className="whitespace-pre-wrap font-mono text-[12px] text-foreground/85">{this.props.raw}</pre>;
    }
    return this.props.children;
  }
}

const DocsMarkdown = memo(function DocsMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-[13.5px] text-foreground/90 max-w-3xl', className)}>
      <MarkdownBoundary raw={text}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {text}
        </ReactMarkdown>
      </MarkdownBoundary>
    </div>
  );
});

export default DocsMarkdown;
