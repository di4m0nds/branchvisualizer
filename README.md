# BranchVisualizer

An interactive, high-performance web app that renders any public GitHub repository as a live commit and branch graph — built with Vite + React 18 + TypeScript and a raw Canvas 2D renderer.

![BranchVisualizer screenshot placeholder](https://placehold.co/900x500/0d1117/60a5fa?text=BranchVisualizer)

---

## Quick start

```bash
# 1. Install dependencies (one time)
npm install

# 2. Start the dev server
npm run dev
# → http://localhost:5173

# 3. Build for production
npm run build
npm run preview
```

No environment variables are required. GitHub's public API works without a token for most repos (60 requests/hour). For large or frequently-loaded repos, add a [Personal Access Token](https://github.com/settings/tokens) via the 🔑 button in the UI to raise the limit to 5,000 requests/hour.

---

## Usage

1. Paste any GitHub URL into the input bar — full URL, SSH URL, or `owner/repo` shorthand.
2. Click **Visualize** (or press Enter).
3. The app fetches metadata, branches, tags, and commit history, then renders the graph.

### Graph interaction

| Action | Effect |
|--------|--------|
| **Scroll / pinch** | Zoom in/out (centered on cursor) |
| **Drag** | Pan the graph |
| **Click a commit** | Open the detail panel |
| **Hover** | Highlight a commit |
| `F` | Fit the entire graph to the viewport |
| `+` / `−` | Zoom in / zoom out |
| `0` | Reset zoom to 100% |
| `Esc` | Close the detail panel |

### Filters

- **Search** — matches SHA prefix, commit message, author name, login, or email (200 ms debounce)
- **Branch** — shows only commits reachable from the selected branch (full BFS traversal)
- **Author** — filters by author identity
- **Date range** — from / to date pickers

Filtered-out commits are dimmed rather than hidden so the graph topology remains legible.

---

## Architecture

```
src/
├── types/index.ts          Core data model (Commit, Branch, Tag, GraphNode, GraphEdge, …)
├── lib/
│   ├── parser.ts           GitHub URL parsing & validation (regex, no deps)
│   ├── github.ts           GitHub REST API v3 client (fetch, CORS-safe, paginated)
│   └── cache.ts            localStorage cache with TTL and auto-pruning
├── graph/
│   ├── colors.ts           Lane colour palette + layout constants
│   ├── layout.ts           DAG layout: topological sort → lane assignment → node/edge positions
│   └── renderer.ts         Canvas 2D renderer: viewport culling, edges, nodes, labels, minimap
├── hooks/
│   ├── useRepoData.ts      Async data-fetch orchestrator; drives load-state machine
│   └── useCanvas.ts        Pan, zoom (mouse/wheel/touch/pinch), hit-test, fitToView
├── store/
│   ├── reducer.ts          Pure AppState reducer (useReducer; no external state lib)
│   └── AppContext.tsx      React context provider
└── components/
    ├── RepoInput.tsx        URL input, token toggle, quick-example buttons
    ├── GraphCanvas.tsx      Canvas host; memoized filter, rAF render loop, resize observer
    ├── DetailPanel.tsx      Commit details sidebar (author, parents, links, SHA copy)
    ├── SearchFilter.tsx     Filter bar with debounced search
    ├── RepoHeader.tsx       Repo metadata strip (stars, forks, default branch)
    ├── LoadingOverlay.tsx   Progress bar overlay during fetch
    └── ErrorBanner.tsx      Dismissible error display
```

### Data flow

```
User types URL
  → parseGitHubURL()            [lib/parser.ts]
  → fetchFullRepository()       [lib/github.ts]   — GitHub REST API, paginated, cached
  → buildGraphData()            [graph/layout.ts] — topoSort → assignLanes → nodes + edges
  → dispatch LOAD_SUCCESS       [store/reducer.ts]
  → GraphCanvas useMemo         [components/GraphCanvas.tsx] — filter → highlightedShas
  → renderGraph() on rAF        [graph/renderer.ts] — viewport culled, Canvas 2D
```

### Graph layout algorithm

The layout is a classic **topological sort + lane assignment**:

1. **`topoSort`** — Kahn's algorithm with a date-sorted ready queue. Produces newest-first order. Uses a pre-cached timestamp map and binary-insertion to keep the ready queue sorted in O(log k) per step instead of O(k log k) per iteration.

2. **`assignLanes`** — walks sorted commits maintaining an `activeLanes` array where `activeLanes[i]` is the SHA the lane is currently waiting for. A commit claims the lane that was waiting for it (or opens a new one). Merge commits cause additional parent SHAs to open new lanes; empty lanes are reclaimed by subsequent branch-tip commits.

3. **Pixel coordinates** — `x = PADDING_LEFT + lane × LANE_WIDTH`, `y = PADDING_TOP + row × ROW_HEIGHT`. No force-directed physics, no Dagre — just pure arithmetic.

### Renderer design

- **Canvas 2D** instead of SVG. For a 2,000-commit repo, SVG would create ~4,000+ DOM nodes; Canvas draws everything as pixels with zero DOM overhead.
- **Viewport culling** — only rows within `[viewportTop − 1, viewportBottom + 1]` are drawn each frame. A 10,000-row graph draws ~30 rows at 100% zoom.
- **Text truncation cache** — `ctx.measureText` results are memoised behind a 4,096-entry LRU-lite cache, evicting the oldest half when full.
- **Single rAF per render** — the `useEffect` in `GraphCanvas` cancels any pending frame before scheduling a new one, so rapid state changes (pan, hover) never queue more than one draw.
- **DPR-aware sizing** — the canvas physical size is `cssSize × devicePixelRatio`; the context is pre-scaled so all drawing code uses CSS pixel units directly.

### Performance characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Topological sort | O(n log n) | n = commit count; sorted ready queue |
| Lane assignment | O(n × k) | k = max concurrent lanes (typically < 20) |
| Branch reachability filter | O(n) | BFS from tip, runs once per branch selection |
| Search filter | O(n) | string scan; 200 ms debounce prevents hot-path thrashing |
| Canvas render (per frame) | O(visible rows) | ~30–60 rows at normal zoom |
| Hit test | O(row buffer) | ±2 rows around cursor; no spatial index needed |

For 500 commits across 20 branches:
- GitHub API: ~8–12 requests, ~1–3 s depending on connection
- Layout computation: < 5 ms
- First paint: < 1 ms after layout

### Caching

All GitHub API responses are cached in `localStorage` with a 30–60 second TTL (configurable per call site in `github.ts`). Stale entries are pruned on startup via `cachePrune()`. This means repeated loads of the same repo are near-instant within the TTL window.

---

## Limitations & known constraints

- **Public repos only** by default. Private repos work if you supply a token with `repo` scope.
- **Up to 40 branches and ~150 commits per branch** are fetched (configurable via `MAX_BRANCHES` / `MAX_COMMITS_PER_BRANCH` in `github.ts`). Deeper history can be loaded by raising these constants.
- **No file-level diff view** — GitHub's REST API requires one additional request per commit for file stats; these are only fetched for commits where `stats` is already included in the list response (GitHub includes them on single-commit fetches, not on list endpoints).
- **Branch filter** uses BFS ancestor traversal which is accurate but only covers the fetched window. Commits older than the fetch limit may be missing.
- **Rate limit** — unauthenticated: 60 req/hr. Authenticated: 5,000 req/hr. A typical 40-branch repo uses ~45 requests.

---

## Tech choices & trade-offs

| Choice | Rationale |
|--------|-----------|
| **Vite** | Sub-100 ms HMR; native ESM; zero config for this stack |
| **React 18** | Familiar, well-typed; concurrent features (`useTransition`) available if layout becomes async |
| **Canvas 2D, not SVG** | 10–100× fewer DOM nodes; no layout thrashing; straightforward culling |
| **No state library** | `useReducer` + context is sufficient; avoids Zustand/Redux bundle overhead |
| **No UI component library** | Single `index.css` with CSS custom properties; zero runtime JS for styles |
| **No d3-hierarchy** | The git graph layout is simple enough to hand-write (~120 LOC); avoids a 50 kB dep |
| **GitHub REST API, not GraphQL** | REST is CORS-safe without a proxy; simpler to paginate; no schema introspection needed |
| **localStorage cache** | Free, synchronous, no server needed; TTL keeps it from going stale |
