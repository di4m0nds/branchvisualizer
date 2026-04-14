# BranchVisualizer — Project Context & Best Practices

This document captures the architectural decisions, coding conventions, and known hazards of this codebase. Read it before making changes.

---

## 1. What this project is

A single-page app that visualises any public GitHub repository as an interactive Canvas-rendered commit graph. No backend, no build-time API keys. Everything runs in the browser using the GitHub public REST API.

---

## 2. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Bundler | Vite 5 | Fast HMR, native ESM, zero config |
| UI | React 18 + TypeScript | Concurrent rendering; `useMemo`/`useCallback` for hot-path stability |
| State | `useReducer` + React Context | No external lib needed; the shape is simple enough |
| Rendering | Raw Canvas 2D | Far fewer DOM nodes than SVG; straightforward viewport culling |
| Styling | Single `index.css` with CSS custom properties | Zero runtime cost; all tokens in one place |
| API | GitHub REST API v3 (direct from browser) | GitHub supports CORS; no proxy needed |
| Cache | `localStorage` with TTL | Free, synchronous, survives page refresh |

---

## 3. Directory map

```
src/
├── types/index.ts        ← Single source of truth for all shared types
├── lib/
│   ├── parser.ts         ← URL parsing only; no side effects
│   ├── github.ts         ← All network I/O; async, throws GitHubError
│   └── cache.ts          ← localStorage wrapper; safe to call anywhere
├── graph/
│   ├── colors.ts         ← Palette + layout constants (LANE_WIDTH, ROW_HEIGHT…)
│   ├── layout.ts         ← Pure functions: commits → GraphData (no I/O, no React)
│   └── renderer.ts       ← Pure functions: GraphData + ctx → pixels (no React)
├── hooks/
│   ├── useRepoData.ts    ← Orchestrates fetch → layout → dispatch
│   └── useCanvas.ts      ← DOM event wiring; returns only { fitToView }
├── store/
│   ├── reducer.ts        ← Pure reducer; all AppState transitions here
│   └── AppContext.tsx    ← Provider + useAppContext hook
└── components/           ← All React components; thin wrappers over the above
```

**The key invariant:** `graph/layout.ts` and `graph/renderer.ts` have **zero React dependencies**. They are pure computation/drawing modules. Keep them that way.

---

## 4. Data flow

```
URL string
  ↓ parseGitHubURL()              [lib/parser.ts]       — pure, sync
  ↓ fetchFullRepository()         [lib/github.ts]       — async, throws
  ↓ buildGraphData()              [graph/layout.ts]     — pure, sync, ~1–5 ms
  ↓ dispatch(LOAD_SUCCESS)        [store/reducer.ts]    — pure
  ↓ useMemo(computeHighlighted)   [GraphCanvas.tsx]     — pure, memoized
  ↓ renderGraph() via rAF         [graph/renderer.ts]   — imperative, no state
```

State never flows backwards. Filters re-run `computeHighlighted` (memoized). Viewport changes skip `computeHighlighted` entirely and go straight to `renderGraph`.

---

## 5. Canvas rendering rules

### Never break these:

1. **One `cancelAnimationFrame` before every `requestAnimationFrame`.**  
   `GraphCanvas.tsx` stores the frame ID in `rafRef` and cancels before scheduling. If you add a new render trigger, follow this pattern — never schedule two frames.

2. **Canvas physical size is set in its own `useEffect`, keyed only to `canvasSize`.**  
   Setting `canvas.width` resets the context transform. If you do it inside the main render effect (which runs on every viewport change), you'll reset the DPR scale on every pan/zoom and get blurry output.

3. **`ctxRef` bridges the two effects.**  
   The canvas-size effect writes `ctxRef.current`; the render effect reads it. Do not call `canvas.getContext()` inside the render effect.

4. **All drawing coordinates are in CSS pixels.**  
   The context is pre-scaled by `devicePixelRatio` after each resize. Write `node.x / node.y` directly — do not multiply by DPR in drawing code.

5. **Viewport culling is mandatory.**  
   `renderGraph` computes `minRow`/`maxRow` from `offsetY` and `height / scale`. Never iterate all `graph.nodes` unconditionally — it will freeze on large repos.

---

## 6. Performance rules

### `useMemo` for filter computation
`computeHighlighted` in `GraphCanvas.tsx` runs a BFS + O(n) scan. It is wrapped in `useMemo` keyed on `[graphData, filter, branches, allCommits]`. **Do not move it inside the render `useEffect`** or it will run on every pan/zoom frame.

### Debounced search
`SearchFilter.tsx` maintains a local `localSearch` state that updates instantly (so the input feels responsive) and a `useDebounced(localSearch, 200)` value that gets dispatched. **Do not dispatch on every keystroke** — the BFS filter is O(n) and will stall on large repos.

### Topo sort
`layout.ts` uses Kahn's algorithm with a pre-cached timestamp map and binary insertion sort. The ready queue stays sorted without a full `Array.sort` each iteration. If you modify `topoSort`, preserve this — the naive version that calls `queue.sort()` inside the loop is O(n² log n).

### Text truncation cache
`renderer.ts` caches `ctx.measureText` results up to 4,096 entries (LRU-lite: evict oldest half when full). **Do not remove this cache.** `measureText` is surprisingly expensive when called thousands of times per frame.

