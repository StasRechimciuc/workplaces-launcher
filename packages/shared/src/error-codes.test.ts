import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_CODES_LIST, getErrorCode } from './error-codes';

describe('ERROR_CODES', () => {
  it('has a unique code string per catalog entry', () => {
    const codes = ERROR_CODES_LIST.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every entry a non-empty title and explanation', () => {
    for (const def of ERROR_CODES_LIST) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.explanation.length).toBeGreaterThan(0);
    }
  });

  it('matches every code string to its keyed entry (no drift between the two)', () => {
    for (const [key, def] of Object.entries(ERROR_CODES)) {
      expect(getErrorCode(def.code)).toEqual(def);
      expect(def.code.startsWith('ER-')).toBe(true);
      // key is just a human-readable handle, but should exist for every entry.
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for a code not in the catalog, without throwing', () => {
    expect(getErrorCode('ER-NONEXISTENT-99')).toBeUndefined();
  });

  it('gives every entry with a headline/fixSteps only non-empty values', () => {
    for (const def of ERROR_CODES_LIST) {
      if (def.headline !== undefined) {
        expect(def.headline.length).toBeGreaterThan(0);
      }
      if (def.fixSteps !== undefined) {
        expect(def.fixSteps.length).toBeGreaterThan(0);
        for (const step of def.fixSteps) {
          expect(step.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
