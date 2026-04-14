// ─── Branch color palette ─────────────────────────────────────────────────
// Colors chosen for contrast on a dark background and to be distinct from each other.

export const LANE_COLORS = [
  '#60a5fa', // blue      — default / main branch
  '#34d399', // emerald
  '#f472b6', // pink
  '#fb923c', // orange
  '#a78bfa', // violet
  '#38bdf8', // sky blue
  '#facc15', // yellow
  '#f87171', // red
  '#4ade80', // green
  '#e879f9', // fuchsia
  '#2dd4bf', // teal
  '#fbbf24', // amber
  '#818cf8', // indigo
  '#fb7185', // rose
  '#86efac', // light green
  '#93c5fd', // light blue
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export const NODE_RADIUS = 5;
export const MERGE_NODE_RADIUS = 6;
export const LANE_WIDTH = 20;      // horizontal spacing between lanes
export const ROW_HEIGHT = 28;      // vertical spacing between commits
export const LABEL_OFFSET_X = 14; // offset from last lane to start of commit message text
export const GRAPH_PADDING_TOP = 20;
export const GRAPH_PADDING_LEFT = 16;
