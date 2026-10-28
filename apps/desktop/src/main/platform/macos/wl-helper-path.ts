import { join } from 'node:path';
import { app } from 'electron';

/**
 * Where the native wl-helper binary lives (see native/wl-helper/ and
 * WCs/WC__window-tracking.md, "Native helper"). A packaged build ships
 * it in `Contents/Helpers/` — the layout the spike verified inherits
 * the app's Accessibility grant (finding C) — via electron-builder.yml's
 * `extraFiles`; `process.resourcesPath` is `Contents/Resources`, its
 * sibling. Unpackaged, it's straight from `npm run build:helper`'s
 * output, relative to this app's own package root.
 */
export function getWlHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, '..', 'Helpers', 'wl-helper')
    : join(app.getAppPath(), 'native', 'build', 'wl-helper');
}
