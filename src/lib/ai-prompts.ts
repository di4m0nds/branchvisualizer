// apps/branchvisualizer/src/lib/ai-prompts.ts
// Deterministic prompt library for Phase 6 AI features.
// All prompts are pure functions — no side effects, no React imports.

import type { AIContextPayload, CommitSummary } from '../../../../services/composition/ai-context';

export const PROMPT_VERSION = '6.0.0';

// ─── Feature IDs ─────────────────────────────────────────────────────────────

export type AIFeatureId =
  | 'explain_commit'
  | 'summarize_branch'
  | 'where_to_start'
  | 'pr_description'
  | 'explain_file'
  | 'ask_about_code';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software engineer helping developers understand a Git repository.
Be concise, accurate, and focus on the "why" behind changes — not just what changed.
Format your response in plain text with minimal markdown (use bullet points only when listing items).
Do not repeat information already obvious from the data. Never fabricate file names or commit details.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function repoHeader(ctx: AIContextPayload): string {
  const desc = ctx.repo.description ? ` — ${ctx.repo.description}` : '';
  return `Repository: ${ctx.repo.fullName}${desc}\nDefault branch: ${ctx.repo.defaultBranch}`;
}

function formatCommit(c: CommitSummary, includeFiles = false): string {
  const lines: string[] = [
    `Commit: ${c.shortSha} — ${c.subject}`,
    `Author: ${c.author}  Date: ${c.date}`,
  ];
  if (c.stats) {
    lines.push(`Stats: +${c.stats.additions} -${c.stats.deletions} (${c.stats.total} lines)`);
  }
  if (includeFiles && c.files && c.files.length > 0) {
    lines.push('Files changed:');
    for (const f of c.files) {
      lines.push(`  ${f.status.padEnd(8)} ${f.filename}  (+${f.additions} -${f.deletions})`);
      if (f.patch) {
        lines.push('  Diff:');
        lines.push(f.patch.split('\n').map((l: string) => '    ' + l).join('\n'));
      }
    }
  }
  return lines.join('\n');
}

// ─── Payload ──────────────────────────────────────────────────────────────────

export interface BuiltPrompt {
  system: string;
  user: string;
  featureId: AIFeatureId;
  promptVersion: string;
}

// ─── Feature: Explain commit ─────────────────────────────────────────────────

export function buildExplainCommitPrompt(ctx: AIContextPayload): BuiltPrompt {
  const commit = ctx.commits[0];
  if (!commit) throw new Error('No commit in context');

  const user = `${repoHeader(ctx)}

${formatCommit(commit, true)}

Explain this commit:
1. What changed and why (the intent behind the change)?
2. What problem does it solve or what feature does it add?
3. Are there any risks, side effects, or noteworthy patterns?

Keep the explanation under 200 words unless the commit is complex.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'explain_commit', promptVersion: PROMPT_VERSION };
}

// ─── Feature: Summarize branch ───────────────────────────────────────────────

export function buildSummarizeBranchPrompt(
  ctx: AIContextPayload,
  branchName: string,
): BuiltPrompt {
  const commitList = ctx.commits
    .map(c => `  • ${c.shortSha}  ${c.subject}  (${c.author}, ${c.date})`)
    .join('\n');

  const truncationNote = ctx.truncated
    ? `\n(Showing ${ctx.commits.length} of ${ctx.totalCommitsAvailable} commits — oldest commits omitted)`
    : '';

  const user = `${repoHeader(ctx)}

Branch: ${branchName}
Commits (newest first):
${commitList}${truncationNote}

Summarize this branch:
1. What is the overall purpose or theme of this branch?
2. What are the key changes made?
3. What is the estimated scope of work (small patch, medium feature, large refactor)?

Keep the summary under 150 words.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'summarize_branch', promptVersion: PROMPT_VERSION };
}

// ─── Feature: Where to start ─────────────────────────────────────────────────

