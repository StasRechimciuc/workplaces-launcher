import type { TypeOf, ZodTypeAny } from 'zod';
import type { ValidationResult } from './types';

/**
 * The one place "parse with this tool's own schema, turn zod issues
 * into a ValidationResult" lives. Every ToolPlugin.validate() should be
 * exactly `(params) => zodValidate(XStepParamsSchema, params)` — see
 * vscode-tool.ts / chrome-tool.ts / spotify-tool.ts. Previously this
 * exact 6-line safeParse-to-ValidationResult shape was copy-pasted
 * verbatim into every tool file; a new tool type no longer needs to
 * repeat it.
 *
 * Generic over `Schema` itself (not a `ZodType<TParams>` parameter),
 * with the return type derived via zod's own `TypeOf` — a schema with
 * a `.default(...)` field has a real, and correct, mismatch between
 * its input type (the field may be absent/undefined) and its output
 * type (the field is always present after parsing); pinning the
 * parameter to `ZodType<TParams>` (which forces input === output)
 * rejects exactly that shape, which every tool's schema here uses.
 */
export function zodValidate<Schema extends ZodTypeAny>(
  schema: Schema,
  params: unknown,
): ValidationResult<TypeOf<Schema>> {
  const result = schema.safeParse(params);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => issue.message);
  // First issue per top-level field only (issue.path[0]) — a later
  // issue on the same field is still in `errors` above, just not
  // separately addressable here. An issue with no path at all (a
  // whole-object check, e.g. docker-tool.ts's superRefine without an
  // explicit `path`) can't be attributed to one field, so it's left out
  // of this map rather than attached to a wrong one.
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    if (issue.path.length === 0) continue;
    const key = String(issue.path[0]);
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return Object.keys(fieldErrors).length > 0
    ? { valid: false, errors, fieldErrors }
    : { valid: false, errors };
}