---

## 7. Type conventions

All shared types live in `src/types/index.ts`. Never define a type that is used across files anywhere else.

- **`Commit`** — normalised API data; `parents: string[]` (SHAs only, not nested objects)
- **`GraphNode`** — a `Commit` plus layout coordinates (`lane`, `row`, `x`, `y`, `color`)
- **`GraphEdge`** — connects `fromSha → toSha` with lane/row info for drawing
- **`GraphData`** — the complete layout result; includes `commitMap: Map<string, GraphNode>` for O(1) SHA lookup
- **`AppState`** — the single store; see `reducer.ts` for all transitions
- **`LoadPhase`** — the load state machine values; don't add new phases without updating `LoadingOverlay.tsx`

---

## 8. GitHub API conventions

All API calls go through `apiFetch` in `github.ts`. It:
- Attaches the Bearer token if set
- Parses rate-limit headers into `RateLimit`
- Caches responses in `localStorage` via `cache.ts`
- Throws `GitHubError` (with `.status` and `.rateLimitExceeded`) on non-2xx

**Never call `fetch` directly from a component or hook.** Route it through `github.ts`.

Rate limit constants (`MAX_COMMITS_PER_BRANCH = 150`, `MAX_BRANCHES = 40`) are at the top of `github.ts`. Increase them for deeper history, but be aware of the API cost.

---

## 9. State management rules

`AppState` is in `store/reducer.ts`. All transitions are pure. The key slices:

| Slice | What changes it |
|-------|----------------|
| `loadState` | `useRepoData.ts` via `SET_LOAD_STATE`, `LOAD_SUCCESS`, `LOAD_ERROR` |
| `graphData` | Only `LOAD_SUCCESS` |
| `viewport` | `useCanvas.ts` events + keyboard handler in `GraphCanvas.tsx` |
| `filter` | `SearchFilter.tsx` (debounced search) + `SET_FILTER` dispatches |
| `selectedNode` / `hoveredNode` | `useCanvas.ts` hit-test callbacks |
| `token` / `rateLimit` | `RepoInput.tsx` + API response headers |

**Never mutate state directly.** Every transition goes through `dispatch`.

---

## 10. CSS conventions

All design tokens are CSS custom properties in `src/index.css` under `:root`. Use them everywhere:

```css
--bg-canvas, --bg-surface, --bg-overlay   /* backgrounds */
--border, --border-muted                   /* borders */
--text-primary, --text-secondary, --text-muted, --text-link
--accent-blue, --accent-blue-subtle
--green, --red, --yellow
--font-sans, --font-mono
--radius-sm, --radius-md, --radius-lg
--header-h, --detail-w, --filterbar-h     /* layout sizes */
```

Do not hardcode colours or font stacks in component styles. Match the GitHub dark theme palette.

---

## 11. Known hazards & past bugs

### `renderer.ts` duplicate `graphHeight` (fixed)
When the file was truncated during initial write, a `cat >>` append duplicated the `ctx.restore()`, closing brace, and `graphHeight` function. TypeScript reported `2323: Cannot redeclare exported variable` and `2393: Duplicate function implementation`. **Fix:** truncate the file to remove the duplicate tail, keeping lines 1–441.

### `GraphNode` unused import in `renderer.ts` (fixed)
`GraphNode` was imported but `renderer.ts` only accesses nodes through `graph.nodes` (typed via `GraphData`). TypeScript reported `6196: 'GraphNode' is declared but never used`. **Fix:** remove it from the import line.

### `React.RefObject` without React import (fixed)
`useCanvas.ts` used `React.RefObject<HTMLCanvasElement>` without importing React. In React 18 with the new JSX transform, `React` is not auto-imported. **Fix:** import `type RefObject` from `'react'` and use that directly.

### `require()` in ESM context (fixed)
An early version of `useCanvas.ts` used `const { graphHeight } = require('../graph/renderer')` inside a callback. This fails in Vite's native ESM build. **Fix:** use a static top-level `import` instead.

### `childrenOf` map built but never read (fixed)
`layout.ts` built a `childrenOf: Map<string, string[]>` during in-degree calculation but only `inDegree` was used by Kahn's algorithm. TypeScript reported it as unused. **Fix:** removed the map entirely.

### `canvas.width` reset on every pan (latent risk)
Setting `canvas.width` or `canvas.height` resets the context state (including the DPR scale transform). If the canvas-sizing logic and the render logic ever merge into one effect, every pan/zoom will reset the transform and produce blurry output. **Keep them separate.**

---

## 12. Adding new features — checklist

- [ ] New API endpoint? → add to `github.ts`, update `fetchFullRepository` progress callback
- [ ] New filter type? → add field to `FilterState` in `types/index.ts`, update `initialFilterState` in `reducer.ts`, wire in `SearchFilter.tsx` and `GraphCanvas.tsx` `computeHighlighted`
- [ ] New graph decoration (e.g. PR labels)? → add to `GraphData` in `types/index.ts`, populate in `buildGraphData` in `layout.ts`, render in `drawLabels` in `renderer.ts`
- [ ] New UI panel? → keep it outside the canvas container; canvas must stay `flex: 1`
- [ ] Performance-sensitive loop? → wrap the caller with `useMemo` or `useCallback`, document the complexity in a comment
