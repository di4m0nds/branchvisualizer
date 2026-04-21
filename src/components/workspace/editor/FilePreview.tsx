// apps/branchvisualizer/src/components/workspace/editor/FilePreview.tsx
// Phase 8 -- File preview for Markdown, PDF, DOCX, and images.
//
// Rendering strategy per file type:
//   .md / .mdx   → marked (^18) + DOMPurify sanitisation → dangerouslySetInnerHTML
//   .pdf         → <iframe src="/api/fs/read?path=...&raw=1"> with native renderer
//   .docx / .doc → mammoth.convertToHtml() from base64 + DOMPurify sanitisation
//   images       → <img src="/api/fs/read?path=...&raw=1">
//   unknown      → "Preview unavailable" message

import React, { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// API base
// ---------------------------------------------------------------------------

const API_BASE =
  ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001')
    .replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawUrl(path: string): string {
  return `${API_BASE}/api/fs/read?path=${encodeURIComponent(path)}&raw=1`;
}

function readUrl(path: string): string {
  return `${API_BASE}/api/fs/read?path=${encodeURIComponent(path)}`;
}

function getExt(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp']);
const PDF_EXTS = new Set(['pdf']);
const DOCX_EXTS = new Set(['docx', 'doc']);
const MD_EXTS = new Set(['md', 'mdx', 'markdown']);

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

async function renderMarkdown(content: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import('marked'),
    import('dompurify'),
  ]);
  const raw = await marked(content, { async: false });
  return DOMPurify.sanitize(raw as string, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'strong', 'em', 'code', 'pre', 'blockquote',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
  });
}

// ---------------------------------------------------------------------------
// DOCX renderer
// ---------------------------------------------------------------------------

async function renderDocx(base64Content: string): Promise<string> {
  const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([
    import('mammoth'),
    import('dompurify'),
  ]);

  // Convert base64 → ArrayBuffer
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer });
  return DOMPurify.sanitize(result.value);
}

// ---------------------------------------------------------------------------
// FilePreview props
// ---------------------------------------------------------------------------

interface FilePreviewProps {
  /** Relative path (e.g. "src/README.md") */
  path: string;
  /** Pre-loaded content string (text files) or base64 (docx).
   *  If provided, no additional fetch is needed for text/docx. */
  content?: string;
  /** Language id from Monaco */
  language?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FilePreview({ path, content, language }: FilePreviewProps) {
  const ext = getExt(path);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHtml(null);
    setError(null);
    setLoading(true);

    const run = async () => {
      try {
        if (MD_EXTS.has(ext)) {
          // Use provided content or fetch it
          let md = content;
          if (!md) {
            const res = await fetch(readUrl(path), { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { content: string };
            md = data.content;
          }
          setHtml(await renderMarkdown(md));
        } else if (DOCX_EXTS.has(ext)) {
          // Fetch as base64 (backend returns base64 for .docx/.doc)
          let b64 = content && content !== '[binary]' ? content : null;
          if (!b64) {
            const res = await fetch(readUrl(path), { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { content: string; encoding?: string };
            b64 = data.content;
          }
          if (!b64) throw new Error('No content');
          setHtml(await renderDocx(b64));
        } else {
          // Image / PDF handled via inline rendering — no HTML needed
          setHtml('');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    void run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const container: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
    background: 'var(--bg-primary, #0d0d0f)',
    color: 'var(--text-primary, #e2e8f0)',
  };

  if (loading) {
    return (
      <div style={{ ...container, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #6b7280)' }}>
        Loading preview…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...container, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f85149' }}>
        Preview error: {error}
      </div>
    );
  }

  // PDF — native iframe
  if (PDF_EXTS.has(ext)) {
    return (
      <div style={{ ...container, padding: 0 }}>
        <iframe
          src={rawUrl(path)}
          title={path}
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    );
  }

  // Image — centered img
  if (IMAGE_EXTS.has(ext)) {
    return (
      <div style={{ ...container, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src={rawUrl(path)}
          alt={path}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>
    );
  }

  // Markdown / DOCX — sanitized HTML
  if (html !== null && html !== '') {
    return (
      <div
        style={{
          ...container,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          lineHeight: 1.7,
          maxWidth: '800px',
          margin: '0 auto',
        }}
        className="markdown-preview"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Unknown / empty
  return (
    <div style={{ ...container, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #6b7280)' }}>
      Preview not available for .{ext || 'unknown'} files.
    </div>
  );
}

// Export extension sets for consumers
export { MD_EXTS, PDF_EXTS, DOCX_EXTS, IMAGE_EXTS };
