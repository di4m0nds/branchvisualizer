// apps/branchvisualizer/src/components/workspace/editor/ErrorLens.tsx
// Phase 8 -- Error Lens: inline diagnostic messages after each code line.
//
// Mirrors the VS Code "Error Lens" extension behaviour:
//   • Error   → red   text after the line
//   • Warning → amber text after the line
//   • Info    → blue  text after the line
//   • Hint    → grey  text after the line
//
// Architecture:
//   1. Listen to editor's onDidChangeModelMarkers (Monaco fires this when
//      the TS/JS language service, or external setModelMarkers, updates diagnostics).
//   2. Build a decorations collection with "after" injected text per line.
//   3. Expose a summary (counts + first message) via the codeatlas:diagnostics
//      custom event so EditorStatusBar can show error counts without prop-drilling.

import { useEffect, useRef } from 'react';
import type * as MonacoType from 'monaco-editor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticSummary {
  errors:   number;
  warnings: number;
  infos:    number;
  firstError?: string;
}

// Custom event shape
declare global {
  interface WindowEventMap {
    'codeatlas:diagnostics': CustomEvent<DiagnosticSummary>;
    'codeatlas:nav-log': CustomEvent<NavLogEntry>;
  }
}

export interface NavLogEntry {
  type: 'open' | 'edit' | 'jump' | 'search' | 'save' | 'error' | 'lsp';
  path: string;
  line?: number;
  detail?: string;
  ts: number;
}

// Helper so any module can emit navigation log events
export function emitNavLog(entry: Omit<NavLogEntry, 'ts'>): void {
  window.dispatchEvent(new CustomEvent('codeatlas:nav-log', {
    detail: { ...entry, ts: Date.now() },
  }));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<number, { icon: string }> = {
  8: { icon: '✗' }, // Error
  4: { icon: '⚠' }, // Warning
  2: { icon: 'ℹ' }, // Info
  1: { icon: '·' }, // Hint
};

// Max length of inline message to avoid horizontal overflow
const MAX_MSG_LEN = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ErrorLensProps {
  editor: MonacoType.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof MonacoType | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ErrorLens({ editor, monacoInstance }: ErrorLensProps) {
  const collectionRef = useRef<MonacoType.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!editor || !monacoInstance) return;

    // Create a managed decorations collection (auto-tracks & merges cleanly)
    collectionRef.current = editor.createDecorationsCollection([]);

    // Inject CSS classes for injected text (Monaco doesn't style 'after' content natively)
    // Inject CSS classes — colours come from CSS vars so they switch with theme
    const styleId = 'ca-error-lens-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .ca-lens-error   { color: var(--hk-err)  !important; font-style: italic; font-size: 11px; padding-left: 14px; opacity: 0.9;  pointer-events: none; }
        .ca-lens-warning { color: var(--hk-warn) !important; font-style: italic; font-size: 11px; padding-left: 14px; opacity: 0.85; pointer-events: none; }
        .ca-lens-info    { color: var(--hk-info) !important; font-style: italic; font-size: 11px; padding-left: 14px; opacity: 0.8;  pointer-events: none; }
        .ca-lens-hint    { color: var(--hk-fg-muted) !important; font-style: italic; font-size: 11px; padding-left: 14px; opacity: 0.55; pointer-events: none; }
      `;
      document.head.appendChild(style);
    }

    const applyLens = () => {
      const model = editor.getModel();
      if (!model) { collectionRef.current?.clear(); return; }

      const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri });
      if (markers.length === 0) {
        collectionRef.current?.clear();
        window.dispatchEvent(new CustomEvent('codeatlas:diagnostics', {
          detail: { errors: 0, warnings: 0, infos: 0 },
        }));
        return;
      }

      // Group by line, keep worst severity per line
      const lineMap = new Map<number, MonacoType.editor.IMarker>();
      for (const m of markers) {
        const existing = lineMap.get(m.startLineNumber);
        if (!existing || m.severity > existing.severity) {
          lineMap.set(m.startLineNumber, m);
        }
      }

      const newDecorations: MonacoType.editor.IModelDeltaDecoration[] = [];
      for (const [, marker] of lineMap) {
        const sev = SEVERITY_STYLE[marker.severity] ?? SEVERITY_STYLE[1]!;
        const className =
          marker.severity === 8 ? 'ca-lens-error' :
          marker.severity === 4 ? 'ca-lens-warning' :
          marker.severity === 2 ? 'ca-lens-info' : 'ca-lens-hint';

        const message = `${sev?.icon ?? '·'} ${truncate(marker.message, MAX_MSG_LEN)}`;

        newDecorations.push({
          range: new monacoInstance.Range(
            marker.startLineNumber,
            model.getLineMaxColumn(marker.startLineNumber),
            marker.startLineNumber,
            model.getLineMaxColumn(marker.startLineNumber),
          ),
          options: {
            after: {
              content: `  ${message}`,
              inlineClassName: className,
            },
            // Also colour the line number gutter
            glyphMarginClassName: marker.severity === 8 ? 'ca-glyph-error' : '',
          },
        });
      }

      collectionRef.current?.set(newDecorations);

      // Broadcast summary
      const errors   = markers.filter(m => m.severity === 8).length;
      const warnings = markers.filter(m => m.severity === 4).length;
      const infos    = markers.filter(m => m.severity === 2).length;
      const firstError = markers.find(m => m.severity === 8)?.message;

      window.dispatchEvent(new CustomEvent('codeatlas:diagnostics', {
        detail: { errors, warnings, infos, firstError },
      }));

      // Emit nav log for errors
      if (errors > 0 && model) {
        emitNavLog({
          type: 'error',
          path: model.uri.path.replace('/file:', '').replace('//', ''),
          detail: `${errors}E ${warnings}W`,
        });
      }
    };

    // Apply immediately + on every marker change
    applyLens();
    const disposable = monacoInstance.editor.onDidChangeMarkers(uris => {
      const model = editor.getModel();
      if (!model) return;
      if (uris.some(u => u.toString() === model.uri.toString())) {
        applyLens();
      }
    });

    return () => {
      disposable.dispose();
      collectionRef.current?.clear();
    };
  }, [editor, monacoInstance]);

  // This component renders nothing — it's purely side-effectful
  return null;
}
