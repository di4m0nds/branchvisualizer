// ─── Canvas 2D graph renderer ─────────────────────────────────────────────
//
// All drawing is done on a raw Canvas 2D context for maximum performance.
// Viewport culling ensures only visible rows are processed each frame.
// requestAnimationFrame is used by the caller; this file only draws.

import type { GraphData, GraphEdge, GraphNode } from '../types';
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

export interface DragState {
  sha: string;
  dx: number; // offset in graph-space units
  dy: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  selectedSha: string | null;
  /** Set of all selected SHAs (for multi-select highlighting) */
  selectedShas?: Set<string> | null;
  hoveredSha: string | null;
  highlightedShas: Set<string> | null; // null = no filter active
  showMessages: boolean;
  /** Pass 'light' to switch canvas colors for the light theme */
  theme?: 'dark' | 'light';
  /** Layout direction; default 'vertical' */
  direction?: 'vertical' | 'horizontal';
  /** Elapsed ms since animation start — drives orbiting arc and dashed edges */
  animTime?: number;
  /** Active node drag for elastic spring animation */
  dragState?: DragState | null;
  /** Mouse cursor in graph-space — for magnetic attraction effect */
  mouseGx?: number;
  mouseGy?: number;
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

  // Build displacement map once per frame — all sub-functions read from it
  // so node positions and wire endpoints are always consistent.
  const dispMap = opts.dragState
    ? buildDisplacementMap(opts.dragState, graph)
    : null;

  const multiSelectedShas = opts.selectedShas ?? null;

  drawLaneRails(ctx, graph, minRow, maxRow, colors, dir);
  drawEdges(ctx, graph, minRow, maxRow, selectedSha, highlightedShas, dir, animTime, opts.dragState ?? null, dispMap, multiSelectedShas);
  drawNodes(ctx, graph, minRow, maxRow, selectedSha, hoveredSha, highlightedShas, colors, dir, animTime, opts.dragState ?? null, dispMap, opts.mouseGx, opts.mouseGy, multiSelectedShas);

  if (scale > 0.35) {
    drawLabels(ctx, graph, minRow, maxRow, selectedSha, highlightedShas, opts, colors, dir, opts.dragState ?? null, dispMap, multiSelectedShas);
  }

  // Elastic drag overlay — drawn on top of everything else
  if (opts.dragState && dispMap) {
    drawElasticDrag(ctx, graph, opts.dragState, dir, colors, dispMap);
  }

  ctx.restore();
}

// ─── Elastic drag overlay ─────────────────────────────────────────────────
//
// Draws spring-like bezier lines from the dragged node to its connected
// neighbours, then redraws the node at its displaced position on top.

