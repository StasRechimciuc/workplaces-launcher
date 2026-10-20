import { describe, expect, it } from 'vitest';
import { DetectionDeduper } from './detection-deduper';

describe('DetectionDeduper', () => {
  it('allows starting a key that has never been seen', () => {
    const deduper = new DetectionDeduper<string>();
    expect(deduper.shouldStart('vscode', false)).toBe(true);
  });

  it('refuses a second start for the same key while the first is still in flight — the core dedupe guarantee', () => {
    const deduper = new DetectionDeduper<string>();
    expect(deduper.shouldStart('vscode', false)).toBe(true);
    // Simulates a second row of the same tool type mounting before the
    // first row's real detection call has resolved.
    expect(deduper.shouldStart('vscode', false)).toBe(false);
  });

  it('allows starting again once finish() is called', () => {
    const deduper = new DetectionDeduper<string>();
    deduper.shouldStart('vscode', false);
    deduper.finish('vscode');
    expect(deduper.shouldStart('vscode', false)).toBe(true);
  });

  it('refuses to start when alreadyDone is true, even with no in-flight entry', () => {
    const deduper = new DetectionDeduper<string>();
    expect(deduper.shouldStart('vscode', true)).toBe(false);
  });

  it('tracks each key independently — starting one never blocks another', () => {
    const deduper = new DetectionDeduper<string>();
    expect(deduper.shouldStart('vscode', false)).toBe(true);
    expect(deduper.shouldStart('chrome', false)).toBe(true);
  });

  it('reset() clears every in-flight key', () => {
    const deduper = new DetectionDeduper<string>();
    deduper.shouldStart('vscode', false);
    deduper.shouldStart('chrome', false);
    deduper.reset();
    expect(deduper.shouldStart('vscode', false)).toBe(true);
    expect(deduper.shouldStart('chrome', false)).toBe(true);
  });
});
