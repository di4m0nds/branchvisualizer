// ─── Canvas 2D graph renderer ─────────────────────────────────────────────
//
// All drawing is done on a raw Canvas 2D context for maximum performance.
// Viewport culling ensures only visible rows are processed each frame.
// requestAnimationFrame is used by the caller; this file only draws.

import type { GraphData, GraphEdge, GraphNode, Tag, Branch } from '../types';
import {
  GRAPH_PADDING_LEFT,
  GRAPH_PADDING_TOP,
  LANE_WIDTH,
  LANE_HEIGHT,
  COL_WIDTH,
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
  /** Pass 'light' to switch canvas colors for the light theme */
  theme?: 'dark' | 'light';
  /** Layout direction; default 'vertical' */
  direction?: 'vertical' | 'horizontal';
  /** Elapsed ms since animation start — drives orbiting arc and dashed edges */
  animTime?: number;
}

// ─── Direction-aware coordinate helpers ───────────────────────────────────

export function nodeCanvasX(node: GraphNode, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_LEFT + node.row * COL_WIDTH
    : GRAPH_PADDING_LEFT + node.lane * LANE_WIDTH;
}

export function nodeCanvasY(node: GraphNode, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_TOP + node.lane * LANE_HEIGHT
    : GRAPH_PADDING_TOP + node.row * ROW_HEIGHT;
}

function edgeX1(edge: GraphEdge, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_LEFT + edge.fromRow * COL_WIDTH
    : GRAPH_PADDING_LEFT + edge.fromLane * LANE_WIDTH;
}
function edgeY1(edge: GraphEdge, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_TOP + edge.fromLane * LANE_HEIGHT
    : GRAPH_PADDING_TOP + edge.fromRow * ROW_HEIGHT;
}
function edgeX2(edge: GraphEdge, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_LEFT + edge.toRow * COL_WIDTH
    : GRAPH_PADDING_LEFT + edge.toLane * LANE_WIDTH;
}
function edgeY2(edge: GraphEdge, dir: 'vertical' | 'horizontal'): number {
  return dir === 'horizontal'
    ? GRAPH_PADDING_TOP + edge.toLane * LANE_HEIGHT
    : GRAPH_PADDING_TOP + edge.toRow * ROW_HEIGHT;
}

