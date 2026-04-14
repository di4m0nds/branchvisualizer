// ─── Canvas 2D graph renderer ─────────────────────────────────────────────
//
// All drawing is done on a raw Canvas 2D context for maximum performance.
// Viewport culling ensures only visible rows are processed each frame.
// requestAnimationFrame is used by the caller; this file only draws.

import type { GraphData, GraphEdge, Tag, Branch } from '../types';
import {
  GRAPH_PADDING_LEFT,
  GRAPH_PADDING_TOP,
  LANE_WIDTH,
  MERGE_NODE_RADIUS,
  NODE_RADIUS,
  ROW_HEIGHT,
} from './colors';

export interface RenderOptions {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  selectedSha: string | null;
  hoveredSha: string | null;
  highlightedShas: Set<string> | null; // null = no filter active
  showMessages: boolean;
}

// ─── Text truncation cache ─────────────────────────────────────────────────
// Avoids repeated ctx.measureText calls per frame.
// Capped at 4096 entries (LRU-lite: clear oldest half when full).
const TEXT_CACHE_MAX = 4096;
const textCache = new Map<string, string>();
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const key = `${text}::${maxWidth}`;
  if (textCache.has(key)) return textCache.get(key)!;
  if (textCache.size >= TEXT_CACHE_MAX) {
    // Evict first half — Map preserves insertion order
    const keys = Array.from(textCache.keys());
    for (let i = 0; i < TEXT_CACHE_MAX >> 1; i++) textCache.delete(keys[i]);
  }
  if (ctx.measureText(text).width <= maxWidth) {
    textCache.set(key, text);
    return text;
  }
  let lo = 0, hi = text.length;
  const ellipsis = '…';
  const ellW = ctx.measureText(ellipsis).width;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width + ellW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const result = lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
  textCache.set(key, result);
  return result;
}

// ─── Main render function ─────────────────────────────────────────────────

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  opts: RenderOptions,
): void {
  const { width, height, scale, offsetX, offsetY, selectedSha, hoveredSha, highlightedShas } = opts;

  // ── Clear
  ctx.clearRect(0, 0, width, height);

  // ── Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // ── Viewport bounds in graph-space (for culling)
  const graphTop = -offsetY / scale;
  const graphBottom = (height - offsetY) / scale;
  const minRow = Math.max(0, Math.floor((graphTop - GRAPH_PADDING_TOP) / ROW_HEIGHT) - 1);
  const maxRow = Math.min(graph.rowCount - 1, Math.ceil((graphBottom - GRAPH_PADDING_TOP) / ROW_HEIGHT) + 1);

  // ── Lane rails (faint vertical lines behind everything)
  drawLaneRails(ctx, graph, minRow, maxRow);

  // ── Edges
  drawEdges(ctx, graph, minRow, maxRow, selectedSha, highlightedShas);

  // ── Nodes
  drawNodes(ctx, graph, minRow, maxRow, selectedSha, hoveredSha, highlightedShas);

  // ── Labels (branch / tag / commit message)
  if (scale > 0.35) {
    drawLabels(ctx, graph, minRow, maxRow, selectedSha, highlightedShas, opts);
  }

  ctx.restore();
}

// ─── Lane rails ──────────────────────────────────────────────────────────

