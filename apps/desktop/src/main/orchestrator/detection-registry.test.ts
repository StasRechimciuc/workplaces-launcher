import { describe, expect, it } from 'vitest';
import { findTypeForBundlePath, getDetectionSpec } from './detection-registry';

describe('getDetectionSpec', () => {
  it.each(['vscode', 'chrome', 'spotify', 'clockify'])('has an entry for %s', (type) => {
    expect(getDetectionSpec(type)).toBeDefined();
  });

  it.each(['terminal', 'app', 'link', 'docker', 'unknown-type'])(
    'has no entry for %s (handled separately, or has no fixed product name)',
    (type) => {
      expect(getDetectionSpec(type)).toBeUndefined();
    },
  );
});

describe('findTypeForBundlePath', () => {
  it('matches VS Code by its real bundle path, not its internal process name', () => {
    // lsappinfo reports VS Code's running process as "Code" — matching
    // must go through the bundle path's display name ("Visual Studio
    // Code"), never the raw process name, or this would never match.
    expect(findTypeForBundlePath('/Applications/Visual Studio Code.app')).toBe('vscode');
  });

  it('matches Chrome', () => {
    expect(findTypeForBundlePath('/Applications/Google Chrome.app')).toBe('chrome');
  });

  it('matches Spotify', () => {
    expect(findTypeForBundlePath('/Applications/Spotify.app')).toBe('spotify');
  });

  it('matches Clockify regardless of install location', () => {
    expect(findTypeForBundlePath('/Users/stas/Downloads/Clockify Desktop.app')).toBe('clockify');
  });

  it('is case-insensitive', () => {
    expect(findTypeForBundlePath('/Applications/GOOGLE CHROME.app')).toBe('chrome');
  });

  it('returns undefined for an app with no matching step type', () => {
    expect(findTypeForBundlePath('/Applications/Slack.app')).toBeUndefined();
  });

  it('returns undefined for Terminal/iTerm2 — handled separately, not through this registry', () => {
    expect(findTypeForBundlePath('/System/Applications/Utilities/Terminal.app')).toBeUndefined();
    expect(findTypeForBundlePath('/Applications/iTerm.app')).toBeUndefined();
  });
});
