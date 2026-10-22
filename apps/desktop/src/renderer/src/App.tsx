import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceConfig } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../preload';
import { Icon } from './icons';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { WorkspaceFormModal } from './components/WorkspaceFormModal';
import { SaveCurrentWorkspaceModal } from './components/SaveCurrentWorkspaceModal';
import { DeleteWorkspaceConfirm } from './components/DeleteWorkspaceConfirm';
import { SettingsModal } from './components/SettingsModal';
import { ErrorsModal } from './components/ErrorsModal';
import { resolveActiveWorkspaceId } from './lib/workspace-selection';
import { SHORTCUTS, formatCombo, getEffectiveShortcuts, getStoredOverrides } from './lib/shortcuts';
import { useGlobalShortcuts } from './lib/useGlobalShortcuts';

const DEFAULT_SEARCH_COMBO =
  SHORTCUTS.find((s) => s.id === 'search.focus')?.defaultCombo ?? 'CommandOrControl+K';

function currentSearchCombo(): string {
  const effective = getEffectiveShortcuts(SHORTCUTS, getStoredOverrides());
  return effective.find((s) => s.id === 'search.focus')?.combo ?? DEFAULT_SEARCH_COMBO;
}

// main/index.ts's windowFrameOptions puts the real OS window controls
// on different sides per platform: macOS's traffic lights top-left
// (trafficLightPosition), the Windows/Linux titleBarOverlay's
// minimize/maximize/close cluster top-right. This custom-drawn title
// bar must reserve space on whichever side is actually in play, or the
// real controls render on top of — not beside — this content.
const isDarwin = window.api.platform === 'darwin';

