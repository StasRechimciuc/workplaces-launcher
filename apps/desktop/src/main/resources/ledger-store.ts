// electron-store is pinned to ^8.x deliberately — see
// orchestrator/step-timing-history.ts's identical doc comment (v9+ is
// pure ESM, incompatible with this main process's CommonJS build).
import Store from 'electron-store';
import { applyBootSession, emptyLedger, migrateLedger, type Ledger } from './ledger';

/** Where the ledger is read from and written to — electron-store in the app, a fake in tests. */
export interface LedgerBackend {
  read(): unknown;
  write(ledger: Ledger): void;
}

/**
 * The persisted resource ledger (see ledger.ts). Every change is
 * written through immediately — the main process is single-threaded
 * and electron-store writes synchronously and atomically, so the file
 * never lags behind what the operations acted on.
 *
 * Fails closed: if the stored ledger is newer or unreadable, the store
 * refuses every read and write with that error instead of replacing
 * it, because starting over would orphan every window this app opened.
 */
export class ResourceLedgerStore {
  private ledger: Ledger | null = null;
  private loadError: string | null = 'The resource ledger has not been loaded yet.';

  constructor(private readonly backend: LedgerBackend) {}

  /** Loads (or creates) the ledger and applies the boot-session guard. */
  load(bootSessionUuid: string | null): { ok: true } | { ok: false; error: string } {
    const raw = this.backend.read();
    const loaded =
      raw === undefined ? { ok: true as const, ledger: emptyLedger(null) } : migrateLedger(raw);
    if (!loaded.ok) {
      this.ledger = null;
      this.loadError = loaded.error;
      console.error(loaded.error);
      return loaded;
    }
    const guarded = applyBootSession(loaded.ledger, bootSessionUuid);
    this.ledger = guarded;
    this.loadError = null;
    if (guarded !== loaded.ledger || raw === undefined) {
      this.backend.write(guarded);
    }
    return { ok: true };
  }

  get(): Ledger {
    if (!this.ledger) throw new Error(this.loadError ?? 'The resource ledger is unavailable.');
    return this.ledger;
  }

  /** Applies a change and persists it; returns the new ledger. */
  update(change: (ledger: Ledger) => Ledger): Ledger {
    const next = change(this.get());
    this.backend.write(next);
    this.ledger = next;
    return next;
  }
}

/** The app's ledger, persisted as `resource-ledger.json` in userData. */
export function createResourceLedgerStore(): ResourceLedgerStore {
  const store = new Store<{ ledger?: unknown }>({ name: 'resource-ledger' });
  return new ResourceLedgerStore({
    read: () => store.get('ledger'),
    write: (ledger) => store.set('ledger', ledger),
  });
}
