# di4m0nds Code Agent

A **multi-session code-agent IDE** in a Tauri desktop shell, built on the
BranchVisualizer commit-graph engine. Point it at a repo (GitHub *or* local
clone), open an agent session, and drive Claude / OpenAI Codex / Gemini /
MiniMax / OpenCode against your working tree — with the commit DAG, files,
docs, Neovim, PTY terminals, and permission gating all in one window.

The system prompt that steers the agent lives at
`src/lib/agent/opus48_code_agent_system_prompt.md` and is embedded verbatim into the
runtime prompt (cache-friendly), then decorated per-turn with a live
`<session_context>` block reflecting the current access level, build mode,
skills, and pinned rules.

## What it does

### Visualizer (the seed feature — still works)
- Canvas-rendered DAG with pan / zoom / fit-to-view
- Commit list, filters, detail panel, tags & release chips
- Two data sources, same graph engine:
  - **GitHub REST** — public repos, PAT-optional for higher rate limits
  - **Local git** — points at any folder on disk, shells out to `git log --all`
    via a Tauri command, feeds the unchanged `buildGraphData` layout

### IDE mode (`/ide` route)
- **Session rail** — spawn / switch / close agent sessions bound to a repo
- **Session-context bar** — access level (supervised · auto-accept · full-access),
  build mode (direct · planning), reasoning effort, skill toggles, pinned-rule
  count, live context-token meter
- **Center workspace** — the full TabWorkspace (Graph / Commits / Files /
  README / Docs / PRs / Releases / CI) with single, 2-pane, and 4-grid splits
- **Terminal dock** — xterm.js panes bound to real PTYs. Roles: `shell`,
  `server`, `nvim`, `agent`. Neovim runs as an actual PTY child, so `:q` /
  `:wq` / `:q!` / `:wq!` auto-close the tab.
- **Chat rail** — streaming agent conversation with a **model picker**
  showing live probe status (grey / amber / green) and paid / free tier chips
  per provider

### Agent capabilities
- **Manual agentic loop** — streams assistant text into the UI, then on
  `tool_use` runs pinned-rule enforcement → access-level gating → execution.
  Always returns a `tool_result` for every `tool_use_id` (never drops).
- **Pinned rules** — inviolable session-level constraints (default seed:
  "Do not commit or push anything"). CRUD in a global editor; new sessions
  inherit; existing sessions can re-sync from global.
- **Access-level gating**:
  - `supervised` → per-action approval card in the chat rail
  - `auto_accept` → auto file ops, gated commands / git
  - `full_access` → autonomous, pinned rules still enforced
- **Tools** — dedicated (not raw bash) so the harness can gate/render/audit:
  `read_file`, `write_file`, `edit_file`, `list_dir`, `grep`, `run_command`,
  `git_status`
- **Docs tab** — walks the working tree, renders `.md` / `.rst` / `.txt` /
  `.org` / `.adoc` via `react-markdown`, `.pdf` via lazy-loaded `pdfjs-dist`,
  `.docx` via `mammoth`. Click a file → opens in the session's nvim.

## Providers

| Provider | Auth | Detection |
|---|---|---|
| **Anthropic Claude** — Fable 5, Opus 4.8/4.7, Sonnet 4.6, Haiku 4.5 | `ANTHROPIC_API_KEY` (direct API) | live `countTokens` probe |
| **Claude Code** — Opus / Sonnet / Haiku via the `claude` CLI | `claude` CLI login, or `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) / `ANTHROPIC_API_KEY` | `claude --version` + credential/env sniff |
| **OpenAI Codex** — GPT-5/5.1 Codex, GPT-4.1, o4-mini | `codex login` (CLI OAuth), `OPENAI_API_KEY` fallback | `~/.codex/auth.json` sniff |
| **Google Gemini** — 2.5 Pro / Flash / Flash-Lite | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | live `countTokens` probe |
| **MiniMax** — M2 / Text-01 / abab6.5s | `MINIMAX_API_KEY` | 1-token chat probe |
| **OpenCode** — CLI + local server | `opencode auth login` | `~/.local/share/opencode/auth.json` + `/health` |

The picker in the chat rail exposes every provider × model with a live status
pip (**not detected** / **detected** / **connected**) and a tier chip
(**paid** / **free** / **unknown**). Click *refresh* to re-probe everything.

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (WebKitGTK on Linux) |
| Backend | Rust — `portable-pty`, custom git shell-outs, path-jailed fs |
| UI | React 18 + TypeScript, Tailwind v4, Radix, Framer Motion |
| Router | React Router v7 |
| Terminals | `xterm.js` + FitAddon + WebLinksAddon |
| LLM SDKs | `@anthropic-ai/sdk`, `openai`, `@google/genai` (+ raw fetch for MiniMax / OpenCode) |
| Docs | `react-markdown`, `remark-gfm`, `pdfjs-dist`, `mammoth` |
| Notifications | Sonner |
| Validation | Zod |
| Build | Vite 5 (ESM-only, `vite.config.mts`) |
| Package manager | pnpm |

## Getting started

Prerequisites: Node ≥ 18, pnpm, Rust (`rustup` — required for the Tauri build),
and Linux GTK/WebKit dev packages (`libsoup3`, `webkit2gtk-4.1`,
`javascriptcoregtk-4.1`). `nvim` on `$PATH` if you want the editor pane.

```bash
pnpm install

