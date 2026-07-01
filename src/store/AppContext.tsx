import { createContext, useContext, useEffect, useReducer, type ReactNode, type Dispatch } from 'react';
import type { AppAction, AppState } from '../types';
import { initialState, persistState, reducer } from './reducer';

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Persist model choice + pinned rules on any change (cheap; localStorage only).
  useEffect(() => {
    persistState(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentModel, state.pinnedRules]);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
