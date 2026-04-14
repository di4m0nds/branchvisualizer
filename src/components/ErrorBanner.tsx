import { useAppContext } from '../store/AppContext';

export default function ErrorBanner() {
  const { state, dispatch } = useAppContext();
  const { loadState } = state;

  if (loadState.phase !== 'error') return null;

  return (
    <div className="error-banner" role="alert">
      <span className="error-icon">⚠</span>
      <p className="error-message">{loadState.error || 'An unknown error occurred.'}</p>
      <button className="error-dismiss" onClick={() => dispatch({ type: 'RESET' })}>
        Dismiss
      </button>
    </div>
  );
}
