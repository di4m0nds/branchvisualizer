// ─── App-wide zoom ───────────────────────────────────────────────────────────
// Scales the whole UI via CSS `zoom` on <body> (scales px-based Tailwind
// utilities too, unlike root font-size). Driven by Ctrl/Cmd +/-/0 and the
// Settings slider. Backed by a tiny external store so the hook can be used in
// multiple components (App + Settings) while sharing one value.

import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'code-agent:zoom';
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

function clamp(v: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 10) / 10));
}

function loadZoom(): number {
  if (typeof localStorage === 'undefined') return 1;
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseFloat(raw) : 1;
    return Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    return 1;
  }
}

let current = loadZoom();
const listeners = new Set<() => void>();

function apply(): void {
  if (typeof document !== 'undefined') {
    (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(current);
  }
}
function persist(): void {
  try { localStorage.setItem(KEY, String(current)); } catch { /* quota */ }
}

export function setZoom(v: number): void {
  current = clamp(v);
  persist();
  apply();
  listeners.forEach((l) => l());
}
export function zoomBy(delta: number): void { setZoom(current + delta); }
export function resetZoom(): void { setZoom(1); }
function getZoom(): number { return current; }
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// When false (on the IDE route) the global keydown handler is inert and body
// zoom is reset to 1 — the IDE uses per-panel scoped zoom instead. Marketing /
// visualizer routes leave this true and keep whole-app zoom.
let enabled = true;

let installed = false;
function installGlobal(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  apply();
  window.addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    // Skip when the pointer is over the graph panel — it has its own viewport
    // scale, and body-level zoom distorts the canvas rendering. The graph's
    // container is tagged with `data-panel="graph"`; when it's hidden (inactive
    // tab) `pointer-events-none` keeps `:hover` from matching, so zoom still
    // works normally in the rest of the UI.
    if (document.querySelector('[data-panel="graph"]:hover')) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(ZOOM_STEP); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-ZOOM_STEP); }
    else if (e.key === '0') { e.preventDefault(); resetZoom(); }
  });
}

/** @param active whether whole-app zoom is in effect. Pass false on /ide. */
export function useAppZoom(active = true) {
  useEffect(() => {
    installGlobal();
    enabled = active;
    if (active) {
      apply();               // re-apply the persisted zoom
    } else if (typeof document !== 'undefined') {
      (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = '1';
    }
    return () => { enabled = true; apply(); };
  }, [active]);
  const zoom = useSyncExternalStore(subscribe, getZoom, getZoom);
  return {
    zoom,
    setZoom,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(-ZOOM_STEP),
    reset: resetZoom,
  };
}
