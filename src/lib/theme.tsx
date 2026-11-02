"use client";

/**
 * Appearance. One design, in light or dark. The choice lives in localStorage
 * ("sa-theme") and is mirrored to <html data-theme="…">; a tiny inline script in
 * the root layout applies it before first paint so there is no flash.
 * Older saved values ("classic", "modern", "modern-dark") still resolve.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type ThemeId = "light" | "dark";

export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: "light", label: "בהיר" },
  { id: "dark", label: "כהה" },
] as const;

export const THEME_STORAGE_KEY = "sa-theme";
export const DEFAULT_THEME: ThemeId = "light";

function resolve(v: string | null): ThemeId {
  return v === "dark" || v === "modern-dark" ? "dark" : "light";
}

/** Runs before hydration; keep it tiny and self-contained (no imports). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.setAttribute("data-theme",t==="dark"||t==="modern-dark"?"dark":"light");}catch(e){}})();`;

/* ── A tiny external store over localStorage ─────────────────────────────── */
const listeners = new Set<() => void>();

function readStored(): ThemeId {
  try {
    return resolve(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

function writeStored(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* private mode: the choice lives for this page only */
  }
  listeners.forEach((l) => l());
}

/* ── Context ─────────────────────────────────────────────────────────────── */
interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  // Keep <html data-theme> in step with the store (the boot script did the first paint).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    document.documentElement.setAttribute("data-theme", id);
    writeStored(id);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
