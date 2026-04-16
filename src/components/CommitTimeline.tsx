// ─── Interactive Commit Timeline ─────────────────────────────────────────────
//
// Renders a clearly visible date-marker strip alongside the graph canvas.
// • Vertical mode  → strip pinned to the RIGHT edge; ticks track graph Y
// • Horizontal mode → strip pinned to the BOTTOM edge; ticks track graph X
//
// Markers are screen-positioned via the live viewport transform so they always
// stay in sync as the user pans and zooms.  Clicking a marker smooth-pans to
// that point in time (handled by the parent GraphCanvas).
//
// Design goals:
//  - Readable at a glance in both dark and light themes (solid chip backgrounds)
//  - Year boundaries are more prominent than month boundaries
//  - No overlapping labels (minimum-gap enforcement)
//  - The strip sits right against the canvas edge so it feels attached to graph

import { useMemo } from 'react';
import type { GraphData, ViewportState } from '@/types';
import { GRAPH_PADDING_TOP, GRAPH_PADDING_LEFT, ROW_HEIGHT, COL_WIDTH } from '@/graph/colors';

interface CommitTimelineProps {
  graphData: GraphData;
  viewport: ViewportState;
  direction: 'vertical' | 'horizontal';
  canvasW: number;
  canvasH: number;
  onJump: (row: number) => void;
}

interface TimelineMarker {
  label: string;      // full label e.g. "Apr 2024"
  shortLabel: string; // short label e.g. "Apr" or "2024" for Jan
  row: number;
  isYear: boolean;    // true when this marker is a year boundary (Jan)
}

/** Scan graph nodes (sorted newest→oldest by row) to find month boundaries. */
function buildMarkers(graphData: GraphData): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  let prevKey = '';

  for (const node of graphData.nodes) {
    const d = new Date(node.commit.author.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key === prevKey) continue;
    prevKey = key;

    const isYear = d.getMonth() === 0; // January = year boundary
    markers.push({
      label: d.toLocaleDateString('en', { month: 'short', year: 'numeric' }),
      shortLabel: isYear
        ? String(d.getFullYear())
        : d.toLocaleDateString('en', { month: 'short' }),
      row: node.row,
      isYear,
    });
  }
  return markers;
}

// ─── Vertical strip (right edge of canvas) ────────────────────────────────────

function VerticalTimeline({
  graphData,
  viewport,
  canvasH,
  onJump,
}: Omit<CommitTimelineProps, 'direction' | 'canvasW'>) {
  const markers = useMemo(() => buildMarkers(graphData), [graphData]);

  // Minimum vertical pixel gap between two rendered labels
  const MIN_GAP = 18;

  return (
    <div
      className="absolute top-0 right-0 w-[52px] h-full pointer-events-none select-none z-20"
      aria-label="Commit timeline"
    >
      {/* Solid background strip so the timeline reads clearly over the canvas */}
      <div className="absolute inset-0 bg-card/80 backdrop-blur-[3px] border-l border-border/60" />

      {/* Render markers, suppressing those that would overlap the previous one */}
      {(() => {
        const rendered: JSX.Element[] = [];
        let lastScreenY = -Infinity;

        for (let i = 0; i < markers.length; i++) {
          const m = markers[i];
          const screenY =
            viewport.offsetY +
            (GRAPH_PADDING_TOP + m.row * ROW_HEIGHT) * viewport.scale;

          if (screenY < -2 || screenY > canvasH + 2) continue;

          // Skip if too close to the previous visible label
          const showLabel = screenY - lastScreenY >= MIN_GAP;
          if (showLabel) lastScreenY = screenY;

          rendered.push(
            <button
              key={m.row}
              className="absolute left-0 right-0 pointer-events-auto flex items-center group"
              style={{ top: screenY, transform: 'translateY(-50%)' }}
              onClick={() => onJump(m.row)}
              title={`Jump to ${m.label}`}
            >
              {/* Tick mark — wider and brighter for year boundaries */}
              <div
                className={`flex-shrink-0 h-px transition-colors
                  ${m.isYear
                    ? 'w-3 bg-foreground/50 group-hover:bg-primary'
                    : 'w-2 bg-border group-hover:bg-primary/70'
                  }`}
              />

              {showLabel && (
                <span
                  className={`ml-1 leading-none whitespace-nowrap transition-colors
                    ${m.isYear
                      ? 'text-[11px] font-bold text-foreground/80 group-hover:text-primary'
                      : 'text-[10px] font-medium text-muted-foreground group-hover:text-foreground'
                    }`}
                >
                  {m.shortLabel}
                </span>
              )}
            </button>,
          );
        }
        return rendered;
      })()}
    </div>
  );
}

// ─── Horizontal strip (bottom edge of canvas) ─────────────────────────────────

function HorizontalTimeline({
  graphData,
  viewport,
  canvasW,
  onJump,
}: Omit<CommitTimelineProps, 'direction' | 'canvasH'>) {
  const markers = useMemo(() => buildMarkers(graphData), [graphData]);

  const MIN_GAP = 36; // minimum horizontal pixel gap between labels

  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-[38px] pointer-events-none select-none z-20"
      aria-label="Commit timeline"
    >
      {/* Solid background strip */}
      <div className="absolute inset-0 bg-card/80 backdrop-blur-[3px] border-t border-border/60" />

      {(() => {
        const rendered: JSX.Element[] = [];
        let lastScreenX = -Infinity;

        for (let i = 0; i < markers.length; i++) {
          const m = markers[i];
          const screenX =
            viewport.offsetX +
            (GRAPH_PADDING_LEFT + m.row * COL_WIDTH) * viewport.scale;

          if (screenX < -2 || screenX > canvasW + 2) continue;

          const showLabel = screenX - lastScreenX >= MIN_GAP;
          if (showLabel) lastScreenX = screenX;

          rendered.push(
            <button
              key={m.row}
              className="absolute top-0 pointer-events-auto flex flex-col items-center group"
              style={{ left: screenX, transform: 'translateX(-50%)' }}
              onClick={() => onJump(m.row)}
              title={`Jump to ${m.label}`}
            >
              {/* Tick mark */}
              <div
                className={`w-px flex-shrink-0 transition-colors
                  ${m.isYear
                    ? 'h-3 bg-foreground/50 group-hover:bg-primary'
                    : 'h-2 bg-border group-hover:bg-primary/70'
                  }`}
              />

              {showLabel && (
                <span
                  className={`mt-0.5 leading-none whitespace-nowrap transition-colors
                    ${m.isYear
                      ? 'text-[11px] font-bold text-foreground/80 group-hover:text-primary'
                      : 'text-[10px] font-medium text-muted-foreground group-hover:text-foreground'
                    }`}
                >
                  {m.shortLabel}
                </span>
              )}
            </button>,
          );
        }
        return rendered;
      })()}
    </div>
  );
}

// ─── Exported wrapper ──────────────────────────────────────────────────────────

export default function CommitTimeline(props: CommitTimelineProps) {
  if (props.direction === 'horizontal') {
    return <HorizontalTimeline {...props} />;
  }
  return <VerticalTimeline {...props} />;
}
