/**
 * Registry validation for station configs — the server-side gate that keeps
 * `station_definitions.config` honest: every block/source/action id must be
 * registered, and a block may only sit in a slot it declared. Structural
 * validation (shapes/types) is the Zod layer in src/lib/schemas/stations.ts;
 * this is the semantic layer.
 */

import type { SlotId, StationConfig } from './contract';
import { getBlock } from './blocks/registry';
import { getDataSource } from './data-sources';
import { getAction, actionsForSource } from './actions';
import { registerStationBuiltins } from './index';

export interface StationConfigIssue {
  blockId: string | null;
  message: string;
}

export function validateStationConfig(config: StationConfig): StationConfigIssue[] {
  registerStationBuiltins();
  const issues: StationConfigIssue[] = [];
  if (config.slots === 'legacy') return issues;

  for (const [slot, instances] of Object.entries(config.slots)) {
    for (const inst of instances ?? []) {
      const block = getBlock(inst.block);
      if (!block) {
        issues.push({ blockId: inst.id, message: `Unknown block type "${inst.block}"` });
        continue;
      }
      if (!block.slots.includes(slot as SlotId)) {
        issues.push({
          blockId: inst.id,
          message: `Block "${inst.block}" cannot occupy the "${slot}" slot`,
        });
      }
      const source = inst.source ? getDataSource(inst.source.id) : undefined;
      if (inst.source && !source) {
        issues.push({ blockId: inst.id, message: `Unknown data source "${inst.source.id}"` });
      }
      if (block.accepts === 'rows' && !inst.source) {
        issues.push({ blockId: inst.id, message: `Block "${inst.block}" needs a data source` });
      }
      if (source) {
        const fieldKeys = new Set(source.shape.map((f) => f.key));
        for (const [role, fieldKey] of Object.entries(inst.source?.fields ?? {})) {
          if (!fieldKeys.has(fieldKey)) {
            issues.push({
              blockId: inst.id,
              message: `Role "${role}" maps to "${fieldKey}", which "${source.id}" does not declare`,
            });
          }
        }
        const compatible = new Set(actionsForSource(source).map((a) => a.id));
        for (const actionId of inst.actions ?? []) {
          if (!getAction(actionId)) {
            issues.push({ blockId: inst.id, message: `Unknown action "${actionId}"` });
          } else if (!compatible.has(actionId)) {
            issues.push({
              blockId: inst.id,
              message: `Action "${actionId}" is not compatible with source "${source.id}"`,
            });
          }
        }
      }
      if (inst.done_when && !(inst.actions ?? []).includes(inst.done_when)) {
        issues.push({
          blockId: inst.id,
          message: `done_when "${inst.done_when}" must be one of the instance's bound actions`,
        });
      }
    }
  }
  return issues;
}
