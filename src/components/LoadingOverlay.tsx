import { useAppContext } from '../store/AppContext';

export default function LoadingOverlay() {
  const { state } = useAppContext();
  const { loadState } = state;

  if (loadState.phase === 'idle' || loadState.phase === 'done') return null;
  if (loadState.phase === 'error') return null;

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-spinner" />
        <p className="loading-message">{loadState.message || 'Loading…'}</p>
        <div className="loading-progress-track">
          <div
            className="loading-progress-bar"
            style={{ width: `${loadState.progress}%` }}
          />
        </div>
        <p className="loading-progress-label">{loadState.progress}%</p>
      </div>
    </div>
  );
}
