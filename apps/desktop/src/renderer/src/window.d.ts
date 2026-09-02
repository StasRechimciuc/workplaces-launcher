import type { WorkspaceLauncherApi } from '../../preload';

declare global {
  interface Window {
    api: WorkspaceLauncherApi;
  }
}

export {};
