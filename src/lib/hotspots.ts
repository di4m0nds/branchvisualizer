// Pure computation — no React/DOM imports
import type { CommitDetails } from '@codeatlas/github';

export interface HotspotEntry {
  filename: string;
  changeCount: number;
  additions: number;
  deletions: number;
  /** Normalized 0–1 relative to the highest-churn file */
  score: number;
}

// Module-level cache keyed by "owner/repo/headSha"
const _cache = new Map<string, HotspotEntry[]>();

export function clearHotspotsCache(): void {
  _cache.clear();
}

export function computeHotspots(
  details: CommitDetails[],
  cacheKey: string,
): HotspotEntry[] {
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  // Aggregate per-file stats across all commit details
  const fileMap = new Map<string, { changeCount: number; additions: number; deletions: number }>();

  for (const d of details) {
    for (const f of d.files) {
      const existing = fileMap.get(f.filename) ?? { changeCount: 0, additions: 0, deletions: 0 };
      fileMap.set(f.filename, {
        changeCount: existing.changeCount + 1,
        additions: existing.additions + f.additions,
        deletions: existing.deletions + f.deletions,
      });
    }
  }

  if (fileMap.size === 0) {
    _cache.set(cacheKey, []);
    return [];
  }

  // Sort descending by churn (changeCount)
  const sorted = Array.from(fileMap.entries())
    .map(([filename, stats]) => ({ filename, ...stats }))
    .sort((a, b) => b.changeCount - a.changeCount);

  const maxCount = sorted[0]?.changeCount ?? 1;

  const result: HotspotEntry[] = sorted.map(entry => ({
    filename: entry.filename,
    changeCount: entry.changeCount,
    additions: entry.additions,
    deletions: entry.deletions,
    score: entry.changeCount / maxCount,
  }));

  _cache.set(cacheKey, result);
  return result;
}