# Web dev server (browser-only, desktop features degrade to placeholders)
pnpm dev

# Type-check + production build
pnpm typecheck
pnpm build

# Full desktop app (spawns Vite, compiles Rust, opens native window)
pnpm tauri dev
```

Set provider keys in your shell before launching (each is optional; only the
picker's live probe is affected):

```bash
export ANTHROPIC_API_KEY=sk-ant-…
export OPENAI_API_KEY=sk-…       # or run: codex login
export GEMINI_API_KEY=…
export MINIMAX_API_KEY=…
```

## Project structure

```
src/
├── App.tsx                       # Router: /, /ide, /:owner/:repo, /local
├── main.tsx                      # Entry: providers, cache prune, error boundary
│
├── components/
│   ├── layout/Navbar.tsx         # Brand, breadcrumb, IDE link, theme toggle
│   ├── repo/RepoSearch.tsx       # GitHub ⟷ Local source toggle + input
│   ├── workspace/
│   │   ├── TabWorkspace.tsx      # Tab + split-pane engine (single / 2h / 2v / 4g)
│   │   ├── ResizeHandle.tsx      # Draggable pane divider (shared)
│   │   ├── FilesTabPrimitives.tsx# FileIcon + FileRow (shared by GH + local)
│   │   ├── FilesTab.tsx          # GitHub REST file tree
│   │   ├── LocalFilesTab.tsx     # Local walk_tree; click → nvim
│   │   ├── ReadmeTab.tsx         # GitHub README fetch
│   │   ├── LocalReadmeTab.tsx    # Local README candidate lookup
│   │   ├── LocalDocsTab.tsx      # md / rst / txt / pdf / docx viewer
│   │   └── PRsIssuesTab / …      # GitHub-only tabs (releases, CI, …)
│   ├── ide/
│   │   ├── IdeWorkspace.tsx      # /ide route — session rail / center / dock / chat
│   │   ├── SessionContextBar.tsx # Access-level, mode, skills, pinned chip
│   │   ├── ModelPicker.tsx       # Provider × model picker + probe panel
│   │   └── PinnedRulesEditor.tsx # App-global rule CRUD modal
│   ├── agent/
│   │   ├── ChatPanel.tsx         # Streaming conversation + approval cards
│   │   ├── AgentBlocks.tsx       # Structured block renderers
│   │   └── blocks.ts             # Tolerant streaming block parser
│   ├── terminal/
│   │   ├── Terminal.tsx          # xterm bound to a Rust PTY; onExit hook
│   │   └── TerminalDock.tsx      # Tabbed dock; open-in-nvim bus; autoclose
│   ├── GraphCanvas / CommitListView / DetailPanel / …  # visualizer surface
│
├── graph/                        # DAG layout / renderer / colors (format-agnostic)
│
├── hooks/
│   ├── useRepoData.ts            # Fork point: GitHub vs local loader
│   ├── useActiveSession.ts       # Selector for the focused session
│   ├── useOpenInNvim.ts          # Per-session event bus (files/docs → nvim)
│   └── useCanvas.ts              # Canvas pan/zoom
│
├── lib/
│   ├── platform.ts               # DesktopOnlyError + invoke/listen seam
│   ├── github.ts                 # GitHub REST client (unchanged)
│   ├── localGit.ts               # Local git bridge over Tauri commands
│   ├── pty.ts                    # PTY bridge (spawn/write/resize/kill + events)
│   └── agent/
│       ├── systemPrompt.ts       # Embeds opus48_…md (in this dir) + renderSessionContext
│       ├── transport.ts          # Neutral message/response/tool shapes
│       ├── providers/            # anthropic / openai_codex / gemini / minimax / opencode
│       ├── tools.ts              # NeutralToolSchema[] + jailed executor
│       └── loop.ts               # Manual streaming agentic loop
│
├── store/
│   ├── AppContext.tsx            # Provider + persistState effect
│   └── reducer.ts                # AppState reducer (additive slices)
│
├── types/
│   ├── index.ts                  # AppState, ModelRef, actions, TabId
│   ├── session.ts                # Session, SessionContext, PinnedRule, SkillFlag
│   └── terminal.ts               # TerminalDef + roles
│
└── styles/globals.css            # Tailwind v4 @theme tokens

src-tauri/src/
├── lib.rs                        # invoke_handler registry + plugin setup
├── main.rs                       # Windows subsystem entry
├── git.rs                        # git_full_repository / _commit_details / _status
├── pty.rs                        # portable-pty PtyState + spawn/write/resize/kill
└── fs.rs                         # agent_* (jailed) + walk_tree + provider probes
```

## Persistence

The app persists two things to `localStorage`:

- `code-agent:pinned_rules` — app-global rule set (seeds new sessions)
- `code-agent:current_model` — provider + model picked in the ModelPicker

Sessions themselves are in-memory for now (multi-session polish flagged in the
plan file at `docs/` if you want to persist them).

## Design system

Two themes via `data-theme` on `<html>`: `dark` (default) and `light`. All
colour / spacing / shadow / typography tokens live in
`src/styles/globals.css` under a Tailwind v4 `@theme` block. Never hardcode
colour values in components — use the tokens.

## Build system note

`@tailwindcss/vite` is ESM-only. `vite.config.mts` is native ESM and every
script passes `--config vite.config.mts` explicitly. Do not rename or merge
into `vite.config.ts`.

## License

MIT
