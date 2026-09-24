import { describe, expect, it } from 'vitest';
import { stepRowSummary } from './step-row-summary';

describe('stepRowSummary', () => {
  describe('vscode', () => {
    it('reports no path set when empty', () => {
      expect(stepRowSummary('vscode', {})).toBe('No path set');
      expect(stepRowSummary('vscode', { path: '   ' })).toBe('No path set');
    });

    it('shows just the path with no commands', () => {
      expect(stepRowSummary('vscode', { path: '~/projects/x' })).toBe('~/projects/x');
    });

    it('appends a singular/plural command count', () => {
      const oneCommand = { path: '~/x', terminals: [{ commands: ['npm run dev'] }] };
      expect(stepRowSummary('vscode', oneCommand)).toBe('~/x, 1 command');

      const twoCommands = { path: '~/x', terminals: [{ commands: ['npm i', 'npm run dev'] }] };
      expect(stepRowSummary('vscode', twoCommands)).toBe('~/x, 2 commands');
    });
  });

  describe('chrome', () => {
    it('reports no profile set when empty', () => {
      expect(stepRowSummary('chrome', {})).toBe('No profile set');
    });

    it('shows just the profile with no tabs', () => {
      expect(stepRowSummary('chrome', { profile: 'Default' })).toBe('Default');
    });

    it('appends a singular/plural tab count', () => {
      expect(stepRowSummary('chrome', { profile: 'Default', urls: ['https://a.com'] })).toBe(
        'Default, 1 tab',
      );
      expect(
        stepRowSummary('chrome', { profile: 'Default', urls: ['https://a.com', 'https://b.com'] }),
      ).toBe('Default, 2 tabs');
    });
  });

  describe('spotify', () => {
    it('reports no playlist set when empty', () => {
      expect(stepRowSummary('spotify', {})).toBe('No playlist set');
    });

    it('reports playlist configured when set', () => {
      expect(stepRowSummary('spotify', { playlist: 'spotify:playlist:abc' })).toBe(
        'Playlist configured',
      );
    });
  });

  it('returns an empty string for a type it does not know how to summarize', () => {
    expect(stepRowSummary('clockify', {})).toBe('');
    expect(stepRowSummary('docker', {})).toBe('');
  });
});
