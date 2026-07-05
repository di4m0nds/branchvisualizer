// ─── IDE layout persistence ──────────────────────────────────────────────────
// Panel sizes + config-strip collapse state for the IDE workspace. Kept out of
// the app reducer on purpose: it's pure UI chrome, and drag fires per mousemove
// — routing it through the reducer would re-render/persist the whole app tree on
// every frame. Stored in localStorage under one key, written debounced.

const KEY = 'code-agent:ide_layout';

export interface IdeLayout {
  /** ProjectsSidebar width, % of the whole IDE row. Clamped to 180–420px at
   *  the DOM level so the slider can't shrink it into illegibility. */
  sidebarWidth: number;
  /** Middle (agent + terminal) column width, % of the middle|right row. */
  midWidth: number;
  /** Terminal dock height, % of the agent stack. */
  dockHeight: number;
  /** Agent config strip collapsed. */
  cfgCollapsed: boolean;
  /** BranchVisualizer config strip collapsed. */
  bvCollapsed: boolean;
  /** Sidebar collapsed to an icon-only rail (fixed width, no resize handle). */
  sidebarCollapsed: boolean;
  /** Terminal dock collapsed to a thin bottom bar (chat gets the space). */
  dockCollapsed: boolean;
  /** Right column view: repo workspace (canvas/tabs), plan review, the
   *  container runtime panel, the repository docs viewer, the project
   *  knowledge base, the Excalidraw canvas, or the monitor dashboard. */
  rightView: 'workspace' | 'plan' | 'runtime' | 'docs' | 'debug' | 'knowledge' | 'canvas' | 'monitor';
  /** LocalDocsTab: doc-list rail width as % of the docs container. Persisted
   *  once and shared by both mount points (right-column view + canvas
   *  sub-tab) so the drag position feels consistent regardless of where the
   *  user opened Docs. */
  docsSidebarWidth: number;
  /** KnowledgePanel: note-list rail width as % of the panel. */
  kbSidebarWidth: number;
  /** CommandPanel (left column, below ProjectsSidebar): height %. */
  cmdHeight: number;
  /** CommandPanel collapsed to a thin bar. */
  cmdCollapsed: boolean;
}

export const DEFAULT_IDE_LAYOUT: IdeLayout = {
  sidebarWidth: 18,
  midWidth: 46,
  dockHeight: 30,
  cfgCollapsed: false,
  bvCollapsed: false,
  sidebarCollapsed: false,
  dockCollapsed: false,
  rightView: 'workspace',
  docsSidebarWidth: 20,
  kbSidebarWidth: 26,
  cmdHeight: 35,
  cmdCollapsed: true,
};

export function loadIdeLayout(): IdeLayout {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_IDE_LAYOUT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_IDE_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<IdeLayout>;
    return { ...DEFAULT_IDE_LAYOUT, ...parsed };
  } catch {
    return { ...DEFAULT_IDE_LAYOUT };
  }
}

export function saveIdeLayout(layout: IdeLayout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch { /* quota / private mode */ }
}

export function resetIdeLayout(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
