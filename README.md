# BranchVisualizer

An interactive GitHub repository commit graph visualizer. Enter any public GitHub repository URL and explore its full branch history as an interactive DAG — branches, merges, tags, and authors, all at a glance.

## Features

- **Interactive commit graph** — canvas-rendered DAG with pan, zoom, and fit-to-view
- **List view** — scrollable commit timeline with branch/tag pills and author info
- **Branch & tag filters** — filter by author, date range, branch, or commit message
- **Commit detail panel** — SHA, stats, parents, GitHub link, author popup
- **Dark / light theme** — system-aware with manual toggle
- **GitHub PAT support** — optional token raises rate limit from 60 → 5,000 req/hr
- **API response cache** — 5-minute localStorage TTL to reduce redundant requests
- **Shareable URLs** — `/:owner/:repo` routes that auto-load on navigation
- **Toast notifications** — success, error, and rate-limit warnings via Sonner

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React 18 + TypeScript |
| Routing | React Router v7 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Animations | Framer Motion |
| Notifications | Sonner |
| Validation | Zod |
| UI primitives | Radix UI (via shadcn) |
| Canvas rendering | HTML5 Canvas 2D API |
| Build tool | Vite 5 |
| Font | Geist Variable |

## Getting Started

```bash
# Install dependencies (uses pnpm)
pnpm install

# Start dev server
pnpm dev

# Type-check
pnpm typecheck

# Production build
pnpm build
```

The dev server starts on [http://localhost:5173](http://localhost:5173).

## GitHub Token

For repositories with large histories (e.g. `torvalds/linux`, `microsoft/vscode`) the unauthenticated rate limit of 60 req/hr is quickly exhausted. Add a [GitHub Personal Access Token](https://github.com/settings/tokens) via the **Add token** button on the home page.

A fine-grained token with **no scopes** is sufficient for public repositories.

## Project Structure

```
src/
├── App.tsx                     # Root shell: router, theme sync, footer, modals
├── main.tsx                    # Entry point, providers, cache prune
│
├── components/
│   ├── layout/
│   │   └── Navbar.tsx          # Top bar: brand, breadcrumb, view/theme toggle
│   ├── repo/
│   │   └── RepoSearch.tsx      # URL input, token panel, example repos
│   ├── ui/                     # shadcn primitives (button, badge, tooltip, …)
│   ├── GraphCanvas.tsx         # Canvas-based commit graph
│   ├── CommitListView.tsx      # Virtualised list view
│   ├── DetailPanel.tsx         # Selected commit side panel
│   ├── RepoHeader.tsx          # Repo metadata strip
│   ├── SearchFilter.tsx        # Filter bar (search, branch, author, dates)
│   ├── ErrorBanner.tsx         # Dismissible error banner
│   ├── LoadingOverlay.tsx      # Progress overlay during fetch
│   ├── AuthorPopup.tsx         # Portal-rendered author hover card
│   ├── LegalPage.tsx           # Legal modal (Privacy / Terms / Cookies tabs)
│   ├── PolicyModal.tsx         # First-visit policy acceptance modal
│   └── ErrorBoundary.tsx       # React error boundary
│
├── graph/
│   ├── layout.ts               # DAG layout: lane assignment, edge routing
│   ├── renderer.ts             # Canvas draw calls: rails, nodes, labels
│   └── colors.ts               # Branch colour palette + lane colour helpers
│
├── hooks/
│   ├── useRepoData.ts          # Fetch + build graph, dispatch toasts
│   └── useCanvas.ts            # Canvas pan/zoom interaction + fit-to-view
│
├── lib/
│   ├── github.ts               # GitHub REST API client (branches, tags, commits)
│   ├── parser.ts               # GitHub URL / slug parsing
│   ├── cache.ts                # localStorage TTL cache
│   └── utils.ts                # cn, timeAgo, hashColor, getInitials, …
│
├── services/
│   ├── toast.ts                # Sonner wrapper (import here, not from sonner directly)
│   └── validation.ts           # Zod schemas: repo URL, token format
│
├── store/
│   ├── AppContext.tsx           # React context + useReducer provider
│   └── reducer.ts              # AppState reducer + initial state
│
├── types/
│   └── index.ts                # Shared TypeScript types
│
└── styles/
    └── globals.css             # Tailwind v4 @theme, CSS tokens, base resets
```

## Design System

The app uses **Tailwind CSS v4** with a custom `@theme` block and CSS design tokens. All colour, spacing, shadow, and typography values are defined in `src/styles/globals.css`.

### Key tokens

| Token | Purpose |
|---|---|
| `--background` / `bg-background` | Page background |
| `--surface` / `bg-surface` | Card / panel background |
| `--surface-2` / `bg-surface-2` | Input / secondary surface |
| `--border` / `border-border` | Default border colour |
| `--primary` / `text-primary` | Accent / interactive colour |
| `--foreground` / `text-foreground` | Primary text |
| `--muted-foreground` / `text-muted-foreground` | Subdued text |
| `--destructive` | Error state |
| `--success` / `text-success` | Success state |

### Themes

Two themes are defined via `data-theme` attribute on `<html>`:

- `data-theme="dark"` (default) — deep blue-grey palette
- `data-theme="light"` — clean off-white palette

The `.dark` class is also toggled for Tailwind `dark:` variant compatibility.

### Build system note

`@tailwindcss/vite` is ESM-only and incompatible with Vite 5's default CJS config loader. The project uses `vite.config.mts` (native ESM) with explicit `--config vite.config.mts` flags in all npm scripts. Do not rename or merge into `vite.config.ts`.

## Files Safe to Delete

The following files are no longer imported or used:

| File | Reason |
|---|---|
| `src/index.css` | Replaced by `src/styles/globals.css` |
| `src/components/AnimatedBackground.tsx` | Removed feature, stubbed to null render |
| `src/components/RepoInput.tsx` | Replaced by `src/components/repo/RepoSearch.tsx` |
| `src/components/ThemeToggle.tsx` | Logic inlined into `Navbar.tsx` |
| `src/components/ViewToggle.tsx` | Logic inlined into `Navbar.tsx` |
| `src/components/ui/input.tsx` | Not imported anywhere |
| `src/components/ui/sheet.tsx` | Not imported anywhere |

## License

MIT
