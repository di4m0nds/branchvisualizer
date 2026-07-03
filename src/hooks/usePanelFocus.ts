// ─── Per-panel focus + scoped zoom (IDE only) ───────────────────────────────
// A tiny external store (same shape as useAppZoom) that tracks which IDE panel
// is focused, a per-panel zoom scale, and which panel (if any) is maximized.
// Kept out of the app reducer on purpose: focus flips on every click and must
// not re-render/persist the whole app tree. Only zoom scales are persisted.

import { useSyncExternalStore } from 'react';

export type PanelId = 'sidebar' | 'chat' | 'terminal' | 'workspace' | 'plan' | 'runtime';

const PANELS: PanelId[] = ['sidebar', 'chat', 'terminal', 'workspace', 'plan', 'runtime'];
const ZOOM_KEY = 'code-agent:panel_zoom';
export const PANEL_ZOOM_MIN = 0.5;
export const PANEL_ZOOM_MAX = 2.0;
export const PANEL_ZOOM_STEP = 0.1;

function clampZoom(v: number): number {
  return Math.min(PANEL_ZOOM_MAX, Math.max(PANEL_ZOOM_MIN, Math.round(v * 10) / 10));
}

function loadZoom(): Record<PanelId, number> {
  const base = Object.fromEntries(PANELS.map((p) => [p, 1])) as Record<PanelId, number>;
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, number>>;
    for (const p of PANELS) {
      const v = parsed[p];
      if (typeof v === 'number' && Number.isFinite(v)) base[p] = clampZoom(v);
    }
    return base;
  } catch {
    return base;
  }
}

interface Store {
  focused: PanelId | null;
  zoom: Record<PanelId, number>;
  maximized: PanelId | null;
}

// `focused` defaults to 'chat' so keyboard zoom has a sensible target on load.
let store: Store = { focused: 'chat', zoom: loadZoom(), maximized: null };
const listeners = new Set<() => void>();

function emit(): void { listeners.forEach((l) => l()); }
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistZoom(): void {
  if (typeof localStorage === 'undefined') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(ZOOM_KEY, JSON.stringify(store.zoom)); } catch { /* quota */ }
  }, 250);
}

// ── mutators ──
export function setFocusedPanel(id: PanelId | null): void {
  if (store.focused === id) return;
  store = { ...store, focused: id };
  emit();
}
export function getFocusedPanel(): PanelId | null {
  return store.focused;
}

export function setPanelZoom(id: PanelId, v: number): void {
  const next = clampZoom(v);
  if (store.zoom[id] === next) return;
  store = { ...store, zoom: { ...store.zoom, [id]: next } };
  persistZoom();
  emit();
}
export function bumpPanelZoom(id: PanelId, delta: number): void {
  setPanelZoom(id, store.zoom[id] + delta);
}
export function resetPanelZoom(id: PanelId): void {
  setPanelZoom(id, 1);
}
export function getPanelZoom(id: PanelId): number {
  return store.zoom[id];
}

export function setMaximizedPanel(id: PanelId | null): void {
  if (store.maximized === id) return;
  store = { ...store, maximized: id, focused: id ?? store.focused };
  emit();
}
export function getMaximizedPanel(): PanelId | null {
  return store.maximized;
}
export function toggleMaximizedPanel(id: PanelId): void {
  setMaximizedPanel(store.maximized === id ? null : id);
}

// ── sliced hooks (Object.is on the returned primitive avoids extra renders) ──
export function useIsFocused(id: PanelId): boolean {
  return useSyncExternalStore(subscribe, () => store.focused === id, () => false);
}
export function usePanelZoom(id: PanelId): number {
  return useSyncExternalStore(subscribe, () => store.zoom[id], () => 1);
}
export function useMaximizedPanel(): PanelId | null {
  return useSyncExternalStore(subscribe, () => store.maximized, () => null);
}