export function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceDisplay[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [isSaveCurrentModalOpen, setSaveCurrentModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceDisplay | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceDisplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  // Opened only via a "Learn more about this error" link (RestoreResults/
  // Detail/TimelineStep/WorkspaceFormModal) — never from Settings or the
  // Sidebar, per the founder's explicit "hidden from settings" design.
  const [errorsModalCode, setErrorsModalCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // The pill shown next to the search box — reflects the EFFECTIVE
  // combo (default or user override), not just the hardcoded default,
  // and is refreshed when Settings closes (the only place a rebind can
  // happen) rather than ever going stale after a user customizes it.
  const [searchCombo, setSearchCombo] = useState(() => currentSearchCombo());

  /**
   * Fetches the real workspace list (see src/main/ipc/handlers.ts's
   * listWorkspaces) and applies it to state. Shared by the initial
   * load, "a workspace was just created/edited," "a workspace was just
   * deleted," and the window-focus refresh below — all need the same
   * behavior, kept in one place instead of near-duplicate blocks that
   * could drift.
   *
   * When `selectId` is omitted, keeps the current selection only if it
   * still exists in the freshly loaded list, falling back to the first
   * workspace otherwise — needed because delete can make the currently
   * active id disappear; previously an omitted selectId always kept
   * `current` verbatim even if it no longer existed, leaving Detail
   * unrendered with nothing selected.
   */
  const lastRefreshAtRef = useRef(0);

  const refreshWorkspaces = useCallback((selectId?: string): Promise<void> => {
    lastRefreshAtRef.current = Date.now();
    return window.api
      .listWorkspaces()
      .then((loaded) => {
        setWorkspaces(loaded);
        setActiveId((current) => resolveActiveWorkspaceId(loaded, selectId ?? current));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load workspaces: ${message}`);
        setLoadError(message);
      });
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  // The standalone "Save current workspace" hotkey (or its tray-menu
  // companion) fired in the main process — open the review screen.
  // No payload: SaveCurrentWorkspaceModal fetches the actual detection
  // draft itself once it opens.
  useEffect(() => {
    return window.api.onSaveCurrentWorkspaceTriggered(() => {
      setSaveCurrentModalOpen(true);
    });
  }, []);

  // A workspace's `active` badge (intent + liveness, see
  // WCs/WC__workspace-activity.md) can go stale the moment the user
  // quits an app the OS's own way — Cmd+Q, the Dock, the app's own
  // menu — entirely outside this app's Restore/Switch/Close buttons,
  // which are the only other places a refresh fires. Re-checking on
  // window focus catches that the next time the user actually looks at
  // this app again, without a polling interval running the whole time
  // it's in the background.
  //
  // Debounced against any refresh in the last 2s: restore-focus.ts
  // reasserts this window's focus on every single restore step (each
  // launched app briefly steals OS focus, then this window refocuses),
  // so a multi-step restore would otherwise fire one real,
  // osascript-backed listWorkspaces() call per step — contending with
  // the restore's own shell-outs for no benefit, since nothing external
  // could have changed between steps a fraction of a second apart.
  useEffect(() => {
    const handleFocus = (): void => {
      if (Date.now() - lastRefreshAtRef.current < 2000) return;
      void refreshWorkspaces();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshWorkspaces]);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeId);

  const filteredWorkspaces = useMemo(
    () => workspaces.filter((w) => w.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [workspaces, searchQuery],
  );

  const shortcutHandlers = useMemo(
    () => ({
      'search.focus': () => {
        searchInputRef.current?.focus();
      },
      'settings.open': () => {
        setSettingsOpen(true);
      },
    }),
    [],
  );
  useGlobalShortcuts(shortcutHandlers);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-bg">
      <div
        className="flex h-13 shrink-0 items-center gap-4 border-b border-border bg-bg-elevated px-3.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Reserves the space macOS's real traffic lights render into
            — see trafficLightPosition in main/index.ts. Not needed on
            Windows/Linux, where the OS controls sit on the right
            instead (below). */}
        {isDarwin && <div className="w-13 shrink-0" />}

        <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-text-faint">
          <span>Workspace Launcher</span>
          <span className="text-[11px] text-text-faint">
            <Icon name="chevronRight" size={11} />
          </span>
          <span className="font-medium text-text-muted">{activeWorkspace?.name ?? ''}</span>
        </div>

        <div
          className="mx-auto flex h-7.5 max-w-85 flex-1 items-center gap-1.75 rounded-sm border border-border bg-bg px-2.5 text-[12.5px] text-text-faint focus-within:border-accent-border"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            className="min-w-0 flex-1 bg-transparent text-text placeholder:text-text-faint focus:outline-none"
            type="text"
            placeholder="Search workspaces"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
          />
          <span className="ml-auto shrink-0 rounded-[4px] border border-border-strong px-1.25 py-px text-[10.5px] leading-[1.4] text-text-faint">
            {formatCombo(searchCombo, isDarwin)}
          </span>
        </div>

        {/* On Windows/Linux, widened to leave room for the real
            titleBarOverlay minimize/maximize/close cluster
            (main/index.ts) so it doesn't render on top of this content
            — best-effort width, UNVERIFIED against a real Windows/
            Linux window (see WCs/WC__project-status.md). */}
        <div className={isDarwin ? 'w-19 shrink-0' : 'w-[138px] shrink-0'} />
      </div>

      {loadError && (
        <div className="m-4 flex shrink-0 items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <span>Failed to load workspaces: {loadError}</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          workspaces={filteredWorkspaces}
          activeId={activeId}
          onSelect={setActiveId}
          onNewWorkspace={() => {
            setCreateModalOpen(true);
          }}
          onSaveCurrentWorkspace={() => {
            setSaveCurrentModalOpen(true);
          }}
          onEditWorkspace={setEditingWorkspace}
          onDeleteWorkspace={setDeletingWorkspace}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
          searchQuery={searchQuery}
        />

        {activeWorkspace && (
          <Detail
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            allWorkspaces={workspaces}
            onEditWorkspace={setEditingWorkspace}
            onDeleteWorkspace={setDeletingWorkspace}
            onQuickEditSaved={(config) => {
              void refreshWorkspaces(config.id);
            }}
            onShowErrorCode={setErrorsModalCode}
            onWorkspaceActivityChanged={() => {
              void refreshWorkspaces();
            }}
          />
        )}
      </div>

      <WorkspaceFormModal
        open={isCreateModalOpen || editingWorkspace !== null}
        editingWorkspace={editingWorkspace}
        workspaces={workspaces}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingWorkspace(null);
        }}
        onSaved={(config: WorkspaceConfig) => {
          setCreateModalOpen(false);
          setEditingWorkspace(null);
          void refreshWorkspaces(config.id);
        }}
        onShowErrorCode={setErrorsModalCode}
      />

      <SaveCurrentWorkspaceModal
        open={isSaveCurrentModalOpen}
        onClose={() => {
          setSaveCurrentModalOpen(false);
        }}
        onSaved={(config: WorkspaceConfig) => {
          setSaveCurrentModalOpen(false);
          void refreshWorkspaces(config.id);
        }}
        onShowErrorCode={setErrorsModalCode}
        workspaces={workspaces}
      />

      <DeleteWorkspaceConfirm
        workspace={deletingWorkspace}
        onClose={() => {
          setDeletingWorkspace(null);
        }}
        onDeleted={(id) => {
          // Defense-in-depth on top of DeleteWorkspaceConfirm's own
          // close-blocking-while-deleting guard: only clear the dialog
          // if it's still showing the workspace that was actually
          // deleted, not whatever a later-opened dialog is showing now.
          setDeletingWorkspace((current) => (current?.id === id ? null : current));
          void refreshWorkspaces();
        }}
      />

      <SettingsModal
        open={isSettingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          // Settings is the only place a shortcut can be rebound — pick
          // up anything that changed while it was open.
          setSearchCombo(currentSearchCombo());
        }}
      />

      <ErrorsModal
        code={errorsModalCode}
        onClose={() => {
          setErrorsModalCode(null);
        }}
      />
    </div>
  );
}
