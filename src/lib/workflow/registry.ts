/**
 * Workflow engine — node-type registry.
 *
 * An in-memory map of node type → NodeDefinition. Built-in nodes register
 * themselves on import (see ./nodes/*, wired up by registerBuiltins in index.ts);
 * plugin nodes can register at startup the same way. The canvas reads the
 * registry (via /api/workflow/nodes) to build its palette, so a new node type
 * appears automatically without touching the UI.
 */

import type { NodeDefinition, NodeMeta } from './contract';

const registry = new Map<string, NodeDefinition>();

export function registerNode(def: NodeDefinition): void {
  if (registry.has(def.type)) {
    throw new Error(`Workflow node type already registered: ${def.type}`);
  }
  registry.set(def.type, def);
}

export function getNode(type: string): NodeDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown workflow node type: ${type}`);
  return def;
}

export function hasNode(type: string): boolean {
  return registry.has(type);
}

export function listNodes(): NodeDefinition[] {
  return [...registry.values()];
}

/** Palette metadata (strips `run`) for the API/canvas. */
export function listNodeMeta(): NodeMeta[] {
  return listNodes().map(({ run: _run, ...meta }) => meta);
}

/** Test-only: wipe the registry between cases. */
export function __clearRegistry(): void {
  registry.clear();
}
