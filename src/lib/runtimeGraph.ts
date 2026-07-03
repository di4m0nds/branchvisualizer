// ─── Compose → graph adapter ─────────────────────────────────────────────────
// Reuses the git-commit graph engine (buildGraphData/renderGraph) for the compose
// service-dependency DAG by mapping each service to a minimal synthetic `Commit`:
//   sha         = service name
//   parents     = depends_on (a service's dependencies are its "ancestors")
//   author.date = a monotonic ordinal so topo tie-breaking is deterministic
// Branches/tags are empty — the renderer tolerates empty ref maps.

import type { Commit, GraphData } from '@/types';
import { buildGraphData } from '@/graph/layout';
import type { ComposeService } from '@/types/runtime';

function serviceToCommit(svc: ComposeService, index: number, known: Set<string>): Commit {
  // Only keep depends_on edges that point at services we actually have, so the
  // topo sort never references a non-existent parent.
  const parents = svc.dependsOn.filter((d) => known.has(d));
  const date = new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString();
  return {
    sha: svc.name,
    shortSha: svc.name.slice(0, 12),
    message: svc.name,
    subject: svc.name,
    body: svc.image ?? '',
    author: { name: svc.name, email: '', date },
    committer: { name: svc.name, email: '', date },
    parents,
    isMerge: parents.length > 1,
  };
}

/** Build renderable GraphData from compose services (empty when no services). */
export function composeToGraphData(services: ComposeService[]): GraphData {
  const known = new Set(services.map((s) => s.name));
  const commits = services.map((s, i) => serviceToCommit(s, i, known));
  return buildGraphData(commits, [], []);
}
