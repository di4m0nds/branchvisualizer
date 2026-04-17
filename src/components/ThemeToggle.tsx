import { useEffect } from 'react';
import { useAppContext } from '../store/AppContext';

export default function ThemeToggle() {
  const { state, dispatch } = useAppContext();
  const isDark = state.theme === 'dark';

  // Apply data-theme to <html> whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  function toggle() {
    dispatch({ type: 'SET_THEME', theme: isDark ? 'light' : 'dark' });
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className={`theme-toggle-knob${isDark ? '' : ' theme-toggle-knob--light'}`}>
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