export function buildWhereToStartPrompt(ctx: AIContextPayload): BuiltPrompt {
  const commitList = ctx.commits
    .slice(0, 15)
    .map(c => `  • ${c.shortSha}  ${c.subject}  (${c.author})`)
    .join('\n');

  const user = `${repoHeader(ctx)}

Recent commits:
${commitList}

I am new to this repository. Guide me on where to start:
1. What does this project do (based on commit history)?
2. Which files or areas seem most active or central?
3. What are the 2–3 best first commits to read to understand the codebase?

Be specific using the actual commit SHAs and subjects above.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'where_to_start', promptVersion: PROMPT_VERSION };
}

// ─── Feature: PR description ─────────────────────────────────────────────────

export function buildPRDescriptionPrompt(
  ctx: AIContextPayload,
  branchName: string,
  baseBranch: string,
): BuiltPrompt {
  const commitList = ctx.commits
    .map(c => `  • ${c.shortSha}  ${c.subject}`)
    .join('\n');

  const user = `${repoHeader(ctx)}

Branch: ${branchName} → ${baseBranch}
Commits:
${commitList}

Write a pull request description for merging this branch:
- Title (one line, imperative mood)
- Summary (2–3 sentences describing what and why)
- Key changes (bullet list, max 5 items)
- Testing notes (what should a reviewer check?)

Base the description only on the commits listed above.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'pr_description', promptVersion: PROMPT_VERSION };
}

// ─── Feature: Explain file (Phase 8) ─────────────────────────────────────────

export function buildExplainFilePrompt(ctx: AIContextPayload): BuiltPrompt {
  const es = ctx.editorState;
  if (!es) throw new Error('editorState required for explain_file');

  const selectionBlock = es.selectedText
    ? `\nSelected text (lines around cursor):\n\`\`\`${es.language}\n${es.selectedText}\n\`\`\``
    : '';

  const contentBlock = es.content && !es.selectedText
    ? `\nFile content:\n\`\`\`${es.language}\n${es.content}\n\`\`\``
    : '';

  const cursorNote = es.cursorLine
    ? ` (cursor at line ${es.cursorLine}, column ${es.cursorColumn ?? 1})`
    : '';

  const user = `${repoHeader(ctx)}

File: ${es.path} [${es.language}]${cursorNote}${selectionBlock}${contentBlock}

Explain this file:
1. What is the purpose of this file in the codebase?
2. What are the key functions, classes, or exports and what do they do?
3. Are there any notable patterns, dependencies, or design decisions?

Be concise — focus on what a developer needs to understand to work with this file.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'explain_file', promptVersion: PROMPT_VERSION };
}

// ─── Feature: Ask about code selection (Phase 8) ─────────────────────────────

export function buildAskAboutCodePrompt(
  ctx: AIContextPayload,
  question: string,
): BuiltPrompt {
  const es = ctx.editorState;
  if (!es) throw new Error('editorState required for ask_about_code');

  const selectionBlock = es.selectedText
    ? `\nSelected code:\n\`\`\`${es.language}\n${es.selectedText}\n\`\`\``
    : '';

  const contentBlock = es.content && !es.selectedText
    ? `\nFile content (${es.path}):\n\`\`\`${es.language}\n${es.content}\n\`\`\``
    : `\nFile: ${es.path} [${es.language}]`;

  const user = `${repoHeader(ctx)}
${contentBlock}${selectionBlock}

Question: ${question}

Answer the question focusing specifically on the code shown above.
If you need to reference line numbers, use the file content as shown.`;

  return { system: SYSTEM_PROMPT, user, featureId: 'ask_about_code', promptVersion: PROMPT_VERSION };
}

// ─── Unified dispatcher ───────────────────────────────────────────────────────

export interface BuildPromptOptions {
  featureId: AIFeatureId;
  ctx: AIContextPayload;
  branchName?: string;
  baseBranch?: string;
  /** Free-form question for the ask_about_code feature. */
  question?: string;
}

export function buildPrompt(opts: BuildPromptOptions): BuiltPrompt {
  const {
    featureId,
    ctx,
    branchName = ctx.repo.defaultBranch,
    baseBranch = ctx.repo.defaultBranch,
  } = opts;

  switch (featureId) {
    case 'explain_commit':
      return buildExplainCommitPrompt(ctx);
    case 'summarize_branch':
      return buildSummarizeBranchPrompt(ctx, branchName);
    case 'where_to_start':
      return buildWhereToStartPrompt(ctx);
    case 'pr_description':
      return buildPRDescriptionPrompt(ctx, branchName, baseBranch);
    case 'explain_file':
      return buildExplainFilePrompt(ctx);
    case 'ask_about_code':
      return buildAskAboutCodePrompt(ctx, opts.question ?? 'What does this code do?');
    default:
      throw new Error(`Unknown AI feature: ${featureId}`);
  }
}
