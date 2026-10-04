import { createContext, useContext, type ReactNode } from 'react';

/**
 * What the app shell hands to screens that render their own frame (season-ui's
 * ScreenHeader / SeasonShell read it with useAppShell()):
 *   menuButton    the left ☰ that opens the experience drawer
 *   headerActions extra header icons (League: the Notifications bell)
 *   bottomNav     the experience's bottom tabs (replaces a screen's own)
 * Outside the app (plain component stories) the context is null and screens render as before.
 */
export interface AppShellValue {
  menuButton: ReactNode;
  headerActions: ReactNode;
  bottomNav: ReactNode;
}

export const AppShellContext = createContext<AppShellValue | null>(null);

export function useAppShell(): AppShellValue | null {
  return useContext(AppShellContext);
}

export type ShellPart = 'menu' | 'actions' | 'nav';

/** Lets the shell know a screen rendered one of its parts, so the fallback overlay hides. */
export const ShellAdoptionContext = createContext<((part: ShellPart) => () => void) | null>(null);

