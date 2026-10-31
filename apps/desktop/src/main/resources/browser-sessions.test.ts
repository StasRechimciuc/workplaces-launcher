import { describe, expect, it, vi } from 'vitest';
import { BrowserSessions, type BrowserSession } from './browser-sessions';

vi.mock('electron-store', () => ({ default: class {} }));

function memory(initial?: unknown): {
  sessions: BrowserSessions;
  writes: Record<string, BrowserSession>[];
} {
  const writes: Record<string, BrowserSession>[] = [];
  const sessions = new BrowserSessions({ read: () => initial, write: (s) => writes.push(s) });
  return { sessions, writes };
}

const tabs = [
  { title: 'A', url: 'https://a.com' },
  { title: 'B', url: 'https://b.com' },
];

describe('saved browser tabs', () => {
  it('remembers the tabs and the one the user was on', () => {
    const { sessions } = memory();
    sessions.save('k', { tabs, activeTabIndex: 2 });
    expect(sessions.get('k')).toMatchObject({ tabs, activeTabIndex: 2 });
  });

  it('writes only when something changed — saves run on every tab change', () => {
    const { sessions, writes } = memory();
    sessions.save('k', { tabs, activeTabIndex: 1 });
    sessions.save('k', { tabs: [...tabs], activeTabIndex: 1 });
    expect(writes).toHaveLength(1);
    sessions.save('k', { tabs, activeTabIndex: 2 });
    expect(writes).toHaveLength(2);
  });

  it('never saves an empty window over real tabs', () => {
    const { sessions } = memory();
    sessions.save('k', { tabs, activeTabIndex: 1 });
    sessions.save('k', { tabs: [], activeTabIndex: 1 });
    expect(sessions.get('k')?.tabs).toEqual(tabs);
  });

  it('forgets sessions no step can reopen any more', () => {
    const { sessions } = memory();
    sessions.save('kept', { tabs, activeTabIndex: 1 });
    sessions.save('edited-away', { tabs, activeTabIndex: 1 });
    sessions.prune(new Set(['kept']));
    expect(sessions.get('kept')).toBeDefined();
    expect(sessions.get('edited-away')).toBeUndefined();
  });

  it('drops one unreadable entry, never the whole file', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sessions } = memory({
      good: { tabs, activeTabIndex: 1, savedAt: 1 },
      bad: { tabs: 'nope' },
    });
    expect(sessions.get('good')).toBeDefined();
    expect(sessions.get('bad')).toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
