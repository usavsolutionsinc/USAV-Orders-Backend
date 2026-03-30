import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Structured API error with HTTP status code.
 * Throw this in route handlers or hooks to return a typed error response.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: string) {
    return new ApiError(400, message, details);
  }

  static notFound(entity: string, id?: string | number) {
    return new ApiError(404, `${entity} not found${id != null ? `: ${id}` : ''}`);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }

  static internal(message = 'Internal server error', details?: string) {
    return new ApiError(500, message, details);
  }
}

/**
 * Converts any caught error into a standardized NextResponse.
 * - ApiError → { error, details?, statusCode }
 * - ZodError → { error: 'Validation failed', details: formatted issues, statusCode: 400 }
 * - Unknown → { error: 'Internal server error', statusCode: 500 }
 */
export function errorResponse(err: unknown, context?: string): NextResponse {
  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.details) body.details = err.details;
    return NextResponse.json(body, { status: err.statusCode });
  }

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return NextResponse.json(
      { error: 'Validation failed', details: issues },
      { status: 400 },
    );
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  if (context) console.error(`[${context}]`, message);
  return NextResponse.json(
    { error: 'Internal server error', details: message },
    { status: 500 },
  );
}
