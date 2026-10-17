import { useEffect, useState } from 'react';

export type PlayerTheme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'atlas-player-theme';

function savedTheme(): PlayerTheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function usePlayerTheme(): readonly [PlayerTheme, (theme: PlayerTheme) => void] {
  const [theme, setTheme] = useState<PlayerTheme>(savedTheme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      for (const element of [document.documentElement, document.body]) {
        element.classList.toggle('theme-dark', dark);
        element.classList.toggle('theme-light', !dark);
      }
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  const choose = (value: PlayerTheme): void => {
    setTheme(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { return; }
  };
  return [theme, choose];
}
