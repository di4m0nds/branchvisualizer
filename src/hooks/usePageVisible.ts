import { useEffect, useState } from 'react';

/**
 * Tracks `document.visibilityState` so polling loops (docker ps, stats
 * streams) can pause while the window is hidden/minimized and resume — with an
 * immediate refresh — when it becomes visible again.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
