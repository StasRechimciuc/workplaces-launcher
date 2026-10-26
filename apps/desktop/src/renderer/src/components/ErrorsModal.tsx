import { useEffect, useMemo, useRef, useState } from 'react';
import { ERROR_CODES_LIST } from '@workspace-launcher/shared';
import { Icon } from '../icons';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface ErrorsModalProps {
  /** null closes the modal. Always opened via a specific code — this
   * modal has no entry point of its own (not Settings, not the
   * Sidebar), only the "Learn more about this error" link. */
  code: string | null;
  onClose: () => void;
}

const SEARCH_RESULT_LIMIT = 50;

/** The code's category prefix (`ER-CHROME-01` → `ER-CHROME`) — codes
 * sharing it are "related" for the default, no-search view below. */
function categoryOf(code: string): string {
  return code.split('-').slice(0, -1).join('-');
}

/**
 * A static, searchable catalog of every known error code — not a log
 * of past occurrences (see error-codes.ts's own doc comment). With a
 * growing catalog, dumping every code on open doesn't scale: the
 * default (no search typed yet) view shows only the triggering code
 * plus others in its same category, not the whole list. Typing a
 * search searches the full catalog, capped to SEARCH_RESULT_LIMIT
 * results so a broad query can't render hundreds of rows at once.
 */
export function ErrorsModal({ code, onClose }: ErrorsModalProps): JSX.Element {
  const [query, setQuery] = useState('');
  const highlightedRowRef = useRef<HTMLDivElement | null>(null);

  // A different triggering code (or reopening on the same one) must not
  // carry over a stale search from a previous visit.
  useEffect(() => {
    setQuery('');
  }, [code]);

  useEffect(() => {
    if (code !== null) {
      highlightedRowRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [code]);

  const isSearching = query.trim().length > 0;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return ERROR_CODES_LIST.filter(
      (def) =>
        def.code.toLowerCase().includes(q) ||
        def.title.toLowerCase().includes(q) ||
        def.explanation.toLowerCase().includes(q),
    );
  }, [query]);

  const related = useMemo(() => {
    if (code === null) return [];
    const cat = categoryOf(code);
    return ERROR_CODES_LIST.filter((def) => def.code === code || categoryOf(def.code) === cat).sort(
      (a, b) => (a.code === code ? -1 : b.code === code ? 1 : 0),
    );
  }, [code]);

  const filtered = isSearching ? matches.slice(0, SEARCH_RESULT_LIMIT) : related;
  const hiddenMatchCount = isSearching ? Math.max(0, matches.length - SEARCH_RESULT_LIMIT) : 0;

  return (
    <Dialog
      open={code !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="w-130">
        <DialogHeader>
          <DialogTitle>Errors</DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto p-5">
          <div className="relative">
            <Icon
              name="search"
              size={13}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint"
            />
            <input
              className="h-8 w-full rounded-sm border border-border-strong bg-bg pl-8 pr-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
              type="text"
              placeholder="Search error codes…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>

          {!isSearching && (
            <p className="text-[11px] text-text-faint">
              Showing errors related to this one — search above to look up any other code.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {filtered.map((def) => {
              const isHighlighted = def.code === code;
              return (
                <div
                  key={def.code}
                  ref={isHighlighted ? highlightedRowRef : undefined}
                  className={
                    isHighlighted
                      ? 'rounded-sm border border-accent-border bg-bg-hover px-3 py-2.5'
                      : 'rounded-sm border border-border px-3 py-2.5'
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm border border-danger px-1 font-mono text-[10.5px] text-danger">
                      {def.code}
                    </span>
                    <span className="text-[12.5px] font-medium text-text">{def.title}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-text-muted">{def.explanation}</p>
                  {def.fixSteps && def.fixSteps.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-4 text-[12px] text-text-muted">
                      {def.fixSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-4 text-center text-[12px] text-text-faint">No matching errors.</p>
            )}
            {hiddenMatchCount > 0 && (
              <p className="py-1.5 text-center text-[11px] text-text-faint">
                Showing the first {SEARCH_RESULT_LIMIT} of {matches.length} matches — refine your
                search to narrow it down.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
