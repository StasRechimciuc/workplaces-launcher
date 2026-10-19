import { describe, expect, it } from 'vitest';
import { getMacAppName, isExcludedFromAutoClose } from './tool-identity';

describe('getMacAppName', () => {
  it('returns the fixed app name for each built-in single-name tool type', () => {
    expect(getMacAppName('vscode', {})).toBe('Visual Studio Code');
    expect(getMacAppName('chrome', {})).toBe('Google Chrome');
    expect(getMacAppName('spotify', {})).toBe('Spotify');
    expect(getMacAppName('clockify', {})).toBe('Clockify Desktop');
  });

  it('derives the app name from path for the generic app type', () => {
    expect(getMacAppName('app', { path: '/Applications/Figma.app' })).toBe('Figma');
  });

  it('returns undefined for an app step with no path chosen yet', () => {
    expect(getMacAppName('app', {})).toBeUndefined();
    expect(getMacAppName('app', { path: '' })).toBeUndefined();
    expect(getMacAppName('app', { path: 42 })).toBeUndefined();
  });

  it('returns undefined for an unimplemented/unknown step type, without throwing', () => {
    expect(getMacAppName('docker', {})).toBeUndefined();
    expect(getMacAppName('nonexistent', {})).toBeUndefined();
  });
});

describe('isExcludedFromAutoClose', () => {
  it('excludes only chrome', () => {
    expect(isExcludedFromAutoClose('chrome')).toBe(true);
    expect(isExcludedFromAutoClose('vscode')).toBe(false);
    expect(isExcludedFromAutoClose('spotify')).toBe(false);
    expect(isExcludedFromAutoClose('clockify')).toBe(false);
    expect(isExcludedFromAutoClose('app')).toBe(false);
    expect(isExcludedFromAutoClose('nonexistent')).toBe(false);
  });
});
