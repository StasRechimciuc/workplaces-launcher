import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodValidate } from './tool-validation';

const Schema = z.object({
  directory: z.string().min(1, 'directory must be a non-empty string'),
  engine: z.enum(['compose', 'tilt']),
});

describe('zodValidate', () => {
  it('returns valid: true with the parsed/defaulted data on success', () => {
    expect(zodValidate(Schema, { directory: '/x', engine: 'compose' })).toEqual({
      valid: true,
      data: { directory: '/x', engine: 'compose' },
    });
  });

  it('maps each failing top-level field to its first zod message in fieldErrors', () => {
    const result = zodValidate(Schema, { directory: '', engine: 'nope' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.fieldErrors).toEqual({
      directory: 'directory must be a non-empty string',
      engine: expect.any(String),
    });
    // The flat errors array still carries both messages too — nothing
    // that reads only `errors` (e.g. the save-error banner text) loses
    // information.
    expect(result.errors).toHaveLength(2);
  });

  it('keeps only the FIRST issue per field when a field has more than one', () => {
    const MultiIssue = z.object({
      value: z
        .string()
        .min(5, 'too short')
        .regex(/^[a-z]+$/, 'must be lowercase letters'),
    });
    const result = zodValidate(MultiIssue, { value: 'A' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.fieldErrors?.['value']).toBe('too short');
    expect(result.errors).toHaveLength(2); // both issues still in the flat list
  });

  it('omits fieldErrors entirely when no issue has a path (whole-object check)', () => {
    const WholeObject = z.object({ a: z.string(), b: z.string() }).refine(
      (data) => data.a !== data.b,
      { message: 'a and b must differ' }, // no `path` given
    );
    const result = zodValidate(WholeObject, { a: 'x', b: 'x' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.fieldErrors).toBeUndefined();
    expect(result.errors).toEqual(['a and b must differ']);
  });

  it('attributes a superRefine issue WITH an explicit path to that field', () => {
    const WithPath = z.object({ a: z.string(), b: z.string() }).superRefine((data, ctx) => {
      if (data.a === data.b) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['b'], message: 'must differ from a' });
      }
    });
    const result = zodValidate(WithPath, { a: 'x', b: 'x' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.fieldErrors).toEqual({ b: 'must differ from a' });
  });

  it('collapses a nested array-item path to its top-level field name', () => {
    const Nested = z.object({
      terminals: z.array(z.object({ cwd: z.string().min(1, 'cwd required') })),
    });
    const result = zodValidate(Nested, { terminals: [{ cwd: 'ok' }, { cwd: '' }] });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    // Real path is ['terminals', 1, 'cwd'] — only the top-level key
    // survives, by design (see ValidationResult's own doc comment).
    expect(result.fieldErrors).toEqual({ terminals: 'cwd required' });
  });
});
