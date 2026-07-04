import { useAppSelector } from '@/store/store';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { fetchCommitDetails, type CommitDetails } from '@/lib/github';
import { fetchCommitDetails as fetchLocalCommitDetails } from '@/lib/localGit';
import type { GraphNode } from '@/types';

// ─── Commit detail fetcher (shared hook) ─────────────────────────────────────

export function useCommitDetails(node: GraphNode | null) {
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const source = useAppSelector((s) => s.source);
  const localPath = useAppSelector((s) => s.localPath);
  const sha = node?.commit.sha ?? null;

  const { data: commitDetails, loading: detailsLoading } = useAsyncResource<CommitDetails>(
    () =>
      source === 'local' && localPath
        ? fetchLocalCommitDetails(localPath, sha!)
        : fetchCommitDetails(repoInfo!.owner, repoInfo!.repo, sha!),
    [sha, source, localPath, repoInfo?.owner, repoInfo?.repo],
    { enabled: !!sha && !!repoInfo, scope: 'commit-details' },
  );

  return { commitDetails, detailsLoading };
}
