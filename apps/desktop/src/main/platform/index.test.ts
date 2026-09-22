import { afterEach, describe, expect, it } from 'vitest';

const originalPlatform = process.platform;

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('getPlatformLauncher', () => {
  it('returns windowsLauncher on win32', async () => {
    stubPlatform('win32');

    const { getPlatformLauncher } = await import('./index');
    const { windowsLauncher } = await import('./windows/launcher');

    expect(getPlatformLauncher()).toBe(windowsLauncher);
  });

  it('returns macosLauncher on darwin', async () => {
    stubPlatform('darwin');

    const { getPlatformLauncher } = await import('./index');
    const { macosLauncher } = await import('./macos/launcher');

    expect(getPlatformLauncher()).toBe(macosLauncher);
  });

  it('throws a clear, non-silent error on an unsupported platform', async () => {
    stubPlatform('linux');

    const { getPlatformLauncher } = await import('./index');

    expect(() => getPlatformLauncher()).toThrow(/Unsupported platform: "linux"/);
    expect(() => getPlatformLauncher()).toThrow(/Linux support is next/);
  });
});