// ─── Text truncation cache ─────────────────────────────────────────────────
const TEXT_CACHE_MAX = 4096;
const textCache = new Map<string, string>();
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const key = `${text}::${maxWidth}`;
  if (textCache.has(key)) return textCache.get(key)!;
  if (textCache.size >= TEXT_CACHE_MAX) {
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

// ─── Theme-aware color palette ────────────────────────────────────────────
interface ThemeColors {
  bg: string;
  text: string;
  textMuted: string;
  rail: string;
  railAlpha: number;
  tagBg: string;
  tagText: string;
  branchBg: string;
  branchText: string;
  selectedRing: string;
}

function getThemeColors(theme: 'dark' | 'light'): ThemeColors {
  if (theme === 'light') {
    return {
      bg: '#f6f7fb',
      text: '#1e293b',
      textMuted: '#64748b',
      rail: '#000000',
      railAlpha: 0.06,
      tagBg: '#fef3c7',
      tagText: '#92400e',
      branchBg: '#ede9fe',
      branchText: '#5b21b6',
      selectedRing: '#6366f1',
    };
  }
  return {
    bg: '#0d1117',
    text: '#dde4f0',
    textMuted: '#5d6d88',
    rail: '#ffffff',
    railAlpha: 0.04,
    tagBg: '#3d2200',
    tagText: '#f5c542',
    branchBg: '#1a1740',
    branchText: '#9fb3f8',
    selectedRing: '#7c6ef8',
  };
}

// ─── Main render function ─────────────────────────────────────────────────

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  opts: RenderOptions,
): void {
  const { width, height, scale, offsetX, offsetY, selectedSha, hoveredSha, highlightedShas } = opts;
  const theme = opts.theme ?? 'dark';
  const dir = opts.direction ?? 'vertical';
  const colors = getThemeColors(theme);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // ── Viewport culling in graph-space
  let minRow: number, maxRow: number;
  if (dir === 'vertical') {
    const graphTop = -offsetY / scale;
    const graphBottom = (height - offsetY) / scale;
    minRow = Math.max(0, Math.floor((graphTop - GRAPH_PADDING_TOP) / ROW_HEIGHT) - 1);
    maxRow = Math.min(graph.rowCount - 1, Math.ceil((graphBottom - GRAPH_PADDING_TOP) / ROW_HEIGHT) + 1);
  } else {
    // horizontal: cull by x (column = row)
    const graphLeft = -offsetX / scale;
    const graphRight = (width - offsetX) / scale;
    minRow = Math.max(0, Math.floor((graphLeft - GRAPH_PADDING_LEFT) / COL_WIDTH) - 1);
    maxRow = Math.min(graph.rowCount - 1, Math.ceil((graphRight - GRAPH_PADDING_LEFT) / COL_WIDTH) + 1);
  }

  const animTime = opts.animTime ?? 0;

  drawLaneRails(ctx, graph, minRow, maxRow, colors, dir);
  drawEdges(ctx, graph, minRow, maxRow, selectedSha, highlightedShas, dir, animTime);
  drawNodes(ctx, graph, minRow, maxRow, selectedSha, hoveredSha, highlightedShas, colors, dir, animTime);

  if (scale > 0.35) {
    drawLabels(ctx, graph, minRow, maxRow, selectedSha, highlightedShas, opts, colors, dir);
  }

  ctx.restore();
}

// ─── Lane rails ──────────────────────────────────────────────────────────

