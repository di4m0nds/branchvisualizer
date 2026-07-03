import { Component, memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import CodeFrame from './CodeFrame';

// Lightweight markdown for assistant prose only. Deliberately constrained to
// bold/italic, inline code, links, lists, and fenced code blocks — headings,
// tables, images, and blockquotes degrade to plain/minimal renders so chat
// prose never turns into a document. Safe to render on partial/streaming text.

// If the stream is mid-fence (an odd number of ``` markers), append a synthetic
// closing fence so the partial code renders in a stable closed frame instead of
// flickering as the rest of the message opens/closes a code block.
function balanceFences(text: string): string {
  const fences = (text.match(/```/g) || []).length;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function langOf(className?: string): string | undefined {
  const m = /language-(\w+)/.exec(className || '');
  return m?.[1];
}

const COMPONENTS: Components = {
  // Fenced blocks arrive as <code class="language-x">; inline code has no class.
  code({ className, children, ...props }) {
    const lang = langOf(className);
    if (lang || String(children).includes('\n')) {
      return <CodeFrame code={String(children).replace(/\n$/, '')} lang={lang} className="my-1.5" />;
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground" {...props}>
        {children}
      </code>
    );
  },
  // react-markdown wraps fenced code in <pre>; CodeFrame already provides one.
  pre({ children }) {
    return <>{children}</>;
  },
  p({ children }) {
    return <p className="whitespace-pre-wrap leading-relaxed">{children}</p>;
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
    return <ul className="list-disc pl-5 space-y-0.5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  // Heavy nodes degrade to plain text so prose stays "lightweight".
  h1: PlainHeading, h2: PlainHeading, h3: PlainHeading,
  h4: PlainHeading, h5: PlainHeading, h6: PlainHeading,
  blockquote({ children }) {
    return <div className="border-l-2 border-border pl-2.5 text-muted-foreground">{children}</div>;
  },
};

function PlainHeading({ children }: { children?: ReactNode }) {
  return <p className="font-semibold text-foreground">{children}</p>;
}

// A malformed partial should never blank the bubble; fall back to raw text.
class MarkdownBoundary extends Component<{ raw: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { raw: string }) {
    if (prev.raw !== this.props.raw && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) {
      return <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{this.props.raw}</p>;
    }
    return this.props.children;
  }
}

// Memoized on `text`/`className`: settled prose never re-parses through
// react-markdown when an unrelated sibling block updates during streaming.
const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-sm text-foreground/90 space-y-1.5', className)}>
      <MarkdownBoundary raw={text}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {balanceFences(text)}
        </ReactMarkdown>
      </MarkdownBoundary>
    </div>
  );
});

export default Markdown;