function drawLaneRails(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  minRow: number,
  maxRow: number,
): void {
  if (graph.laneCount === 0) return;
  const yTop = GRAPH_PADDING_TOP + minRow * ROW_HEIGHT;
  const yBottom = GRAPH_PADDING_TOP + maxRow * ROW_HEIGHT;

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;

  for (let lane = 0; lane < graph.laneCount; lane++) {
    const x = GRAPH_PADDING_LEFT + lane * LANE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Edges ────────────────────────────────────────────────────────────────

function edgeVisible(edge: GraphEdge, minRow: number, maxRow: number): boolean {
  return edge.fromRow <= maxRow && edge.toRow >= minRow;
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  minRow: number,
  maxRow: number,
  selectedSha: string | null,
  highlightedShas: Set<string> | null,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const edge of graph.edges) {
    if (!edgeVisible(edge, minRow, maxRow)) continue;

    const isHighlighted =
      !highlightedShas ||
      highlightedShas.has(edge.fromSha) ||
      highlightedShas.has(edge.toSha);

    const isSelected =
      selectedSha === edge.fromSha || selectedSha === edge.toSha;

    ctx.globalAlpha = isHighlighted ? (isSelected ? 1 : 0.85) : 0.2;
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;

    drawEdgePath(ctx, edge);
    ctx.stroke();
  }

  ctx.restore();
}

function drawEdgePath(ctx: CanvasRenderingContext2D, edge: GraphEdge): void {
  const x1 = GRAPH_PADDING_LEFT + edge.fromLane * LANE_WIDTH;
  const y1 = GRAPH_PADDING_TOP + edge.fromRow * ROW_HEIGHT;
  const x2 = GRAPH_PADDING_LEFT + edge.toLane * LANE_WIDTH;
  const y2 = GRAPH_PADDING_TOP + edge.toRow * ROW_HEIGHT;

  ctx.beginPath();
  ctx.moveTo(x1, y1);

  if (edge.fromLane === edge.toLane) {
    // Straight vertical line (same lane)
    ctx.lineTo(x2, y2);
  } else {
    // Bezier curve — exit downward, arrive from above
    const rowDiff = edge.toRow - edge.fromRow;
    const midY = y1 + (rowDiff * ROW_HEIGHT * 0.45);
    ctx.bezierCurveTo(x1, midY, x2, y2 - (rowDiff * ROW_HEIGHT * 0.35), x2, y2);
  }
}

// ─── Nodes ────────────────────────────────────────────────────────────────

function drawNodes(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  minRow: number,
  maxRow: number,
  selectedSha: string | null,
  hoveredSha: string | null,
  highlightedShas: Set<string> | null,
): void {
  ctx.save();

  for (let r = minRow; r <= maxRow; r++) {
    const node = graph.nodes[r];
    if (!node) continue;

    const sha = node.commit.sha;
    const isSelected = sha === selectedSha;
    const isHovered = sha === hoveredSha;
    const isHighlighted = !highlightedShas || highlightedShas.has(sha);

    const radius = node.commit.isMerge ? MERGE_NODE_RADIUS : NODE_RADIUS;
    const alpha = isHighlighted ? 1 : 0.2;

    ctx.globalAlpha = alpha;

    // Glow for selected/hovered
    if ((isSelected || isHovered) && isHighlighted) {
      ctx.save();
      ctx.globalAlpha = isSelected ? 0.35 : 0.2;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Node fill
    ctx.fillStyle = isSelected ? '#ffffff' : node.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Node stroke
    if (isSelected || isHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.stroke();
    } else if (node.commit.isMerge) {
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.6;
      ctx.stroke();
    }

    // Tag/branch indicator dot
    const hasTags = graph.tagMap.has(sha);
    const hasBranches = graph.branchMap.has(sha);
    if ((hasTags || hasBranches) && isHighlighted) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = hasTags ? '#facc15' : '#34d399';
      ctx.beginPath();
      ctx.arc(node.x + radius, node.y - radius, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ─── Labels ───────────────────────────────────────────────────────────────

const LABEL_FONT = '11px "SF Mono", "Fira Code", "Cascadia Code", monospace';
const MSG_FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function drawLabels(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  minRow: number,
  maxRow: number,
  selectedSha: string | null,
  highlightedShas: Set<string> | null,
  opts: RenderOptions,
): void {
  const labelStartX = GRAPH_PADDING_LEFT + graph.laneCount * LANE_WIDTH + 14;
  const maxLabelWidth = 360;

  ctx.save();
  ctx.textBaseline = 'middle';

  for (let r = minRow; r <= maxRow; r++) {
    const node = graph.nodes[r];
    if (!node) continue;

    const sha = node.commit.sha;
    const isHighlighted = !highlightedShas || highlightedShas.has(sha);
    const isSelected = sha === selectedSha;

    const y = node.y;

    // ── Branch labels
    const nodeBranches = graph.branchMap.get(sha);
    if (nodeBranches) {
      let bx = labelStartX;
      for (const branch of nodeBranches) {
        ctx.globalAlpha = isHighlighted ? 0.9 : 0.2;
        ctx.font = LABEL_FONT;
        const label = branch.name;
        const tw = ctx.measureText(label).width;
        const padding = 5;

        // pill background
        ctx.fillStyle = branch.isDefault ? '#1d4ed8' : '#1e3a5f';
        const rx = bx - padding;
        const ry = y - 8;
        const rw = tw + padding * 2;
        const rh = 16;
        roundRect(ctx, rx, ry, rw, rh, 3);
        ctx.fill();

        ctx.fillStyle = branch.isDefault ? '#93c5fd' : '#60a5fa';
        ctx.fillText(label, bx, y);
        bx += rw + 4;
      }
    }

    // ── Tag labels
    const nodeTags = graph.tagMap.get(sha);
    if (nodeTags) {
      let tx = (nodeBranches
        ? labelStartX + nodeBranches.reduce((s, b) => s + ctx.measureText(b.name).width + 16, 0)
        : labelStartX);
      for (const tag of nodeTags) {
        ctx.globalAlpha = isHighlighted ? 0.9 : 0.2;
        ctx.font = LABEL_FONT;
        const label = tag.name;
        const tw = ctx.measureText(label).width;
        const padding = 5;

        ctx.fillStyle = '#422006';
        roundRect(ctx, tx - padding, y - 8, tw + padding * 2, 16, 3);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.fillText(label, tx, y);
        tx += tw + padding * 2 + 4;
      }
    }

    // ── Commit message (only when scale is large enough)
    if (opts.showMessages || isSelected) {
      ctx.globalAlpha = isHighlighted ? (isSelected ? 1 : 0.65) : 0.18;
      ctx.font = MSG_FONT;

      // Determine x start: after any badges or default offset
      let msgX = labelStartX;
      if (nodeBranches || nodeTags) {
        msgX = labelStartX + estimateBadgeWidth(ctx, nodeBranches ?? [], nodeTags ?? []) + 8;
      }

      ctx.fillStyle = isSelected ? '#f0f6fc' : '#8b949e';
      const msg = truncate(ctx, node.commit.subject, maxLabelWidth - (msgX - labelStartX));
      ctx.fillText(msg, msgX, y);
    }
  }

  ctx.restore();
}

function estimateBadgeWidth(
  ctx: CanvasRenderingContext2D,
  branches: Branch[],
  tags: Tag[],
): number {
  let w = 0;
  ctx.font = LABEL_FONT;
  for (const b of branches) w += ctx.measureText(b.name).width + 14;
  for (const t of tags) w += ctx.measureText(t.name).width + 14;
  return w;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Minimap ──────────────────────────────────────────────────────────────
// A lightweight overview strip showing where we are in the full graph.

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  viewportY: number,
  viewportH: number,
  totalH: number,
  minimapH: number,
  minimapW: number,
): void {
  if (graph.rowCount === 0) return;

  ctx.clearRect(0, 0, minimapW, minimapH);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, minimapW, minimapH);

  const scaleY = minimapH / totalH;
  const laneW = Math.max(1, Math.floor(minimapW / (graph.laneCount || 1)));

  ctx.save();
  // Draw nodes as tiny dots
  for (const node of graph.nodes) {
    const mx = Math.floor((node.lane / Math.max(graph.laneCount, 1)) * minimapW);
    const my = Math.floor((node.y / totalH) * minimapH);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(mx, my, Math.max(laneW, 1), 1);
  }

  // Viewport indicator
  const vTop = Math.floor(-viewportY * scaleY);
  const vH = Math.max(4, Math.floor(viewportH * scaleY));
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, vTop, minimapW, vH);
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, vTop + 0.5, minimapW - 1, vH - 1);

  ctx.restore();
}

// ─── Total graph height ───────────────────────────────────────────────────
export function graphHeight(rowCount: number): number {
  return GRAPH_PADDING_TOP * 2 + rowCount * ROW_HEIGHT;
}
