import type { z } from 'zod';

/**
 * Parses `raw` against `schema`, coercing query-string scalars on demand.
 *
 * A query string carries only strings, but the endpoint contracts declare real
 * `z.number()` / `z.boolean()` fields — and they should, since the same schema
 * types the client call. Rather than guessing per key (`q=123` is a *string*
 * search term, not a number), this parses once and lets zod say which paths it
 * wanted as numbers or booleans, coerces exactly those, and parses again.
 */
export function parseWithCoercion<T extends z.ZodType>(
  schema: T,
  raw: unknown,
): z.ZodSafeParseResult<z.infer<T>> {
  const first = schema.safeParse(raw);
  if (first.success) return first;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return first;

  const source = raw as Record<string, unknown>;
  let patched: Record<string, unknown> | null = null;

  for (const issue of first.error.issues) {
    if (issue.code !== 'invalid_type') continue;
    const key = issue.path[0];
    if (typeof key !== 'string' || issue.path.length !== 1) continue;
    const current = source[key];
    if (typeof current !== 'string') continue;

    const expected = (issue as { expected?: string }).expected;
    const coerced = coerceScalar(current, expected);
    if (coerced === undefined) continue;

    patched ??= { ...source };
    patched[key] = coerced;
  }

  if (patched === null) return first;
  return schema.safeParse(patched);
}

function coerceScalar(value: string, expected: string | undefined): unknown {
  if (expected === 'number') {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (expected === 'boolean') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return undefined;
  }
  return undefined;
}

/** Flattens zod issues into a `details` payload the client can show per field. */
export function issueDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
