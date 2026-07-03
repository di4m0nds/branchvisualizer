import { useEffect, useRef, useState } from 'react';

// ─── Streaming text renderer ─────────────────────────────────────────────────
// Word-by-word typewriter for the assistant's live prose. The design is tuned
// for cheap machines and integrated GPUs:
//
//  • Rendered-length ticker (requestAnimationFrame): advances `displayedLen`
//    toward `text.length` at a fixed char/frame rate, so a chunky provider
//    delta (Claude Code CLI can dump 2 000+ chars in one NDJSON line) still
//    reveals progressively — no wall-of-text flash. When the source turn ends
//    we speed up so the caret snaps to the end without lingering.
//
//  • Settled prefix + animated tail: the settled prefix renders as ONE plain
//    string (zero motion, zero reconciliation) and only the trailing window of
//    freshly-revealed words gets animated. Tokens are keyed by absolute char
//    offset so surviving tail tokens never remount/re-animate, and older tail
//    tokens fold into the static prefix — bounding the animated set.
//
//  • CSS-only motion: instead of one framer-motion component per token, each
//    new token is a plain <span> with a `tw-animate-css` fade+slide utility
//    (`animate-in fade-in slide-in-from-bottom-1 duration-150`). That maps to
//    a GPU-composited `transform` + `opacity` keyframe — dramatically cheaper
//    than a JS-driven animation on low-end hardware.
//
//  • Adaptive skips: for VERY long messages (>8 KB) or when the tab is hidden,
//    we skip token animation entirely and just show the static text with a
//    caret. Same for `prefers-reduced-motion`.

const REVEAL_PER_FRAME = 40;        // chars/frame while streaming (~2400 c/s at 60fps)
const CATCHUP_PER_FRAME = 220;      // chars/frame after streaming ends (fast snap)
const TAIL_WINDOW = 180;            // shorter tail = fewer DOM nodes animating at once
const SKIP_ANIM_ABOVE = 8_000;      // very long messages skip token motion entirely

// One-time global check — cheap and stable per session.
const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function StreamingText({ text, streaming = true }: { text: string; streaming?: boolean }) {
  const [displayedLen, setDisplayedLen] = useState(0);
  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );
  const rafRef = useRef<number | null>(null);
  const settledLenRef = useRef(0);
  // The ticker reads the freshest text/streaming/progress from refs instead of
  // effect deps, so a token update grows the target without tearing down and
  // rescheduling the rAF loop on every render (the old churn: ~40 restarts/sec).
  const displayedRef = useRef(0);
  const textRef = useRef(text);
  const streamingRef = useRef(streaming);
  textRef.current = text;
  streamingRef.current = streaming;

  // Pause the ticker while the tab is hidden — rAF often keeps firing, but the
  // OS may throttle it heavily; the extra state churn helps nothing.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Reset when the source shrinks (new turn) — otherwise slice() into fresh
  // text would render stale offsets.
  useEffect(() => {
    if (displayedRef.current > text.length) {
      displayedRef.current = 0;
      settledLenRef.current = 0;
      setDisplayedLen(0);
    }
  }, [text]);

  // Ticker: a single rAF loop that advances the revealed length toward the
  // current text length, then STOPS when caught up. Re-armed when `text` grows
  // (new tokens) or the tab becomes visible. For very long turns it jumps
  // straight to full length — the caret still blinks so it reads as in-progress.
  useEffect(() => {
    if (!tabVisible) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }
    const step = () => {
      const t = textRef.current;
      if (t.length > SKIP_ANIM_ABOVE) {
        if (displayedRef.current !== t.length) { displayedRef.current = t.length; setDisplayedLen(t.length); }
        rafRef.current = null;
        return;
      }
      if (displayedRef.current >= t.length) { rafRef.current = null; return; }
      const rate = streamingRef.current ? REVEAL_PER_FRAME : CATCHUP_PER_FRAME;
      const next = Math.min(t.length, displayedRef.current + rate);
      displayedRef.current = next;
      setDisplayedLen(next);
      rafRef.current = requestAnimationFrame(step);
    };
    // Arm the loop only if it isn't already running and there's work to do.
    if (rafRef.current === null && displayedRef.current < text.length) {
      rafRef.current = requestAnimationFrame(step);
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [text, tabVisible]);

  const shown = text.slice(0, displayedLen);

  // Advance the settled boundary monotonically to a whitespace so a word never
  // splits between the static prefix and the animated tail.
  let settledLen = settledLenRef.current;
  const target = Math.max(settledLen, displayedLen - TAIL_WINDOW);
  let snap = Math.min(target, displayedLen);
  while (snap < displayedLen && !/\s/.test(shown[snap])) snap += 1;
  settledLen = Math.max(settledLen, snap);
  if (settledLen > displayedLen) settledLen = displayedLen;
  settledLenRef.current = settledLen;

  const settled = shown.slice(0, settledLen);
  const tail = shown.slice(settledLen);
  const done = !streaming && displayedLen >= text.length;
  const disableTokenAnim = PREFERS_REDUCED_MOTION || text.length > SKIP_ANIM_ABOVE;

  // Fast path: no per-token motion — one static string + caret. Used for very
  // long messages and reduced-motion users.
  if (disableTokenAnim) {
    return (
      <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
        {shown}
        {!done && <Caret />}
      </p>
    );
  }

  // Animated path: split the tail on whitespace, animate NEW words only.
  const parts = tail.split(/(\s+)/);
  let offset = settledLen;
  const nodes = parts.map((part) => {
    const key = offset;
    offset += part.length;
    if (!part) return null;
    if (/^\s+$/.test(part)) return <span key={key}>{part}</span>;
    return (
      <span
        key={key}
        className="inline-block animate-in fade-in slide-in-from-bottom-1 duration-150"
        style={{ whiteSpace: 'pre' }}
      >
        {part}
      </span>
    );
  });

  return (
    <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
      {settled}
      {nodes}
      {!done && <Caret />}
    </p>
  );
}

// Blinking caret — a single element, CSS-driven (no JS animation loop).
function Caret() {
  return (
    <span
      aria-hidden
      className="inline-block w-[2px] h-[1em] -mb-[0.15em] ml-0.5 bg-primary/70 align-baseline animate-pulse"
    />
  );
}
