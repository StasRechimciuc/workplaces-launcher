import type { BrowserWindow } from 'electron';
import type { RestoreProgressEvent } from '@workspace-launcher/shared';

// Hard cap: never pin the window longer than this even if a step hangs
// near its multi-hour adaptive timeout (step-timing-history.ts's 2h
// default for a tool's first-ever run, before MIN_SAMPLES_FOR_ADAPTIVE_
// TIMEOUT successful runs exist) — an unbounded pin with no cancel
// affordance would trap the user for the entire hang.
const MAX_ALWAYS_ON_TOP_MS = 60_000;

// Overlapping restores are possible (the user can switch to a different
// workspace and restore it while a prior restore is still running in
// the background — Detail.tsx's isRestoring guard is per-component-
// instance and resets on remount). This counter makes always-on-top a
// shared resource: it's only cleared once every concurrent session has
// ended, so one restore finishing early can't yank focus-pinning out
// from under another still in progress.
let activeSessions = 0;

export interface RestoreFocusSession {
  /** Re-assert the window above whatever app the step that's *about to
   * run* will launch. Only acts on a 'running' event — there's nothing
   * to re-assert on a 'success'/'failure' event, that's just the
   * previous step's outcome. */
  reassert(event: RestoreProgressEvent): void;
  /** Ends this session. Idempotent — safe to call more than once (e.g.
   * once naturally when the restore finishes, once if the hard cap
   * already fired). */
  end(): void;
}

/**
 * Keeps the launcher window visible above whatever app each step just
 * launched, so the user can watch restore progress instead of it being
 * covered — without permanently pinning the window if a step hangs, and
 * without fighting the user if they've deliberately minimized it.
 *
 * UNVERIFIED on Windows/Linux (no VM access yet — see claude.md's
 * 2026-09-17 note). Electron's own docs describe the 'floating' level
 * working on both macOS and Windows (Linux support is inconsistent,
 * but Linux isn't in scope until Phase 2) — logically sound and
 * unit-tested at the call-site level here, not yet manually confirmed
 * cross-platform, same caveat as the Windows launcher's CVE-2024-27980
 * avoidance and the macOS `open -n` Chrome fix.
 */
export function startRestoreFocusSession(win: BrowserWindow | null): RestoreFocusSession {
  const liveWin = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);

  const initial = liveWin();
  const engaged = Boolean(initial && !initial.isMinimized());
  if (engaged) {
    activeSessions += 1;
    initial!.setAlwaysOnTop(true, 'floating');
    initial!.moveTop();
  }

  let ended = false;
  const cap = setTimeout(() => end(), MAX_ALWAYS_ON_TOP_MS);

  function end(): void {
    if (ended) return;
    ended = true;
    clearTimeout(cap);
    if (!engaged) return;
    activeSessions = Math.max(0, activeSessions - 1);
    if (activeSessions === 0) {
      liveWin()?.setAlwaysOnTop(false);
    }
  }

  return {
    reassert(event) {
      if (ended || event.status !== 'running') return;
      const w = liveWin();
      if (!w || w.isMinimized()) return;
      w.moveTop();
      w.focus();
    },
    end,
  };
}
