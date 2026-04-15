// ─── Git graph layout algorithm ───────────────────────────────────────────
//
// Produces a 2D lane/row layout for a git commit DAG.
//
// Algorithm overview:
//   1. Build parent→children and child→parents maps.
//   2. Topologically sort commits (Kahn's algorithm, newest-first by date within each level).
//   3. Walk sorted commits, assigning each to an "active lane".
//      - An active lane is one waiting for a specific parent sha.
//      - A commit takes the lane where it is expected (smallest index first).
//      - Merge commits cause the second+ parents to open new lanes.
//      - When a commit has no parents, its lane is freed.
//   4. Compute x/y pixel positions from lane/row indices.
//   5. Build edges from parent relationships.

import type { Branch, Commit, GraphData, GraphEdge, GraphNode, Tag } from '../types';
import { GRAPH_PADDING_LEFT, GRAPH_PADDING_TOP, LANE_WIDTH, ROW_HEIGHT, COL_WIDTH, LANE_HEIGHT, laneColor } from './colors';

// ─── Step 1: topological sort ─────────────────────────────────────────────

function topoSort(commits: Commit[]): Commit[] {
  const commitMap = new Map(commits.map(c => [c.sha, c]));

  // Build in-degree map: how many *children* (within our commit set) each commit has.
  // A commit with in-degree 0 is a leaf (HEAD / branch tip) — we start there.
  const inDegree = new Map<string, number>();

  for (const c of commits) {
    if (!inDegree.has(c.sha)) inDegree.set(c.sha, 0);
    for (const pSha of c.parents) {
      if (commitMap.has(pSha)) {
        inDegree.set(pSha, (inDegree.get(pSha) ?? 0) + 1);
      }
    }
  }

  // Pre-cache timestamps once — avoids repeated Date construction in the hot loop
  const tsOf = new Map<string, number>(
    commits.map(c => [c.sha, new Date(c.author.date).getTime()])
  );
  const byDateDesc = (a: Commit, b: Commit) =>
    (tsOf.get(b.sha) ?? 0) - (tsOf.get(a.sha) ?? 0);

  // Kahn's algorithm — process leaves first (newest commits have no children in our set).
  // We maintain the queue sorted descending by date so we always emit the newest first.
  // insertSorted keeps the queue ordered without a full re-sort each iteration.
  const insertSorted = (arr: Commit[], item: Commit) => {
    let lo = 0, hi = arr.length;
    const t = tsOf.get(item.sha) ?? 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tsOf.get(arr[mid].sha) ?? 0) >= t) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, item);
  };

  const queue: Commit[] = commits
    .filter(c => (inDegree.get(c.sha) ?? 0) === 0)
    .sort(byDateDesc);

  const sorted: Commit[] = [];

  while (queue.length > 0) {
    const commit = queue.shift()!;
    sorted.push(commit);

    for (const pSha of commit.parents) {
      if (!commitMap.has(pSha)) continue;
      const deg = (inDegree.get(pSha) ?? 1) - 1;
      inDegree.set(pSha, deg);
      if (deg === 0) {
        insertSorted(queue, commitMap.get(pSha)!);
      }
    }
  }

  // Graceful fallback: any commits not reached (shouldn't happen in valid git data)
  if (sorted.length < commits.length) {
    const sortedSet = new Set(sorted.map(c => c.sha));
    for (const c of commits) {
      if (!sortedSet.has(c.sha)) sorted.push(c);
    }
  }

  return sorted;
}

// ─── Step 2: lane assignment ──────────────────────────────────────────────

/**
 * Assigns each commit to a lane (column index).
 * Returns a map: sha → lane index.
 */
function assignLanes(sorted: Commit[]): Map<string, number> {
  // activeLanes[i] = sha of the commit we are currently waiting for in lane i
  // null means lane is free
  const activeLanes: Array<string | null> = [];
  const laneMap = new Map<string, number>();

  const claimLane = (sha: string): number => {
    // Return existing lane for this sha, or open new/reuse freed lane
    const existing = activeLanes.findIndex(s => s === sha);
    if (existing !== -1) return existing;

    const free = activeLanes.findIndex(s => s === null);
    if (free !== -1) {
      activeLanes[free] = sha;
      return free;
    }
    activeLanes.push(sha);
    return activeLanes.length - 1;
  };

  for (const commit of sorted) {
    // Find which lane is expecting this commit
    let lane = activeLanes.findIndex(s => s === commit.sha);

    if (lane === -1) {
      // No lane expected this commit → it's a branch tip (head)
      const free = activeLanes.findIndex(s => s === null);
      if (free !== -1) {
        lane = free;
        activeLanes[free] = commit.sha; // placeholder; will be replaced below
      } else {
        lane = activeLanes.length;
        activeLanes.push(commit.sha);
      }
    }

    laneMap.set(commit.sha, lane);

    if (commit.parents.length === 0) {
      // Root commit — free the lane
      activeLanes[lane] = null;
    } else {
      // Continue this lane toward first parent
      activeLanes[lane] = commit.parents[0];

      // Additional parents (merge commits) — open a lane for each if not already tracked
      for (let p = 1; p < commit.parents.length; p++) {
        claimLane(commit.parents[p]);
      }
    }

    // Compact: trim trailing nulls to keep lane count tidy
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }
  }

  return laneMap;
}