function drawElasticDrag(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  drag: DragState,
  dir: 'vertical' | 'horizontal',
  _colors: ThemeColors,
  dispMap: Map<string, { dx: number; dy: number }>,
): void {
  const dragNode = graph.commitMap.get(drag.sha);
  if (!dragNode) return;

  const originX = nodeCanvasX(dragNode, dir);
  const originY = nodeCanvasY(dragNode, dir);
  const px = originX + drag.dx;
  const py = originY + drag.dy;

  const stretch = Math.hypot(drag.dx, drag.dy);
  // tension 0 → 1 as stretch grows (saturates at ~160 px)
  const tension = Math.min(stretch / 160, 1);

  ctx.save();

  // ── Elastic edges to direct (hop-1) neighbors ─────────────────────────
  const connectedShas = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.fromSha === drag.sha) connectedShas.add(edge.toSha);
    else if (edge.toSha === drag.sha) connectedShas.add(edge.fromSha);
  }

  for (const sha of connectedShas) {
    const other = graph.commitMap.get(sha);
    if (!other) continue;

    // Use the dispMap (built by buildDisplacementMap) so wire endpoints
    // land exactly on the rendered node positions — no floating wires.
    const disp = dispMap.get(sha) ?? { dx: 0, dy: 0 };
    const ox = nodeCanvasX(other, dir) + disp.dx;
    const oy = nodeCanvasY(other, dir) + disp.dy;

    // Bezier control point: anchor near the dragged-node origin so the curve
    // bows toward the origin as tension increases (realistic elastic look)
    const cx1 = originX + (ox - originX) * 0.40;
    const cy1 = originY + (oy - originY) * 0.40;

    // Thickness grows with tension
    const baseWidth = 1.5 + tension * 3.5;

    ctx.globalAlpha = 0.50 + tension * 0.30;
    ctx.strokeStyle = dragNode.color;
    ctx.lineWidth = baseWidth;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(cx1, cy1, ox, oy);
    ctx.stroke();

    // Highlight shimmer — stretched rubber band shimmer
    ctx.globalAlpha = 0.15 + tension * 0.15;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = baseWidth * 0.35;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(cx1, cy1, ox, oy);
    ctx.stroke();

    // Redraw connected node at its shifted position so it visually anchors
    // the end of the elastic wire
    const oRadius = other.commit.isMerge ? MERGE_NODE_RADIUS : NODE_RADIUS;
    ctx.globalAlpha = 0.6 + tension * 0.25;
    ctx.fillStyle = other.color;
    ctx.beginPath();
    ctx.arc(ox, oy, oRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.20;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ox - oRadius * 0.28, oy - oRadius * 0.28, oRadius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Dragged node redrawn at offset position ───────────────────────────
  const radius = dragNode.commit.isMerge ? MERGE_NODE_RADIUS : NODE_RADIUS;

  // Outer glow scales with tension
  ctx.globalAlpha = 0.12 + tension * 0.08;
  ctx.fillStyle = dragNode.color;
  ctx.beginPath();
  ctx.arc(px, py, radius + 10 + tension * 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.25 + tension * 0.15;
  ctx.beginPath();
  ctx.arc(px, py, radius + 5 + tension * 4, 0, Math.PI * 2);
  ctx.fill();

  // Node body
  ctx.globalAlpha = 1;
  ctx.fillStyle = dragNode.color;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px - radius * 0.28, py - radius * 0.28, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // Stroke ring — color shifts to white under high tension
  ctx.globalAlpha = 1;
  const ringColor = tension > 0.5
    ? `hsl(${Math.round(tension * 60)}, 100%, 75%)`
    : dragNode.color;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 2 + tension * 1.5;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Dashed orbit ring — spins faster under tension
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.lineDashOffset = -(performance.now() * (0.04 + tension * 0.12)) % 7;
  ctx.beginPath();
  ctx.arc(px, py, radius + 6 + tension * 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

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
  dragState: DragState | null,
  dispMap: Map<string, { dx: number; dy: number }> | null,
  multiSelectedShas?: Set<string> | null,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const edge of graph.edges) {
    if (!edgeVisible(edge, minRow, maxRow)) continue;
    // Skip edges directly on dragged node — drawElasticDrag draws elastic spring lines
    if (dragState && (edge.fromSha === dragState.sha || edge.toSha === dragState.sha)) continue;

    const isHighlighted =
      !highlightedShas ||
      highlightedShas.has(edge.fromSha) ||
      highlightedShas.has(edge.toSha);

    // isConnected: edge touches the primary selected node (for animation) or any multi-selected node
    const isPrimaryConnected = selectedSha === edge.fromSha || selectedSha === edge.toSha;
    const isMultiConnected = multiSelectedShas
      ? (multiSelectedShas.has(edge.fromSha) || multiSelectedShas.has(edge.toSha))
      : false;
    const isConnected = isPrimaryConnected || isMultiConnected;

    ctx.globalAlpha = isHighlighted ? (isConnected ? 1 : 0.75) : 0.18;
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = isConnected ? 2.5 : 1.5;

    if (isConnected && animTime > 0) {
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = (animTime * 0.045) % 10;
    } else {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Apply per-node displacement to edge endpoints so wires follow displaced nodes
    const fromDisp = dispMap?.get(edge.fromSha) ?? { dx: 0, dy: 0 };
    const toDisp   = dispMap?.get(edge.toSha)   ?? { dx: 0, dy: 0 };
    drawEdgePath(ctx, edge, dir, fromDisp, toDisp);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
}

function drawEdgePath(
  ctx: CanvasRenderingContext2D,
  edge: GraphEdge,
  dir: 'vertical' | 'horizontal',
  fromDisp = { dx: 0, dy: 0 },
  toDisp   = { dx: 0, dy: 0 },
): void {
  const x1 = edgeX1(edge, dir) + fromDisp.dx;
  const y1 = edgeY1(edge, dir) + fromDisp.dy;
  const x2 = edgeX2(edge, dir) + toDisp.dx;
  const y2 = edgeY2(edge, dir) + toDisp.dy;

  ctx.beginPath();
  ctx.moveTo(x1, y1);

  if (dir === 'vertical') {
    if (edge.fromLane === edge.toLane) {
      ctx.lineTo(x2, y2);
    } else {
      const dy = y2 - y1;
      const midY = y1 + dy * 0.45;
      ctx.bezierCurveTo(x1, midY, x2, y2 - dy * 0.35, x2, y2);
    }
  } else {
    if (edge.fromLane === edge.toLane) {
      ctx.lineTo(x2, y2);
    } else {
      const dx = x2 - x1;
      const midX = x1 + dx * 0.45;
      ctx.bezierCurveTo(midX, y1, x2 - dx * 0.35, y2, x2, y2);
    }
  }
}

// ─── Nodes ────────────────────────────────────────────────────────────────

// Mouse attraction constants
const ATTRACT_RADIUS = 48;   // graph-space pixels of attraction influence
const ATTRACT_STRENGTH = 0.13; // max fraction of distance to pull toward cursor

// Secondary pull: connected nodes follow the drag with this fraction.
// Decreases as drag distance grows (rubber band stiffens), so pulling far
// feels like real elastic resistance. Starts at ~30% and fades toward 0.
// Both drawNodes and drawElasticDrag MUST use this same function so wire
// endpoints always coincide with the rendered node positions.
function secondaryPull(dragDist: number): number {
  return 0.30 * Math.exp(-dragDist / 180);
}

/** BFS displacement map — dragged node gets its full offset; each hop away
 *  decays by DECAY (45 %), up to MAX_HOPS hops.  All draw functions read
 *  from this map so node positions and wire endpoints are always in sync. */
function buildDisplacementMap(
  drag: DragState,
  graph: GraphData,
): Map<string, { dx: number; dy: number }> {
  const dragDist = Math.hypot(drag.dx, drag.dy);
  const basePull = secondaryPull(dragDist);
  const DECAY    = 0.45;
  const MAX_HOPS = 4;

  const dispMap = new Map<string, { dx: number; dy: number }>();
  dispMap.set(drag.sha, { dx: drag.dx, dy: drag.dy });

  // Build undirected adjacency from edge list
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.fromSha)) adj.set(edge.fromSha, []);
    if (!adj.has(edge.toSha))   adj.set(edge.toSha,   []);
    adj.get(edge.fromSha)!.push(edge.toSha);
    adj.get(edge.toSha)!.push(edge.fromSha);
  }

  let frontier = [drag.sha];
  let pull = basePull;

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0 && pull > 0.004; hop++) {
    const next: string[] = [];
    for (const sha of frontier) {
      for (const nb of (adj.get(sha) ?? [])) {
        if (dispMap.has(nb)) continue;
        dispMap.set(nb, { dx: drag.dx * pull, dy: drag.dy * pull });
        next.push(nb);
      }
    }
    frontier = next;
    pull *= DECAY;
  }

  return dispMap;
}

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
  dragState: DragState | null,
  dispMap: Map<string, { dx: number; dy: number }> | null,
  mouseGx?: number,
  mouseGy?: number,
  multiSelectedShas?: Set<string> | null,
): void {
  ctx.save();

  for (let r = minRow; r <= maxRow; r++) {
    const node = graph.nodes[r];
    if (!node) continue;

    const sha = node.commit.sha;

    // Hide the dragged node at its rest position — drawElasticDrag redraws it at offset position
    if (dragState && sha === dragState.sha) continue;

    const isSelected = sha === selectedSha;
    const isMultiSelected = !isSelected && (multiSelectedShas?.has(sha) ?? false);
    const isHovered = sha === hoveredSha;
    const isHighlighted = !highlightedShas || highlightedShas.has(sha);

    const radius = node.commit.isMerge ? MERGE_NODE_RADIUS : NODE_RADIUS;
    const alpha = isHighlighted ? 1 : 0.18;

    let nx = nodeCanvasX(node, dir);
    let ny = nodeCanvasY(node, dir);

    // Multi-hop displacement: wave propagates from dragged node outward.
    // dispMap contains pre-computed { dx, dy } for each reachable node.
    const disp = dispMap?.get(sha);
    if (disp) {
      nx += disp.dx;
      ny += disp.dy;
    }

    // Mouse attraction: nodes subtly drift toward nearby cursor (no drag, not while animating drag)
    if (!dragState && mouseGx !== undefined && mouseGy !== undefined) {
      const dist = Math.hypot(nx - mouseGx, ny - mouseGy);
      if (dist < ATTRACT_RADIUS && dist > 1) {
        const factor = (1 - dist / ATTRACT_RADIUS) * ATTRACT_STRENGTH;
        nx += (mouseGx - nx) * factor;
        ny += (mouseGy - ny) * factor;
      }
    }

    ctx.globalAlpha = alpha;

    // ── Glow layers (selected, multi-selected or hovered) ─────────────────
    if ((isSelected || isMultiSelected || isHovered) && isHighlighted) {
      ctx.save();
      // Outer glow
      ctx.globalAlpha = isSelected ? 0.08 : isMultiSelected ? 0.06 : 0.05;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(nx, ny, radius + 14, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow
      ctx.globalAlpha = isSelected ? 0.18 : isMultiSelected ? 0.14 : 0.12;
      ctx.beginPath();
      ctx.arc(nx, ny, radius + 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ── Node fill ──────────────────────────────────────────────────────────
    ctx.fillStyle = (isSelected || isMultiSelected) ? colors.selectedRing : node.color;
    ctx.beginPath();
    ctx.arc(nx, ny, radius, 0, Math.PI * 2);
    ctx.fill();

    // ── Inner specular highlight ───────────────────────────────────────────
    if (isHighlighted) {
      ctx.save();
      ctx.globalAlpha = (isSelected || isMultiSelected) ? 0.45 : 0.28;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(nx - radius * 0.28, ny - radius * 0.28, radius * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Stroke ring ────────────────────────────────────────────────────────
    if (isSelected || isMultiSelected || isHovered) {
      ctx.strokeStyle = (isSelected || isMultiSelected) ? colors.selectedRing : node.color;
      ctx.lineWidth = (isSelected || isMultiSelected) ? 2.5 : 1.5;
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

    // ── Orbiting dashed arc (any selected node — primary or multi) ────────────
    if ((isSelected || isMultiSelected) && isHighlighted && animTime > 0) {
      ctx.save();
      ctx.globalAlpha = isSelected ? 0.75 : 0.55;
      ctx.strokeStyle = colors.selectedRing;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.lineDashOffset = (animTime * 0.06) % 8;
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
  dragState: DragState | null,
  dispMap: Map<string, { dx: number; dy: number }> | null,
  multiSelectedShas?: Set<string> | null,
): void {
  ctx.save();
  ctx.textBaseline = 'middle';

  for (let r = minRow; r <= maxRow; r++) {
    const node = graph.nodes[r];
    if (!node) continue;

    const sha = node.commit.sha;
    // Hide label for dragged node — drawElasticDrag redraws the node at offset position
    if (dragState && sha === dragState.sha) continue;

    const isHighlighted = !highlightedShas || highlightedShas.has(sha);
    const isSelected = sha === selectedSha || (multiSelectedShas?.has(sha) ?? false);

    const disp = dispMap?.get(sha);
    const nx = nodeCanvasX(node, dir) + (disp?.dx ?? 0);
    const ny = nodeCanvasY(node, dir) + (disp?.dy ?? 0);

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
  _colors: ThemeColors,
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
