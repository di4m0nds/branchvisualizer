// apps/branchvisualizer/src/components/workspace/editor/VimStatusBar.tsx
// Phase 8 -- Vim mode status bar.
//
// Architecture:
//   MonacoEditor.tsx creates the statusBarNode (HTMLDivElement) and calls
//   initVimMode(editor, statusBarNode) on it. This component simply mounts
//   that DOM node into a styled React container so it appears below the editor.
//
// It also listens for codeatlas:vim-enabled / codeatlas:vim-disabled custom
// events dispatched by MonacoEditor to update the mode badge.

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// VimStatusBar
// Renders the raw statusBarNode DOM element (managed by monaco-vim) inside
// a styled container plus a coloured mode badge.
// ---------------------------------------------------------------------------

export default function VimStatusBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState('NORMAL');
  const [active, setActive] = useState(false);

  // Attach the monaco-vim statusBarNode into our container whenever it appears
  const attachNode = () => {
    const node = window.__codeatlasVimMode?.statusBarNode;
    if (!node || !containerRef.current) return;
    // Move the raw DOM node into our container (monaco-vim updates it in place)
    if (!containerRef.current.contains(node)) {
      containerRef.current.textContent = '';
      containerRef.current.appendChild(node);
    }
  };

  useEffect(() => {
    // Listen for vim enable/disable events from MonacoEditor
    const onEnabled = (e: Event) => {
      setActive(true);
      setMode('NORMAL');
      const detail = (e as CustomEvent).detail as { statusBarNode?: HTMLDivElement };
      if (detail?.statusBarNode && containerRef.current) {
        containerRef.current.textContent = '';
        containerRef.current.appendChild(detail.statusBarNode);
      }
    };
    const onDisabled = () => {
      setActive(false);
      setMode('NORMAL');
      if (containerRef.current) containerRef.current.textContent = '';
    };
    const onReady = () => {
      // Auto-attach if vim was pre-enabled
      if (window.__codeatlasVimMode?.isEnabled()) {
        setActive(true);
        attachNode();
      }
    };

    window.addEventListener('codeatlas:vim-enabled', onEnabled);
    window.addEventListener('codeatlas:vim-disabled', onDisabled);
    window.addEventListener('codeatlas:editor-ready', onReady);

    // Check if already active (e.g. after hot-reload)
    if (window.__codeatlasVimMode?.isEnabled()) {
      setActive(true);
      attachNode();
    }

    return () => {
      window.removeEventListener('codeatlas:vim-enabled', onEnabled);
      window.removeEventListener('codeatlas:vim-disabled', onDisabled);
      window.removeEventListener('codeatlas:editor-ready', onReady);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch containerRef for mode text changes (monaco-vim writes mode into the node)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new MutationObserver(() => {
      const text = containerRef.current?.textContent ?? '';
      if (text.includes('INSERT')) setMode('INSERT');
      else if (text.includes('VISUAL BLOCK')) setMode('V-BLOCK');
      else if (text.includes('VISUAL LINE')) setMode('V-LINE');
      else if (text.includes('VISUAL')) setMode('VISUAL');
      else if (text.includes('REPLACE')) setMode('REPLACE');
      else setMode('NORMAL');
    });
    observer.observe(containerRef.current, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const modeColor: Record<string, string> = {
    NORMAL:    '#3b82f6',
    INSERT:    '#3fb950',
    VISUAL:    '#d97706',
    'V-LINE':  '#f59e0b',
    'V-BLOCK': '#ef4444',
    REPLACE:   '#f85149',
  };

  if (!active) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      height: '22px',
      padding: '0 8px',
      background: 'var(--bg-secondary, #0d0d0f)',
      borderTop: '1px solid var(--border-color, #2d2d35)',
      fontSize: '11px',
      flexShrink: 0,
    }}>
      <span style={{
        padding: '1px 7px',
        borderRadius: '2px',
        background: modeColor[mode] ?? '#3b82f6',
        color: '#fff',
        fontWeight: 700,
        fontSize: '10px',
        letterSpacing: '0.06em',
        fontFamily: 'monospace',
        minWidth: '52px',
        textAlign: 'center',
      }}>
        {mode}
      </span>
      {/* monaco-vim renders its status text (key buffer, ex command, etc.) here */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          color: 'var(--text-muted, #6b7280)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      />
    </div>
  );
}
