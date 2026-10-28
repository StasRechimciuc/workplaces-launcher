import { describe, expect, it, vi } from 'vitest';
import { readBundleId } from './bundle-id';

describe.runIf(process.platform === 'darwin')('readBundleId (real plutil)', () => {
  it('reads a real app’s bundle id', async () => {
    await expect(readBundleId('/System/Applications/Calculator.app')).resolves.toBe(
      'com.apple.calculator',
    );
  });

  it('returns null, loudly, for something that isn’t an app bundle', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(readBundleId('/nonexistent/Nope.app')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
