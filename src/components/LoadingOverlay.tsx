import { useAppContext } from '../store/AppContext';

export default function LoadingOverlay() {
  const { state } = useAppContext();
  const { loadState } = state;

  if (loadState.phase === 'idle' || loadState.phase === 'done' || loadState.phase === 'error') {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center
                    bg-background/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 w-64
                      bg-card border border-border rounded-2xl shadow-xl p-6">
        {/* Spinner */}
        <div className="relative w-10 h-10">
          <svg className="animate-spin w-full h-full" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5"
                    className="text-border" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" className="text-primary"/>
          </svg>
        </div>

        {/* Message */}
        <p className="text-sm font-medium text-foreground text-center leading-snug">
          {loadState.message || 'Loading…'}
        </p>

        {/* Progress bar */}
        {loadState.progress > 0 && (
          <div className="w-full flex flex-col gap-1">
            <div className="h-1 bg-muted rounded-full overflow-hidden w-full">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${loadState.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground text-right tabular-nums">
              {loadState.progress}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
