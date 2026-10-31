import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { CREATE_TOOL_PRESETS, type CreateToolPreset } from '../constants';
import { matchesCombo } from '../lib/useGlobalShortcuts';
import { SHORTCUTS, getEffectiveShortcuts, getStoredOverrides } from '../lib/shortcuts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ToolBadge } from './ToolBadge';

interface ToolPickerItemProps {
  preset: CreateToolPreset;
  onSelect: () => void;
}

/**
 * One row in the "Add tool" picker — the same icon-badge + name + hint
 * visual language as a row already added to the Tools list below (not
 * a bare text menu item), plus a "Soon" pill (Sidebar.tsx's existing
 * "Beta" pill styling) for a Tier 1 type with no ToolPlugin registered
 * yet. Never blocks selection either way — picking a "Soon" preset is
 * allowed, consistent with this app's existing honest-not-blocking
 * convention for unbuilt step types.
 */
function ToolPickerItem({ preset, onSelect }: ToolPickerItemProps): JSX.Element {
  return (
    <DropdownMenuItem className="flex-col items-start gap-0 py-2" onSelect={onSelect}>
      <div className="flex w-full items-center gap-2.5">
        {/* No params to show here — this is the picker preview, before
            any app is chosen, so the 'app' type just falls back to its
            generic icon, which is correct: showing some arbitrary
            previous/stale icon here would be misleading. */}
        <ToolBadge
          type={preset.type}
          icon={preset.icon}
          color={preset.color}
          size={13}
          chipClassName="h-6 w-6 text-[13px]"
          params={{}}
        />
        <span className="text-[12.5px] font-medium text-text">{preset.name}</span>
        {!preset.implemented && (
          <span className="ml-auto rounded-[5px] border border-border-strong px-1.25 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-text-faint uppercase">
            Soon
          </span>
        )}
      </div>
      <span className="pl-8.5 text-[11.5px] text-text-faint">{preset.config}</span>
    </DropdownMenuItem>
  );
}

interface AddToolMenuProps {
  /** The button that opens it. */
  children: ReactNode;
  onPick: (preset: CreateToolPreset) => void;
  /** Passed to the menu's own close-focus handling (see the Edit form's use). */
  onCloseAutoFocus?: (e: Event) => void;
  align?: 'start' | 'center' | 'end';
}

/**
 * The searchable "Add tool" picker — shared by the Edit form's Add tool
 * row and the workspace view's "+ Add step" (Detail.tsx), so both pick
 * from the same list the same way.
 */
export function AddToolMenu({
  children,
  onPick,
  onCloseAutoFocus,
  align = 'start',
}: AddToolMenuProps): JSX.Element {
  // The Add-tool picker's own open state (controlled, not left to
  // Radix's default uncontrolled mode) purely so its search query can
  // be reset to '' on close — nothing else here depends on reading it.
  const [isAddToolOpen, setIsAddToolOpen] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState('');
  const toolSearchInputRef = useRef<HTMLInputElement>(null);
  const isMac = window.api.platform === 'darwin';
  const filteredToolPresets = useMemo(() => {
    const q = toolSearchQuery.toLowerCase();
    return q
      ? CREATE_TOOL_PRESETS.filter((p) => p.name.toLowerCase().includes(q))
      : CREATE_TOOL_PRESETS;
  }, [toolSearchQuery]);

  // Plain `autoFocus` loses the race against Radix's own internal
  // FocusScope, which auto-focuses the first menu item the instant the
  // content mounts (`onOpenAutoFocus` would prevent that, but it's
  // deliberately excluded from DropdownMenuContent's public prop type
  // — confirmed by reading @radix-ui/react-menu's own source, not
  // assumed). This effect runs after that child-level focus-scope
  // effect has already committed (child effects fire before parent
  // effects), so it reliably "steals" focus back to the search box one
  // tick later instead.
  useEffect(() => {
    if (isAddToolOpen) {
      const frame = requestAnimationFrame(() => {
        toolSearchInputRef.current?.focus();
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
  }, [isAddToolOpen]);

  return (
    <DropdownMenu
      open={isAddToolOpen}
      onOpenChange={(open) => {
        setIsAddToolOpen(open);
        if (!open) {
          // Fresh next time it opens — stale leftover text would
          // otherwise silently hide tools on the next open.
          setToolSearchQuery('');
        }
      }}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        className="flex max-h-72 w-72 flex-col overflow-hidden p-0"
        align={align}
        onKeyDown={(e) => {
          // While this menu is open, the app's own configured
          // "focus search" shortcut (e.g. ⌘K — whatever the user
          // has it bound to, read fresh, never hardcoded) should
          // refocus THIS search box, not bubble up to the global
          // window-level listener (lib/useGlobalShortcuts.ts)
          // and jump focus to the sidebar's workspace search
          // instead. stopPropagation() on the synthetic event
          // also stops the underlying native event, which is
          // what actually keeps it from ever reaching that
          // window listener — not a cross-component flag/ref,
          // just the DOM's own propagation model.
          const effective = getEffectiveShortcuts(SHORTCUTS, getStoredOverrides());
          const searchShortcut = effective.find((s) => s.id === 'search.focus');
          if (searchShortcut && matchesCombo(e.nativeEvent, searchShortcut.combo, isMac)) {
            e.preventDefault();
            e.stopPropagation();
            toolSearchInputRef.current?.focus();
            toolSearchInputRef.current?.select();
          }
        }}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
          <Icon name="search" size={12} className="shrink-0 text-text-faint" />
          <input
            ref={toolSearchInputRef}
            type="text"
            value={toolSearchQuery}
            onChange={(e) => {
              setToolSearchQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              // Let navigation keys bubble to Radix's own
              // roving-focus handling so ArrowDown/ArrowUp move
              // from "typing" into "picking an item" — stop
              // everything else (ordinary letters) from reaching
              // it, so typing a tool's name doesn't also trigger
              // Radix's built-in single-character typeahead jump.
              //
              // Enter is deliberately NOT let through (unlike the
              // original version of this list): confirmed by
              // reading Radix's own Menu source that it only ever
              // preventDefaults Enter once an actual MenuItem has
              // focus, never while this plain search input does —
              // so letting it bubble here did nothing useful for
              // Radix, while it DOES reach Dialog.tsx's new
              // Enter-to-confirm handling and prematurely saves
              // the whole workspace form mid-search.
              if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(e.key)) {
                e.stopPropagation();
              }
            }}
            placeholder="Search tools…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text placeholder:text-text-faint focus:outline-none"
          />
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="flex-1 overflow-y-auto p-1">
          {filteredToolPresets.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-text-faint">
              No tools match &ldquo;{toolSearchQuery}&rdquo;
            </p>
          ) : (
            filteredToolPresets.map((preset) => (
              <ToolPickerItem
                key={preset.type}
                preset={preset}
                onSelect={() => {
                  onPick(preset);
                }}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
