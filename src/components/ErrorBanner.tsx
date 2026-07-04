import { useAppDispatch, useAppSelector } from '../store/store';

export default function ErrorBanner() {
  const dispatch = useAppDispatch();
  const loadState = useAppSelector((s) => s.loadState);

  if (loadState.phase !== 'error') return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 px-4 py-3 border-b border-destructive/30
                 bg-destructive/10 text-sm flex-shrink-0"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
           className="flex-shrink-0 mt-0.5 text-destructive">
        <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm7.25-3.25a.75.75 0 011.5 0V9a.75.75 0 01-1.5 0V4.75zm.75 7.5A.75.75 0 118 11a.75.75 0 010 1.5z"/>
      </svg>
      <p className="flex-1 text-destructive leading-snug">
        {loadState.error || 'An unknown error occurred.'}
      </p>
      <button
        className="flex-shrink-0 text-xs text-destructive/70 hover:text-destructive transition-colors
                   underline underline-offset-2"
        onClick={() => dispatch({ type: 'RESET' })}
      >
        Dismiss
      </button>
    </div>
  );
}
