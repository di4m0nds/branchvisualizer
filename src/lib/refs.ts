// ─── Checkpoint ref/commit detection ─────────────────────────────────────────
// The t3 checkpoint system writes a commit per snapshot under
// `refs/t3/checkpoints/*`, each with a subject like
// "t3 checkpoint ref=refs/t3/checkpoints/<hash>". These dominate the graph, so
// we hide them by default and expose a toggle (see TabWorkspace / reducer).

import type { Commit } from '@/types';

/** True when a ref/branch name is a t3 checkpoint ref. */
export function isCheckpointRef(name: string): boolean {
  return name.startsWith('refs/t3/checkpoints/') || name.includes('/checkpoints/');
}

/** True when a commit is a t3 checkpoint snapshot commit. */
export function isCheckpointCommit(c: Pick<Commit, 'subject' | 'message'>): boolean {
  const subject = (c.subject ?? '').trim();
  if (/^t3 checkpoint\b/i.test(subject)) return true;
  const blob = `${c.subject ?? ''} ${c.message ?? ''}`;
  return blob.includes('refs/t3/checkpoints/');
}

/** Drop checkpoint commits unless `show` is true. */
export function filterCheckpoints<T extends Pick<Commit, 'subject' | 'message'>>(
  commits: T[],
  show: boolean,
): T[] {
  return show ? commits : commits.filter((c) => !isCheckpointCommit(c));
}
