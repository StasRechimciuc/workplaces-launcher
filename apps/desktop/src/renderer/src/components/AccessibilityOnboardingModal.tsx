import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useIsMounted } from '../lib/useIsMounted';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

// The privacy policy page doesn't exist yet — writing it is a separate
// task, tracked in WCs/WC__window-tracking.md ("Permissions" →
// Onboarding). The link is rendered only once this is set, never as a
// dead or placeholder link.
const PRIVACY_POLICY_URL: string | null = null;

const POLL_INTERVAL_MS = 1000;

interface AccessibilityOnboardingModalProps {
  open: boolean;
  /** Called on every way out — Done after a grant, "Continue without",
   * or a plain dismiss. App.tsx re-reads the status afterwards. */
  onClose: () => void;
}

/**
 * The Accessibility onboarding (WCs/WC__window-tracking.md,
 * "Permissions"): opens automatically on first launch, and again from
 * the reduced-mode banner or Settings row. Built on the same
 * parent-owned `open` prop pattern as DeleteWorkspaceConfirm.tsx.
 *
 * Polls the real status once a second while open — the grant happens
 * in System Settings, outside this app, with no event to listen for —
 * and switches to a confirmation the moment it lands. Each poll spawns
 * a fresh `wl-helper trust` in the main process, so a slow one is
 * never overlapped by the next tick.
 *
 * "Continue without" marks onboarding completed so this never opens
 * by itself again; a plain dismiss (Escape, overlay, X) does not —
 * only an explicit choice counts. Either way the app runs in reduced
 * mode until access is granted.
 */
export function AccessibilityOnboardingModal({
  open,
  onClose,
}: AccessibilityOnboardingModalProps): JSX.Element {
  const [isGranted, setIsGranted] = useState(false);
  const [openSettingsError, setOpenSettingsError] = useState<string | null>(null);
  const isMountedRef = useIsMounted();
  const pollInFlightRef = useRef(false);

  // Fresh state every time it opens — a previous session's
  // confirmation or error must not carry over.
  useEffect(() => {
    if (!open) return;
    setIsGranted(false);
    setOpenSettingsError(null);
  }, [open]);

  useEffect(() => {
    if (!open || isGranted) return;
    let cancelled = false;

    async function poll(): Promise<void> {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const status = await window.api.getAccessibilityStatus();
        if (!cancelled && status.state === 'granted') {
          setIsGranted(true);
        }
      } catch (err) {
        console.error(
          `Accessibility status poll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        pollInFlightRef.current = false;
      }
    }

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open, isGranted]);

  async function handleOpenSettings(): Promise<void> {
    setOpenSettingsError(null);
    try {
      const result = await window.api.openAccessibilitySettings();
      if (isMountedRef.current && !result.success) {
        setOpenSettingsError(result.error);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setOpenSettingsError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function handleContinueWithout(): Promise<void> {
    try {
      await window.api.completeAccessibilityOnboarding();
    } catch (err) {
      // Not worth blocking the user over: the worst case is this modal
      // opening once more on the next launch.
      console.error(
        `Failed to record Accessibility onboarding: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-120"
        // Enter does what the primary button does: open the settings,
        // or — once access is on — Done.
        onEnterKey={() => {
          if (isGranted) onClose();
          else void handleOpenSettings();
        }}
      >
        <DialogHeader>
          <DialogTitle>{isGranted ? 'Access granted' : 'Allow Accessibility access'}</DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        {isGranted ? (
          <div className="flex items-start gap-2.5 p-5">
            <Icon name="check" size={16} className="mt-px shrink-0 text-success" />
            <DialogDescription className="text-[12.5px] leading-relaxed">
              Workspace Launcher can now find, focus and close exactly the windows each workspace
              opens.
            </DialogDescription>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 p-5 text-[12.5px] leading-relaxed text-text-muted">
            <DialogDescription className="text-[12.5px] leading-relaxed">
              Workspace Launcher uses macOS Accessibility to find, focus and close exactly the
              windows each workspace opened — and leave everything else alone.
            </DialogDescription>
            <p>
              It's one switch that covers every app. You won't get a separate permission prompt for
              each app.
            </p>
            <p>
              Without it, restoring still works, but Close and Switch act on whole apps instead of
              individual windows.
            </p>

            <div className="rounded-sm border border-border bg-bg-elevated px-3 py-2.5">
              <button
                type="button"
                className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover"
                onClick={() => {
                  void handleOpenSettings();
                }}
              >
                Open Accessibility settings
              </button>
              <p className="mt-2 text-[11.5px] text-text-faint">
                Workspace Launcher is usually already in the list, switched off — just turn it on.
                If it's missing, add it with the + button. This window updates by itself once access
                is on.
              </p>
              {openSettingsError && (
                <div className="mt-2 flex items-center gap-2 text-[12px] text-text-muted">
                  <Icon name="x" size={13} className="shrink-0 text-danger" />
                  <span>{openSettingsError}</span>
                </div>
              )}
            </div>

            {PRIVACY_POLICY_URL !== null && (
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-0.5 text-[11.5px] text-text-faint underline-offset-2 hover:text-text-muted hover:underline"
              >
                How Workspace Launcher uses this permission
                <Icon name="externalLink" size={10} />
              </a>
            )}
          </div>
        )}

        <DialogFooter>
          {isGranted ? (
            <DialogClose className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover">
              Done
            </DialogClose>
          ) : (
            <button
              type="button"
              className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text"
              onClick={() => {
                void handleContinueWithout();
              }}
            >
              Continue without
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