// ─── Step 3: assemble graph ───────────────────────────────────────────────

export function buildGraphData(
  commits: Commit[],
  branches: Branch[],
  tags: Tag[],
): GraphData {
  if (commits.length === 0) {
    return {
      nodes: [],
      edges: [],
      commitMap: new Map(),
      tagMap: new Map(),
      branchMap: new Map(),
      laneCount: 0,
      rowCount: 0,
    };
  }

  const sorted = topoSort(commits);
  const laneMap = assignLanes(sorted);

  // ─── Build lookup maps ──────────────────────────────────────────────
  const tagMap = new Map<string, Tag[]>();
  for (const tag of tags) {
    const list = tagMap.get(tag.commitSha) ?? [];
    list.push(tag);
    tagMap.set(tag.commitSha, list);
  }

  const branchMap = new Map<string, Branch[]>();
  for (const branch of branches) {
    const list = branchMap.get(branch.sha) ?? [];
    list.push(branch);
    branchMap.set(branch.sha, list);
  }

  // ─── Compute max lane count ─────────────────────────────────────────
  let laneCount = 0;
  for (const lane of laneMap.values()) {
    if (lane + 1 > laneCount) laneCount = lane + 1;
  }

  // ─── Build nodes ────────────────────────────────────────────────────
  const nodes: GraphNode[] = sorted.map((commit, row) => {
    const lane = laneMap.get(commit.sha) ?? 0;
    const color = laneColor(lane);
    return {
      commit,
      lane,
      row,
      color,
      x: GRAPH_PADDING_LEFT + lane * LANE_WIDTH,
      y: GRAPH_PADDING_TOP + row * ROW_HEIGHT,
    };
  });

  const commitMap = new Map<string, GraphNode>(nodes.map(n => [n.commit.sha, n]));

  // ─── Build edges ────────────────────────────────────────────────────
  const edges: GraphEdge[] = [];

  for (const node of nodes) {
    const { commit } = node;
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parentNode = commitMap.get(commit.parents[pi]);
      if (!parentNode) continue; // parent outside our window

      // Edge color: use the lane that "owns" this connection
      // For first parent, use node color; for merge parents, use parent color
      const edgeColor = pi === 0 ? node.color : parentNode.color;

      edges.push({
        fromSha: commit.sha,
        toSha: commit.parents[pi],
        fromLane: node.lane,
        toLane: parentNode.lane,
        fromRow: node.row,
        toRow: parentNode.row,
        color: edgeColor,
        isMergeEdge: pi > 0,
      });
    }
  }

  return {
    nodes,
    edges,
    commitMap,
    tagMap,
    branchMap,
    laneCount,
    rowCount: sorted.length,
  };
}

// ─── Utility: filter graph by visible rows (viewport culling) ─────────────

export function visibleRows(
  graph: GraphData,
  viewportY: number,
  viewportH: number,
  scale: number,
): { minRow: number; maxRow: number } {
  const topRow = Math.max(0, Math.floor((viewportY / scale - GRAPH_PADDING_TOP) / ROW_HEIGHT) - 2);
  const bottomRow = Math.min(
    graph.rowCount - 1,
    Math.ceil(((viewportY + viewportH) / scale - GRAPH_PADDING_TOP) / ROW_HEIGHT) + 2,
  );
  return { minRow: topRow, maxRow: bottomRow };
}

// ─── Utility: compute canvas position from node ────────────────────────────

export function nodeX(node: GraphNode, dir: 'vertical' | 'horizontal' = 'vertical'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_LEFT + node.row * COL_WIDTH
    : GRAPH_PADDING_LEFT + node.lane * LANE_WIDTH;
}

export function nodeY(node: GraphNode, dir: 'vertical' | 'horizontal' = 'vertical'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_TOP + node.lane * LANE_HEIGHT
    : GRAPH_PADDING_TOP + node.row * ROW_HEIGHT;
}

// ─── Utility: hit test (find nearest node to a canvas point) ──────────────

export function hitTestNode(
  graph: GraphData,
  canvasX: number,
  canvasY: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  hitRadius = 10,
  direction: 'vertical' | 'horizontal' = 'vertical',
): GraphNode | null {
  const gx = (canvasX - offsetX) / scale;
  const gy = (canvasY - offsetY) / scale;

  // Estimate row range based on direction
  let approxRow: number;
  let spacing: number;
  if (direction === 'horizontal') {
    approxRow = Math.round((gx - GRAPH_PADDING_LEFT) / COL_WIDTH);
    spacing = COL_WIDTH;
  } else {
    approxRow = Math.round((gy - GRAPH_PADDING_TOP) / ROW_HEIGHT);
    spacing = ROW_HEIGHT;
  }

  const rowBuffer = Math.ceil(hitRadius / spacing) + 1;

  let best: GraphNode | null = null;
  let bestDist = hitRadius * hitRadius;

  const minR = Math.max(0, approxRow - rowBuffer);
  const maxR = Math.min(graph.rowCount - 1, approxRow + rowBuffer);

  for (let r = minR; r <= maxR; r++) {
    const node = graph.nodes[r];
    if (!node) continue;
    const nx = nodeX(node, direction);
    const ny = nodeY(node, direction);
    const dx = gx - nx;
    const dy = gy - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      best = node;
    }
  }

  return best;
}
