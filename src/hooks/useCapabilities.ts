import { useCallback } from 'react';
import { useAppContext } from '@/store/AppContext';
import type { Capability } from '@/types';

export function useCapabilities(): { hasCapability: (cap: Capability) => boolean } {
  const { state } = useAppContext();
  const token = state.token;

  const hasCapability = useCallback(
    (_cap: Capability): boolean => {
      return !!token;
    },
    [token],
  );

  return { hasCapability };
}
