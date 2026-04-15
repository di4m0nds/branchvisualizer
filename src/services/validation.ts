/**
 * Validation service — Zod schemas for all user inputs.
 */
import { z } from 'zod';

// ─── GitHub repo URL / slug ───────────────────────────────────────────────

const GITHUB_URL_PATTERN =
  /^(?:https?:\/\/(?:www\.)?github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)\/?(?:\.git)?(?:[#?].*)?$/;

export const repoInputSchema = z
  .string()
  .min(1, 'Enter a repository URL or owner/repo')
  .transform((val) => val.trim())
  .refine(
    (val) => GITHUB_URL_PATTERN.test(val),
    'Must be a GitHub URL or owner/repo (e.g. torvalds/linux)',
  );

/** Parse a repo URL/slug and return { owner, repo } or throw ZodError */
export function parseRepoInput(raw: string): { owner: string; repo: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(GITHUB_URL_PATTERN);
  if (!match) {
    throw new Error('Invalid GitHub repository URL or slug');
  }
  return { owner: match[1], repo: match[2] };
}

/** Validate without throwing — returns { ok, error } */
export function validateRepoInput(raw: string): { ok: boolean; error?: string } {
  const result = repoInputSchema.safeParse(raw);
  if (result.success) return { ok: true };
  return { ok: false, error: result.error.issues[0]?.message };
}

// ─── GitHub personal access token ────────────────────────────────────────

export const tokenSchema = z
  .string()
  .optional()
  .refine(
    (val) => !val || /^ghp_[a-zA-Z0-9]{36}$|^github_pat_[a-zA-Z0-9_]{82}$|^[a-zA-Z0-9]{40}$/.test(val),
    'Invalid GitHub token format',
  );
