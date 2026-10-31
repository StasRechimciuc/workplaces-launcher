import Store from 'electron-store';
import { z } from 'zod';

/**
 * The tabs a workspace's browser window held when it was last saved —
 * what the next Restore reopens (WCs/WC__window-tracking.md, Phase 4).
 * Saved on every change while the window is open and once more just
 * before Close closes it, so closing it by hand loses nothing.
 *
 * Keyed by the window resource's identity key — the browser, profile
 * and step (browser-window-spec.ts): each step's window has its own
 * tabs; removing the step (or changing its profile) leaves its entry to
 * be pruned.
 */

const SessionSchema = z.object({
  tabs: z.array(z.object({ title: z.string(), url: z.string().min(1) })).min(1),
  /** 1-based; clamped to the tabs on use. */
  activeTabIndex: z.number().int().positive(),
  savedAt: z.number(),
});

export type BrowserSession = z.infer<typeof SessionSchema>;

export interface BrowserSessionsBackend {
  read(): unknown;
  write(sessions: Record<string, BrowserSession>): void;
}

export class BrowserSessions {
  private sessions: Record<string, BrowserSession>;

  constructor(private readonly backend: BrowserSessionsBackend) {
    this.sessions = parseSessions(backend.read());
  }

  get(identityKey: string): BrowserSession | undefined {
    return this.sessions[identityKey];
  }

  /** Writes only when something changed — saves run on every tab change. */
  save(identityKey: string, session: Omit<BrowserSession, 'savedAt'>): void {
    if (session.tabs.length === 0) return;
    const current = this.sessions[identityKey];
    if (
      current &&
      current.activeTabIndex === session.activeTabIndex &&
      sameTabs(current.tabs, session.tabs)
    ) {
      return;
    }
    this.sessions = { ...this.sessions, [identityKey]: { ...session, savedAt: Date.now() } };
    this.backend.write(this.sessions);
  }

  /** Drops sessions no workspace step can reopen any more (removed or edited steps). */
  prune(liveIdentityKeys: ReadonlySet<string>): void {
    const kept = Object.fromEntries(
      Object.entries(this.sessions).filter(([key]) => liveIdentityKeys.has(key)),
    );
    if (Object.keys(kept).length === Object.keys(this.sessions).length) return;
    this.sessions = kept;
    this.backend.write(kept);
  }
}

function sameTabs(a: BrowserSession['tabs'], b: BrowserSession['tabs']): boolean {
  return (
    a.length === b.length && a.every((tab, i) => tab.url === b[i]!.url && tab.title === b[i]!.title)
  );
}

/** One unreadable entry is dropped, never the whole file — logged, not silent. */
function parseSessions(raw: unknown): Record<string, BrowserSession> {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    console.error('Saved browser tabs are unreadable — starting without them.');
    return {};
  }
  const sessions: Record<string, BrowserSession> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = SessionSchema.safeParse(value);
    if (parsed.success) sessions[key] = parsed.data;
    else console.error(`Dropping unreadable saved browser tabs (${key.slice(0, 80)}).`);
  }
  return sessions;
}

export function createBrowserSessions(): BrowserSessions {
  const store = new Store<{ sessions?: unknown }>({ name: 'browser-sessions' });
  return new BrowserSessions({
    read: () => store.get('sessions'),
    write: (sessions) => store.set('sessions', sessions),
  });
}
