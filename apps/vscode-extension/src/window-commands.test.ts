import { describe, expect, it, vi } from 'vitest';
import { handleWindowCommand, type WindowCommandEnv } from './window-commands';

const command = {
  version: 1 as const,
  id: '00000000-0000-4000-8000-000000000001',
  sessionId: 's-1',
  action: 'close' as const,
  createdAt: new Date().toISOString(),
};

function env(overrides: Partial<WindowCommandEnv> = {}): WindowCommandEnv & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    folderCount: 1,
    hasUnsavedChanges: () => false,
    closeWindow: vi.fn(async () => {
      calls.push('close');
    }),
    claim: vi.fn(async () => {
      calls.push('claim');
      return true;
    }),
    answer: vi.fn(async (_id, status, reason) => {
      calls.push(`answer:${status}${reason ? `:${reason}` : ''}`);
    }),
    ...overrides,
  };
}

describe('handleWindowCommand', () => {
  it('claims, answers, then closes — answering first, while it still can', async () => {
    const e = env();
    await handleWindowCommand(command, e);
    expect(e.calls).toEqual(['claim', 'answer:ok', 'close']);
  });

  it('never closes with unsaved changes', async () => {
    const e = env({ hasUnsavedChanges: () => true });
    await handleWindowCommand(command, e);
    expect(e.calls).toEqual(['claim', 'answer:refused:unsaved']);
  });

  it('never acts on a request the app already took back', async () => {
    const e = env({
      claim: vi.fn(async () => {
        e.calls.push('claim');
        return false;
      }),
    });
    await handleWindowCommand(command, e);
    expect(e.calls).toEqual(['claim']);
  });

  it('never closes a multi-root window', async () => {
    const e = env({ folderCount: 2 });
    await handleWindowCommand(command, e);
    expect(e.calls).toEqual(['claim', 'answer:refused:multi-root']);
  });
});
