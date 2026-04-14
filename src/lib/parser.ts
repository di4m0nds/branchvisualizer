// ─── GitHub URL parsing and validation ────────────────────────────────────

export interface ParsedRepo {
  owner: string;
  repo: string;
}

/** Patterns we support:
 *  https://github.com/owner/repo
 *  https://github.com/owner/repo.git
 *  https://github.com/owner/repo/tree/branch
 *  https://github.com/owner/repo/commit/sha
 *  git@github.com:owner/repo.git
 *  owner/repo  (shorthand)
 */
const PATTERNS = [
  // Full HTTPS URL (with optional .git and trailing paths)
  /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/,
  // SSH URL
  /^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/,
  // Shorthand owner/repo
  /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/,
];

export function parseGitHubURL(input: string): ParsedRepo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const pattern of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const owner = match[1];
      const repo = match[2].replace(/\.git$/, '');
      if (isValidSegment(owner) && isValidSegment(repo)) {
        return { owner, repo };
      }
    }
  }

  return null;
}

/** Validates a single URL path segment (owner or repo name). */
function isValidSegment(segment: string): boolean {
  if (!segment || segment.length === 0 || segment.length > 100) return false;
  // GitHub names: alphanumeric, hyphens, underscores, periods
  // Cannot start or end with a hyphen or period
  if (/^[-.]|[-.]$/.test(segment)) return false;
  if (!/^[a-zA-Z0-9_.-]+$/.test(segment)) return false;
  return true;
}

export function formatRepoURL(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}
