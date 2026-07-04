/**
 * Write-time validation of a workflow node's `config` against its type's
 * declared `configSchema` (from the registry). This is the "govern the jsonb
 * with a per-discriminator schema" step from
 * docs/todo/schema-wide-polymorphic-refactor-plan.md ("Workflow / Studio
 * Config"): `workflow_nodes.type` + `config` is a tagged union, and the config
 * blob must conform to the tag's schema before it is persisted.
 *
 * The registry's configSchema is a small JSON-Schema-shaped object (`type`,
 * `properties`, optional `options` enum + `x-editor` UI hints). We validate the
 * subset that carries meaning for correctness — declared property TYPES and
 * `options` enums — not the UI hints. Schemas are intentionally permissive
 * (no `required`, no `additionalProperties:false`), so we only reject a
 * declared property whose value is present AND the wrong type / off-enum; extra
 * keys and omitted keys are allowed. A node type with no configSchema (most of
 * them) accepts any object.
 *
 * Pure + DB-free (registry is an in-memory map) so it unit-tests without a DB
 * and runs inside the draft-graph write path (draft-graph-writes.ts).
 */

import { hasNode, getNode } from './registry';

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

interface SchemaProp {
  type?: JsonType;
  options?: Array<{ value?: unknown } | unknown>;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
}

function typeMatches(t: JsonType, val: unknown): boolean {
  switch (t) {
    case 'string':
      return typeof val === 'string';
    case 'number':
      return typeof val === 'number' && Number.isFinite(val);
    case 'integer':
      return typeof val === 'number' && Number.isInteger(val);
    case 'boolean':
      return typeof val === 'boolean';
    case 'array':
      return Array.isArray(val);
    case 'object':
      return val !== null && typeof val === 'object' && !Array.isArray(val);
    default:
      return true;
  }
}

/**
 * Validate a node's full config against its type's configSchema.
 * Unknown type → ok (type validity is enforced separately, e.g. draftAddNode's
 * 422). No configSchema → ok. Null/undefined property values are treated as
 * unset (the schema has no `required`).
 */
export function validateNodeConfig(
  type: string,
  config: Record<string, unknown>,
): ConfigValidationResult {
  if (!hasNode(type)) return { ok: true, errors: [] };
  const schema = getNode(type).configSchema as
    | { properties?: Record<string, SchemaProp> }
    | undefined;
  if (!schema || !schema.properties) return { ok: true, errors: [] };

  const errors: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in config)) continue;
    const val = config[key];
    if (val === null || val === undefined) continue;

    if (prop.type && !typeMatches(prop.type, val)) {
      errors.push(`config.${key} must be a ${prop.type}`);
      continue;
    }
    if (Array.isArray(prop.options) && prop.options.length > 0) {
      const allowed = prop.options.map((o) =>
        o !== null && typeof o === 'object' && 'value' in o
          ? (o as { value?: unknown }).value
          : o,
      );
      if (!allowed.includes(val)) {
        errors.push(`config.${key} must be one of: ${allowed.map(String).join(', ')}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
