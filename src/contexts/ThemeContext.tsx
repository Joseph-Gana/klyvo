import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getOrCreateUserPreferences, upsertThemePreference } from '../services/profileService';
import { ThemeMode } from '../types';
import { useAuth } from './AuthContext';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = 'klyvo-theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Fallback to dark default
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  const activeUserIdRef = useRef<string | null>(null);
  const themeRef = useRef<ThemeMode>(theme);
  const syncRequestIdRef = useRef<number>(0);

  const userId = user?.id ?? null;
  activeUserIdRef.current = userId;
  themeRef.current = theme;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0B1020' : '#F3F4F6');
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    if (!userId) {
      syncRequestIdRef.current += 1;
      return;
    }

    let cancelled = false;
    const targetUserId = userId;
    const requestId = ++syncRequestIdRef.current;

    getOrCreateUserPreferences(targetUserId, themeRef.current)
      .then((prefs) => {
        if (
          cancelled ||
          !prefs ||
          activeUserIdRef.current !== targetUserId ||
          syncRequestIdRef.current !== requestId
        ) {
          return;
        }
        if (prefs.theme === 'dark' || prefs.theme === 'light') {
          themeRef.current = prefs.theme;
          setThemeState(prefs.theme);
        }
      })
      .catch(() => {
        // Keep localStorage theme active if remote preference sync fails
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    themeRef.current = nextTheme;
    setThemeState(nextTheme);
    const requestId = ++syncRequestIdRef.current;
    const targetUserId = activeUserIdRef.current;

    if (!targetUserId) {
      return;
    }

    upsertThemePreference(targetUserId, nextTheme).catch(() => {
      if (
        activeUserIdRef.current === targetUserId &&
        syncRequestIdRef.current === requestId
      ) {
        // Local theme remains applied; transient write failures do not break UI
      }
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = themeRef.current === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
