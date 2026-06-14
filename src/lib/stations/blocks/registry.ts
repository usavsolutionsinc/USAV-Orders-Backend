/**
 * Block registry — same shape and discipline as the workflow node registry
 * (src/lib/workflow/registry.ts). The palette, Config Sheet and renderer all
 * derive from registry metadata; hard-coding a block type in a component is
 * a bug.
 */

import type { BlockDefinition, BlockMeta } from '../contract';

const registry = new Map<string, BlockDefinition>();

export function registerBlock(def: BlockDefinition): void {
  if (registry.has(def.type)) {
    throw new Error(`Station block type already registered: ${def.type}`);
  }
  registry.set(def.type, def);
}

export function getBlock(type: string): BlockDefinition | undefined {
  return registry.get(type);
}

export function hasBlock(type: string): boolean {
  return registry.has(type);
}

export function listBlocks(): BlockDefinition[] {
  return [...registry.values()];
}

/** Palette-facing metadata (no component thunk) — serializable. */
export function listBlockMeta(): BlockMeta[] {
  return listBlocks().map(({ component: _component, ...meta }) => meta);
}

/** Test-only. */
export function __clearBlockRegistry(): void {
  registry.clear();
}
