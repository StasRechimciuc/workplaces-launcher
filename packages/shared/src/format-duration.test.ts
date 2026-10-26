import { describe, expect, it } from 'vitest';
import { formatDuration, formatPreciseDuration } from './format-duration';

describe('formatDuration', () => {
  it('formats whole seconds under a minute', () => {
    expect(formatDuration(3000)).toBe('3s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats exact minutes with no leftover seconds', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(3_600_000)).toBe('60m');
  });

  it('formats minutes with leftover seconds', () => {
    expect(formatDuration(80000)).toBe('1m 20s');
  });

  it('floors any genuinely positive duration to "1s", never "0s" — even one that would otherwise round down', () => {
    expect(formatDuration(500)).toBe('1s');
    expect(formatDuration(499)).toBe('1s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(200)).toBe('1s');
  });

  it('returns "0s" for zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns "0s" for non-finite input instead of propagating NaN/Infinity', () => {
    expect(formatDuration(NaN)).toBe('0s');
    expect(formatDuration(Infinity)).toBe('0s');
  });

  it('treats a negative value as zero', () => {
    expect(formatDuration(-500)).toBe('0s');
  });
});

describe('formatPreciseDuration', () => {
  it('formats to one decimal place of seconds, under a minute', () => {
    expect(formatPreciseDuration(3700)).toBe('3.7s');
    expect(formatPreciseDuration(900)).toBe('0.9s');
    expect(formatPreciseDuration(400)).toBe('0.4s');
  });

  it('never floors a small-but-real value to a misleadingly rounder number', () => {
    expect(formatPreciseDuration(50)).toBe('0.1s');
  });

  it("falls back to formatDuration's whole-minutes form at and beyond 60s", () => {
    expect(formatPreciseDuration(60_000)).toBe('1m');
    expect(formatPreciseDuration(80_000)).toBe('1m 20s');
  });

  it('returns "0.0s" for zero, negative, or non-finite input', () => {
    expect(formatPreciseDuration(0)).toBe('0.0s');
    expect(formatPreciseDuration(-500)).toBe('0.0s');
    expect(formatPreciseDuration(NaN)).toBe('0.0s');
    expect(formatPreciseDuration(Infinity)).toBe('0.0s');
  });
});
