import Store from 'electron-store';

export interface AppSettings {
  defaultTerminalApp: string;
  launchOnLogin: boolean;
}

const defaults: AppSettings = {
  defaultTerminalApp: 'Terminal',
  launchOnLogin: false,
};

/**
 * Persisted app-level settings — distinct from workspace configs (see
 * src/main/config/loader.ts). electron-store handles the correct
 * cross-platform userData location and JSON read/write for us, so this
 * file only needs to declare the settings shape and its defaults.
 */
export const settingsStore = new Store<AppSettings>({ defaults });
