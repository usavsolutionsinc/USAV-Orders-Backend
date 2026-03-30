import type { NextRequest } from 'next/server';
import type { ZodSchema } from 'zod';

/** Parsed query params passed to every GET handler */
export interface CrudListParams {
  page: number;
  limit: number;
  offset: number;
  search: string;
  tab: string;
  sort: string;
  /** Raw search params for custom extraction */
  searchParams: URLSearchParams;
}

/** Configuration for createCrudHandler */
export interface CrudConfig<TRow = any> {
  /** Display name used in error messages and logging (e.g. "repair") */
  name: string;

  // ── Cache ──────────────────────────────────────────────────

  /** Upstash cache namespace (e.g. "api:repair-service") */
  cacheNamespace?: string;
  /** Cache TTL in seconds (default: 300) */
  cacheTTL?: number;
  /** Tags for bulk invalidation after mutations */
  cacheTags?: string[];

  // ── Validation ─────────────────────────────────────────────

  /** Zod schema for POST (create) body validation */
  createSchema?: ZodSchema;
  /** Zod schema for PATCH (update) body validation */
  updateSchema?: ZodSchema;

  // ── Query layer ────────────────────────────────────────────

  /**
   * Fetch a list of rows. Called by GET when no `id` param is present.
   * Receives parsed pagination, search, tab, and sort params.
   */
  list: (params: CrudListParams) => Promise<{ rows: TRow[]; total?: number }>;

  /**
   * Fetch a single row by ID. Called by GET when `id` param is present.
   * Return null to trigger a 404 response.
   */
  getById?: (id: number | string) => Promise<TRow | null>;

  /**
   * Search rows by free-text query. If provided, this takes priority over
   * `list` when a `q` search param is present. Falls back to `list` if not set.
   */
  search?: (query: string, params: CrudListParams) => Promise<TRow[]>;

  // ── Mutations ──────────────────────────────────────────────

  /**
   * Create a new row. Receives the validated body (after Zod parse).
   * Return the created row to include in the response.
   */
  create?: (body: any, req: NextRequest) => Promise<TRow>;

  /**
   * Update an existing row. Receives the validated body (after Zod parse).
   * The body always contains `id`.
   */
  update?: (body: any, req: NextRequest) => Promise<TRow | { success: true }>;

  /**
   * Delete a row by ID. Return the deleted row or { success: true }.
   */
  remove?: (id: number | string, req: NextRequest) => Promise<{ success: true } | TRow>;

  // ── Hooks ──────────────────────────────────────────────────

  hooks?: {
    /** Run before create — can transform body */
    beforeCreate?: (body: any) => Promise<any>;
    /** Run after successful create — fire-and-forget (realtime, side effects) */
    afterCreate?: (row: TRow) => Promise<void>;
    /** Run before update — can transform body */
    beforeUpdate?: (body: any) => Promise<any>;
    /** Run after successful update */
    afterUpdate?: (result: any) => Promise<void>;
    /** Run before delete */
    beforeDelete?: (id: number | string) => Promise<void>;
    /** Run after successful delete */
    afterDelete?: (id: number | string) => Promise<void>;
  };
}
