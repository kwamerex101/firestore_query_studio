import { useEffect } from 'react';

type MenuHandler = (command: string, arg?: unknown) => void;

interface FqsMenuApi {
  onCommand(cb: MenuHandler): () => void;
}

/**
 * Subscribe to native-menu commands fired by `src/main/menu.ts`. No-op on
 * the web shell (the menu bridge is only exposed when running inside
 * Electron). Pass a stable handler — re-subscribing on every render would
 * be wasteful but harmless.
 */
export function useMenuCommands(handler: MenuHandler): void {
  useEffect(() => {
    const menu = (window as unknown as { fqs?: { menu?: FqsMenuApi } }).fqs?.menu;
    if (!menu) return;
    return menu.onCommand(handler);
  }, [handler]);
}