function drawLaneRails(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  minRow: number,
  maxRow: number,
  colors: ThemeColors,
  dir: 'vertical' | 'horizontal',
): void {
  if (graph.laneCount === 0) return;

  ctx.save();
  ctx.globalAlpha = colors.railAlpha;
  ctx.strokeStyle = colors.rail;
  ctx.lineWidth = 1;

  if (dir === 'vertical') {
    const yTop = GRAPH_PADDING_TOP + minRow * ROW_HEIGHT;
    const yBottom = GRAPH_PADDING_TOP + maxRow * ROW_HEIGHT;
    for (let lane = 0; lane < graph.laneCount; lane++) {
      const x = GRAPH_PADDING_LEFT + lane * LANE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBottom);
      ctx.stroke();
    }
  } else {
    const xLeft = GRAPH_PADDING_LEFT + minRow * COL_WIDTH;
    const xRight = GRAPH_PADDING_LEFT + maxRow * COL_WIDTH;
    for (let lane = 0; lane < graph.laneCount; lane++) {
      const y = GRAPH_PADDING_TOP + lane * LANE_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(xLeft, y);
      ctx.lineTo(xRight, y);
      ctx.stroke();
    }
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
  dir: 'vertical' | 'horizontal',
  animTime: number,
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

    const isConnected = selectedSha === edge.fromSha || selectedSha === edge.toSha;

    ctx.globalAlpha = isHighlighted ? (isConnected ? 1 : 0.75) : 0.18;
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = isConnected ? 2.5 : 1.5;

    if (isConnected && animTime > 0) {
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -(animTime * 0.045) % 10;
    } else {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    drawEdgePath(ctx, edge, dir);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
}

function drawEdgePath(ctx: CanvasRenderingContext2D, edge: GraphEdge, dir: 'vertical' | 'horizontal'): void {
  const x1 = edgeX1(edge, dir);
  const y1 = edgeY1(edge, dir);
  const x2 = edgeX2(edge, dir);
  const y2 = edgeY2(edge, dir);

  ctx.beginPath();
  ctx.moveTo(x1, y1);

  if (dir === 'vertical') {
    if (edge.fromLane === edge.toLane) {
      ctx.lineTo(x2, y2);
    } else {
      const rowDiff = edge.toRow - edge.fromRow;
      const midY = y1 + (rowDiff * ROW_HEIGHT * 0.45);
      ctx.bezierCurveTo(x1, midY, x2, y2 - (rowDiff * ROW_HEIGHT * 0.35), x2, y2);
    }
  } else {
    // horizontal: from = newer (right side source), to = older (left side parent)
    if (edge.fromLane === edge.toLane) {
      ctx.lineTo(x2, y2);
    } else {
      const colDiff = edge.toRow - edge.fromRow;
      const midX = x1 + (colDiff * COL_WIDTH * 0.45);
      ctx.bezierCurveTo(midX, y1, x2 - (colDiff * COL_WIDTH * 0.35), y2, x2, y2);
    }
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
  colors: ThemeColors,
  dir: 'vertical' | 'horizontal',
  animTime: number,
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
    const alpha = isHighlighted ? 1 : 0.18;

    const nx = nodeCanvasX(node, dir);
    const ny = nodeCanvasY(node, dir);

    ctx.globalAlpha = alpha;

    // ── Glow layers (selected or hovered) ─────────────────────────────────
    if ((isSelected || isHovered) && isHighlighted) {
      ctx.save();
      // Outer glow
      ctx.globalAlpha = isSelected ? 0.08 : 0.05;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(nx, ny, radius + 14, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow
      ctx.globalAlpha = isSelected ? 0.18 : 0.12;
      ctx.beginPath();
      ctx.arc(nx, ny, radius + 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ── Node fill ──────────────────────────────────────────────────────────
    ctx.fillStyle = isSelected ? colors.selectedRing : node.color;
    ctx.beginPath();
    ctx.arc(nx, ny, radius, 0, Math.PI * 2);
    ctx.fill();

    // ── Inner specular highlight ───────────────────────────────────────────
    if (isHighlighted) {
      ctx.save();
      ctx.globalAlpha = isSelected ? 0.45 : 0.28;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(nx - radius * 0.28, ny - radius * 0.28, radius * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Stroke ring ────────────────────────────────────────────────────────
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? colors.selectedRing : node.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (node.commit.isMerge) {
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Orbiting dashed arc (selected + animating) ─────────────────────────
    if (isSelected && animTime > 0) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = colors.selectedRing;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.lineDashOffset = -(animTime * 0.06) % 8;
      ctx.beginPath();
      ctx.arc(nx, ny, radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.restore();
    }

    // ── Tag / branch dot ───────────────────────────────────────────────────
    const hasTags = graph.tagMap.has(sha);
    const hasBranches = graph.branchMap.has(sha);
    if ((hasTags || hasBranches) && isHighlighted) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = hasTags ? colors.tagText : '#34d399';
      ctx.beginPath();
      ctx.arc(nx + radius, ny - radius, 2.5, 0, Math.PI * 2);
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
  colors: ThemeColors,
  dir: 'vertical' | 'horizontal',
): void {
  ctx.save();
  ctx.textBaseline = 'middle';

  for (let r = minRow; r <= maxRow; r++) {
    const node = graph.nodes[r];
    if (!node) continue;

    const sha = node.commit.sha;
    const isHighlighted = !highlightedShas || highlightedShas.has(sha);
    const isSelected = sha === selectedSha;

    const nx = nodeCanvasX(node, dir);
    const ny = nodeCanvasY(node, dir);

    if (dir === 'vertical') {
      // Labels to the right of the node column
      const labelStartX = GRAPH_PADDING_LEFT + graph.laneCount * LANE_WIDTH + 14;
      const maxLabelWidth = 360;
      drawNodeLabelsVertical(ctx, graph, node, sha, nx, ny, labelStartX, maxLabelWidth, isHighlighted, isSelected, opts, colors);
    } else {
      // Labels below each node in horizontal mode
      const labelY = ny + LANE_HEIGHT * 0.5 + 4;
      drawNodeLabelsHorizontal(ctx, node, sha, nx, labelY, isHighlighted, isSelected, colors);
    }
  }

  ctx.restore();
}

function drawNodeLabelsVertical(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  node: GraphNode,
  sha: string,
  _nx: number,
  ny: number,
  labelStartX: number,
  maxLabelWidth: number,
  isHighlighted: boolean,
  isSelected: boolean,
  opts: RenderOptions,
  colors: ThemeColors,
): void {
  const nodeBranches = graph.branchMap.get(sha);
  const nodeTags = graph.tagMap.get(sha);

  let bx = labelStartX;

  if (nodeBranches) {
    for (const branch of nodeBranches) {
      ctx.globalAlpha = isHighlighted ? 0.9 : 0.2;
      ctx.font = LABEL_FONT;
      const label = branch.name;
      const tw = ctx.measureText(label).width;
      const padding = 5;
      ctx.fillStyle = colors.branchBg;
      roundRect(ctx, bx - padding, ny - 8, tw + padding * 2, 16, 3);
      ctx.fill();
      ctx.fillStyle = colors.branchText;
      ctx.fillText(label, bx, ny);
      bx += tw + padding * 2 + 4;
    }
  }

  if (nodeTags) {
    for (const tag of nodeTags) {
      ctx.globalAlpha = isHighlighted ? 0.9 : 0.2;
      ctx.font = LABEL_FONT;
      const label = tag.name;
      const tw = ctx.measureText(label).width;
      const padding = 5;
      ctx.fillStyle = colors.tagBg;
      roundRect(ctx, bx - padding, ny - 8, tw + padding * 2, 16, 3);
      ctx.fill();
      ctx.fillStyle = colors.tagText;
      ctx.fillText(label, bx, ny);
      bx += tw + padding * 2 + 4;
    }
  }

  if (opts.showMessages || isSelected) {
    ctx.globalAlpha = isHighlighted ? (isSelected ? 1 : 0.65) : 0.18;
    ctx.font = MSG_FONT;
    ctx.fillStyle = isSelected ? colors.text : colors.textMuted;
    const msg = truncate(ctx, node.commit.subject, maxLabelWidth - (bx - labelStartX));
    ctx.fillText(msg, bx, ny);
  }
}

function drawNodeLabelsHorizontal(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  _sha: string,
  nx: number,
  labelY: number,
  isHighlighted: boolean,
  isSelected: boolean,
  colors: ThemeColors,
): void {
  ctx.globalAlpha = isHighlighted ? (isSelected ? 0.9 : 0.6) : 0.15;
  ctx.font = '9px "SF Mono", monospace';
  ctx.fillStyle = node.color;
  ctx.textAlign = 'center';
  ctx.fillText(node.commit.shortSha, nx, labelY);
  ctx.textAlign = 'left';
}

// ─── Utilities ────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
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
  for (const node of graph.nodes) {
    const mx = Math.floor((node.lane / Math.max(graph.laneCount, 1)) * minimapW);
    const my = Math.floor((node.y / totalH) * minimapH);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(mx, my, Math.max(laneW, 1), 1);
  }

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

// ─── Graph dimensions ─────────────────────────────────────────────────────

export function graphHeight(rowCount: number, direction: 'vertical' | 'horizontal' = 'vertical', laneCount = 1): number {
  if (direction === 'horizontal') {
    return GRAPH_PADDING_TOP * 2 + laneCount * LANE_HEIGHT;
  }
  return GRAPH_PADDING_TOP * 2 + rowCount * ROW_HEIGHT;
}

export function graphWidth(rowCount: number, direction: 'vertical' | 'horizontal' = 'vertical', laneCount = 1): number {
  if (direction === 'horizontal') {
    return GRAPH_PADDING_LEFT * 2 + rowCount * COL_WIDTH;
  }
  return GRAPH_PADDING_LEFT * 2 + laneCount * LANE_WIDTH + 400; // +400 for labels
}
