// ─── System prompt ──────────────────────────────────────────────────────────
// The system-prompt document IS the agent's system prompt (embedded verbatim).
// Per-turn volatile context (<session_context>) is injected separately as a
// mid-conversation {role:'system'} message so the cached prefix stays intact.

import type { Session, SkillFlag } from '@/types/session';
import { getPrompt, renderPrompt } from './prompts';

/** The base prompt (cache prefix). Read through the prompt registry so user
 *  overrides from Settings → Prompts apply on the next request. */
export function baseSystemPrompt(): string {
  return getPrompt('base_system');
}

function activeSkills(skills: SkillFlag[]): string {
  const on = skills
    .filter((s) => s.enabled)
    .map((s) => getPrompt(`skill_fragment.${s.id}`))
    .filter(Boolean);
  return on.length ? on.map((s) => `- ${s}`).join('\n') : '(none)';
}

/** Who is actually serving this turn — resolved from the live transport so the
 *  model identifies as what it really is (Gemini says Gemini, etc.) instead of
 *  the base doc's example identity. */
export interface ModelIdentity {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
}

/**
 * Render the volatile `<session_context>` block for the current turn. Delivered
 * as a mid-conversation system message so it doesn't invalidate the cached base
 * prompt (Opus 4.8 mid-conversation system messages). `identity` (when provided)
 * injects the real serving model/provider so the agent never claims a false one.
 */
export function renderSessionContext(session: Session, identity?: ModelIdentity): string {
  const c = session.context;
  // Derive the project label from the repo identity (not session.title, which
  // is now a user-facing conversation title that can be renamed/auto-derived).
  const projectName = session.repoSource === 'local'
    ? ((session.cwd ?? session.repoRef).replace(/[/\\]+$/, '').split(/[/\\]/).pop() || session.repoRef)
    : session.repoRef;
  return [
    '<session_context>',
    `  <session_id>${session.id}</session_id>`,
    `  <project_name>${projectName}</project_name>`,
    `  <model_id>${identity?.modelId ?? 'unknown'}</model_id>`,
    `  <model_name>${identity?.modelLabel ?? 'unknown'}</model_name>`,
    `  <provider>${identity?.providerId ?? 'unknown'}</provider>`,
    `  <provider_name>${identity?.providerLabel ?? 'unknown'}</provider_name>`,
    `  <access_level>${c.accessLevel}</access_level>`,
    `  <build_mode>${c.buildMode}</build_mode>`,
    `  <reasoning_budget>${c.reasoningBudget}</reasoning_budget>`,
    `  <deep_thinking>${c.deepThinking}</deep_thinking>`,
    `  <deep_coding>${c.deepCoding}</deep_coding>`,
    `  <fast_mode>${c.fastMode}</fast_mode>`,
    `  <context_tokens_used>${c.contextTokens.used}</context_tokens_used>`,
    `  <context_tokens_max>${c.contextTokens.max}</context_tokens_max>`,
    `  <git_branch>${c.gitBranch ?? 'unknown'}</git_branch>`,
    `  <git_status>${c.gitStatusSummary ?? 'unknown'}</git_status>`,
    `  <repo_source>${session.repoSource}</repo_source>`,
    `  <cwd>${session.cwd ?? 'n/a'}</cwd>`,
    '  <skills>',
    activeSkills(c.skills).split('\n').map((l) => `    ${l}`).join('\n'),
    '  </skills>',
    '  <pinned_rules>',
    ...c.pinnedRules.map((r) => `    <rule>${r.text}</rule>`),
    '  </pinned_rules>',
    `  <session_state>${c.status}</session_state>`,
    '</session_context>',
    '',
    renderPrompt('session_identity_clause', {
      model_label: identity?.modelLabel ?? 'the model named in <model_name>',
      model_id: identity?.modelId ?? 'see <model_id>',
      provider_label: identity?.providerLabel ?? 'the provider named in <provider_name>',
    }),
    getPrompt('session_context_footer'),
  ].join('\n');
}
