import { NextResponse } from 'next/server';
import type { ZodType, ZodError } from 'zod';

/**
 * Wraps `schema.safeParse(body)` and returns either the parsed payload OR a
 * standardized 400 NextResponse describing the validation failure.
 *
 * Usage:
 *   const parsed = parseBody(LocationsPatchBody, body);
 *   if (parsed instanceof NextResponse) return parsed;
 *   // ...parsed is now strongly typed
 */
export function parseBody<T>(
  schema: ZodType<T>,
  body: unknown,
): T | NextResponse {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  return NextResponse.json(
    {
      error: 'INVALID_BODY',
      issues: (result.error as ZodError).issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    },
    { status: 400 },
  );
}
