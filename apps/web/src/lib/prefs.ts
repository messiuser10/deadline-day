/**
 * Per-device preferences: colour theme (dark by default), sound effects (off by default) and whether the
 * first-visit walkthrough has been seen. Kept in localStorage; every access is guarded because storage can
 * be blocked (private windows, strict privacy settings), in which case the defaults simply apply.
 */
import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface Prefs {
  theme: Theme;
  sound: boolean;
  walkthroughSeen: boolean;
}

const KEY = 'dd-prefs';
const DEFAULTS: Prefs = { theme: 'dark', sound: false, walkthroughSeen: false };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: v.theme === 'light' ? 'light' : 'dark',
      sound: v.sound === true,
      walkthroughSeen: v.walkthroughSeen === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function write(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the choice lasts until the tab closes.
  }
}

const THEME_COLOR: Record<Theme, string> = { dark: '#0a0f1e', light: '#f3f5f9' };

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export const usePrefs = create<Prefs>(() => read());

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>);
  write(usePrefs.getState());
  if (key === 'theme') applyTheme(value as Theme);
}
