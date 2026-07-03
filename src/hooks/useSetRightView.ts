// ─── Set-right-view event bus ───────────────────────────────────────────────
// Lets panels outside the IDE workspace shell (e.g. an AttachedPlanStrip
// docked in the chat) request that the right column switch to a specific view
// — without lifting `rightView` (currently local IDE-layout state persisted to
// localStorage) into the global reducer. IdeWorkspace registers the setter for
// the currently-mounted layout; callers fire `setRightView('plan')`.

import type { RightView } from '@/components/ide/BvConfigStrip';

type Setter = (view: RightView) => void;

let current: Setter | null = null;

/** IdeWorkspace registers the setter; returns an unregister fn to call on
 *  unmount so a stale closure never overwrites the fresh one. */
export function registerRightViewSetter(fn: Setter): () => void {
  current = fn;
  return () => {
    if (current === fn) current = null;
  };
}

/** Ask the IDE to switch its right column. No-op when the IDE isn't mounted. */
export function setRightView(view: RightView): boolean {
  if (!current) return false;
  current(view);
  return true;
}
