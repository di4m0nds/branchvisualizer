// ─── Session lifecycle side effects ──────────────────────────────────────────
// CLOSE_SESSION is a pure state transition; anything that must happen in the
// outside world when a session goes away belongs here. Currently: removing the
// per-project Podman sandbox container when the LAST session on that project
// root closes.

import { invoke, isTauri } from './platform';
import { dispatch, getAppState } from '@/store/store';
import { sessionProjectKey } from '@/types/session';
import { swallow } from './log';

/**
 * Close a session, tearing down its Podman sandbox container when no other
 * open session shares the same project root. Best-effort — teardown failures
 * never block the close (the app-exit hook removes leftovers anyway). The
 * container name is derived Rust-side from the canonical root.
 */
export function closeSession(id: string): void {
  const { sessions } = getAppState();
  const closing = sessions.find((s) => s.id === id);

  if (closing && isTauri() && closing.context.sandbox?.enabled && closing.cwd) {
    const key = sessionProjectKey(closing);
    const othersOnRoot = sessions.some((s) => s.id !== id && sessionProjectKey(s) === key);
    if (!othersOnRoot) {
      invoke('sandbox_teardown', { bin: 'podman', name: null, root: closing.cwd })
        .catch(swallow('sandbox', 'teardown on session close'));
    }
  }

  dispatch({ type: 'CLOSE_SESSION', id });
}
