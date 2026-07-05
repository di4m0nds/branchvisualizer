import { useLayoutEffect, type RefObject } from 'react';

/**
 * Auto-grow a textarea with its content between minPx and maxPx, then scroll.
 * Height is recomputed synchronously on every value change (measure at
 * height:auto → clamp scrollHeight), so the composer grows to ~4 lines and
 * stays put while typing continues.
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minPx = 56, maxPx = 112 }: { minPx?: number; maxPx?: number } = {},
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minPx), maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [ref, value, minPx, maxPx]);
}
