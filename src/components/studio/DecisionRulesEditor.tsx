'use client';

/**
 * DecisionRulesEditor — the custom config sheet for a `decision` node (Track 1,
 * Stage 1). The generic scalar NodeConfigForm can't express an array of
 * when/then rows, so a decision node gets THIS editor instead: edit the output
 * ports, list/add/remove/reorder rules (each a grade/channel/disposition matcher
 * → a thenPort), and set a default port.
 *
 * It writes the WHOLE rule table back through the same onChange(nodeId, patch)
 * seam the generic form uses (the provider's onUpdateNodeConfig), so the draft
 * dirties and persists exactly like any other node config — no new save path,
 * no new permission. The decision node's run() reads these keys verbatim
 * (src/lib/workflow/nodes/decision.node.ts).
 *
 * Style mirrors the inspector's slate inputs (raw Tailwind, no hardcoded hex).
 */

import type { ChangeEvent } from 'react';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { ChevronDown, ChevronUp, Info, MapPin, Plus, Trash2 } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  parseDecisionPlacement,
  type DecisionPlacement,
} from '@/lib/workflow/decision-eval';

interface OutputPort {
  id: string;
  label: string;
}

interface RuleRow {
  id: string;
  when: { grade?: string; channel?: string; disposition?: string };
  thenPort: string;
  /** Optional domain placement directive (bin / category) the action layer consumes. */
  then?: DecisionPlacement;
}

interface DecisionRulesEditorProps {
  nodeId: string;
  config: Record<string, unknown>;
  /** Same seam as NodeConfigForm — patch merges into node.config (null clears). */
  onChange: (nodeId: string, patch: Record<string, unknown>) => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-border-soft bg-surface-card px-2 py-1 text-xs font-medium text-text-muted';
const SMALL_INPUT_CLASS =
  'min-w-0 flex-1 rounded-md border border-border-soft bg-surface-card px-1.5 py-1 text-caption font-medium text-text-muted';

const WHEN_FIELDS: Array<keyof RuleRow['when']> = ['grade', 'channel', 'disposition'];

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Read config.outputs defensively into typed port rows. */
function readOutputs(config: Record<string, unknown>): OutputPort[] {
  const raw = config.outputs;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    const row = (o ?? {}) as Record<string, unknown>;
    return { id: asString(row.id), label: asString(row.label) };
  });
}

/** Read config.rules defensively into typed rule rows. */
function readRules(config: Record<string, unknown>): RuleRow[] {
  const raw = config.rules;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const when = (row.when ?? {}) as Record<string, unknown>;
    // `then` (placement) is parsed via the shared SoT so it round-trips intact —
    // an edit that doesn't touch placement must not silently drop it.
    const then = parseDecisionPlacement(row.then);
    return {
      id: asString(row.id) || safeRandomUUID(),
      when: {
        grade: asString(when.grade) || undefined,
        channel: asString(when.channel) || undefined,
        disposition: asString(when.disposition) || undefined,
      },
      thenPort: asString(row.thenPort),
      ...(then ? { then } : {}),
    };
  });
}

export function DecisionRulesEditor({ nodeId, config, onChange }: DecisionRulesEditorProps) {
  const outputs = readOutputs(config);
  const rules = readRules(config);
  const defaultPort = asString(config.defaultPort);

  const writeOutputs = (next: OutputPort[]) => onChange(nodeId, { outputs: next });
  const writeRules = (next: RuleRow[]) => onChange(nodeId, { rules: next });

  // ── Output ports ──
  const addOutput = () => {
    const seq = outputs.length + 1;
    writeOutputs([...outputs, { id: `port_${seq}`, label: `Port ${seq}` }]);
  };
  const updateOutput = (i: number, patch: Partial<OutputPort>) =>
    writeOutputs(outputs.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const removeOutput = (i: number) => writeOutputs(outputs.filter((_, idx) => idx !== i));

  // ── Rules ──
  const addRule = () =>
    writeRules([...rules, { id: safeRandomUUID(), when: {}, thenPort: outputs[0]?.id ?? '' }]);
  const updateRuleWhen = (i: number, field: keyof RuleRow['when'], value: string) =>
    writeRules(
      rules.map((r, idx) =>
        idx === i ? { ...r, when: { ...r.when, [field]: value || undefined } } : r,
      ),
    );
  const updateRuleThen = (i: number, thenPort: string) =>
    writeRules(rules.map((r, idx) => (idx === i ? { ...r, thenPort } : r)));
  /** Patch one field of a rule's placement directive; clear `then` when it empties out. */
  const updateRulePlacement = (i: number, field: keyof DecisionPlacement, value: string) =>
    writeRules(
      rules.map((r, idx) => {
        if (idx !== i) return r;
        const next = parseDecisionPlacement({ ...r.then, [field]: value });
        const { then: _drop, ...rest } = r;
        return next ? { ...rest, then: next } : rest;
      }),
    );
  const removeRule = (i: number) => writeRules(rules.filter((_, idx) => idx !== i));
  const moveRule = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    writeRules(next);
  };

  return (
    <div className="space-y-4">
      {/* Output ports */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-micro font-bold uppercase tracking-wider text-text-faint">
            Output ports
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus />}
            onClick={addOutput}
            className="-my-0.5 text-blue-600 hover:bg-blue-50 hover:text-blue-600"
          >
            Port
          </Button>
        </div>
        {outputs.length === 0 ? (
          <p className="text-caption text-text-faint">No ports yet — add one to route to.</p>
        ) : (
          <ul className="space-y-1">
            {outputs.map((o, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <input
                  value={o.id}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateOutput(i, { id: e.target.value })
                  }
                  placeholder="id"
                  aria-label={`Output port ${i + 1} id`}
                  className={`${SMALL_INPUT_CLASS} font-mono`}
                />
                <input
                  value={o.label}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateOutput(i, { label: e.target.value })
                  }
                  placeholder="label"
                  aria-label={`Output port ${i + 1} label`}
                  className={SMALL_INPUT_CLASS}
                />
                <IconButton
                  onClick={() => removeOutput(i)}
                  ariaLabel={`Remove port ${o.id || i + 1}`}
                  className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Rules */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-text-faint">
            Rules · first match wins
            <HoverTooltip
              label="Rules are tested top-to-bottom; the first whose when-conditions all match routes the item to its port. Reorder with the arrows. An empty when matches any item."
              focusable={false}
            >
              <Info className="h-3 w-3 text-text-faint" />
            </HoverTooltip>
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus />}
            onClick={addRule}
            disabled={outputs.length === 0}
            className="-my-0.5 text-blue-600 hover:bg-blue-50 hover:text-blue-600 disabled:text-text-faint disabled:hover:bg-transparent"
          >
            Rule
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="text-caption text-text-faint">
            No rules — items fall through to the default port (or park).
          </p>
        ) : (
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <li key={r.id} className="rounded-md border border-border-soft bg-surface-canvas p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-eyebrow font-bold uppercase tracking-wider text-text-faint">
                    #{i + 1} When
                  </span>
                  <div className="flex items-center gap-0.5">
                    <IconButton
                      onClick={() => moveRule(i, -1)}
                      disabled={i === 0}
                      ariaLabel={`Move rule ${i + 1} up`}
                      className="rounded p-0.5 text-text-faint hover:bg-surface-strong hover:text-text-faint disabled:opacity-30 disabled:hover:bg-transparent"
                      icon={<ChevronUp className="h-3.5 w-3.5" />}
                    />
                    <IconButton
                      onClick={() => moveRule(i, 1)}
                      disabled={i === rules.length - 1}
                      ariaLabel={`Move rule ${i + 1} down`}
                      className="rounded p-0.5 text-text-faint hover:bg-surface-strong hover:text-text-faint disabled:opacity-30 disabled:hover:bg-transparent"
                      icon={<ChevronDown className="h-3.5 w-3.5" />}
                    />
                    <IconButton
                      onClick={() => removeRule(i)}
                      ariaLabel={`Remove rule ${i + 1}`}
                      className="rounded p-0.5 text-rose-500 hover:bg-rose-100 hover:text-rose-500"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  {WHEN_FIELDS.map((field) => (
                    <div key={field} className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 text-micro font-semibold capitalize text-text-soft">
                        {field}
                      </span>
                      <input
                        value={r.when[field] ?? ''}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          updateRuleWhen(i, field, e.target.value)
                        }
                        placeholder="any"
                        aria-label={`Rule ${i + 1} ${field}`}
                        className={SMALL_INPUT_CLASS}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="w-20 shrink-0 text-micro font-bold uppercase tracking-wider text-text-faint">
                    → Then
                  </span>
                  <select
                    value={r.thenPort}
                    onChange={(e) => updateRuleThen(i, e.target.value)}
                    aria-label={`Rule ${i + 1} then port`}
                    className={SMALL_INPUT_CLASS}
                  >
                    <option value="">— pick a port —</option>
                    {outputs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label || o.id}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Placement directive (optional) — the action layer moves the unit
                    to this bin / files it under this category. Blank = route-only. */}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="flex w-20 shrink-0 items-center gap-1 text-micro font-bold uppercase tracking-wider text-text-faint">
                    <MapPin className="h-3 w-3" />
                    Place
                    <HoverTooltip
                      label="Optional. The bin/lane this rule sends the unit to (a barcode or name) and a filing category. Leave blank for a route-only rule that just picks a port."
                      focusable={false}
                    >
                      <Info className="h-3 w-3 text-text-faint" />
                    </HoverTooltip>
                  </span>
                  <input
                    value={r.then?.placement ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRulePlacement(i, 'placement', e.target.value)
                    }
                    placeholder="bin (barcode/name)"
                    aria-label={`Rule ${i + 1} placement bin`}
                    className={`${SMALL_INPUT_CLASS} font-mono`}
                  />
                  <input
                    value={r.then?.category ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateRulePlacement(i, 'category', e.target.value)
                    }
                    placeholder="category"
                    aria-label={`Rule ${i + 1} placement category`}
                    className={SMALL_INPUT_CLASS}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Default port */}
      <div className="space-y-1">
        <label
          htmlFor={`decision-default-${nodeId}`}
          className="block text-micro font-bold uppercase tracking-wider text-text-faint"
        >
          Default port
        </label>
        <select
          id={`decision-default-${nodeId}`}
          value={defaultPort}
          onChange={(e) => onChange(nodeId, { defaultPort: e.target.value || null })}
          className={INPUT_CLASS}
        >
          <option value="">— park unmatched items —</option>
          {outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label || o.id}
            </option>
          ))}
        </select>
        <p className="text-caption text-text-faint">
          Where items go when no rule matches. Leave unset to park them for a human.
        </p>
      </div>
    </div>
  );
}

/**
 * DecisionRulesReadout — the compact, READ-ONLY rendering of the same rule table
 * for the published (non-editable) inspector view. No inputs: each rule shows
 * its when-conditions as chips and the port it routes to, closed by the default
 * port (or "park"). It reads the EXACT same config keys the editor writes and
 * the node evaluates (src/lib/workflow/decision-eval.ts), so editor / readout /
 * runtime can never drift.
 */
export function DecisionRulesReadout({ config }: { config: Record<string, unknown> }) {
  const outputs = readOutputs(config);
  const rules = readRules(config);
  const defaultPort = asString(config.defaultPort);
  const labelOf = (id: string) => outputs.find((o) => o.id === id)?.label || id || '—';

  if (rules.length === 0 && !defaultPort) {
    return <p className="text-xs text-text-faint">No rules — every item parks for a human.</p>;
  }

  return (
    <div className="space-y-1.5">
      {rules.length > 0 && (
        <ol className="space-y-1">
          {rules.map((r, i) => {
            const conds = WHEN_FIELDS.filter((f) => r.when[f]);
            return (
              <li key={r.id} className="flex items-start gap-1.5 text-xs">
                <span className="mt-0.5 shrink-0 font-mono text-micro font-semibold text-text-faint">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  {conds.length === 0 ? (
                    <span className="text-caption italic text-text-faint">any item</span>
                  ) : (
                    conds.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-surface-sunken px-1.5 py-0.5 text-micro font-semibold text-text-muted"
                      >
                        <span className="capitalize text-text-faint">{f} </span>
                        {r.when[f]}
                      </span>
                    ))
                  )}
                </span>
                <span className="shrink-0 text-text-faint">→</span>
                <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-micro font-semibold text-text-muted">
                  {labelOf(r.thenPort)}
                </span>
                {r.then?.placement && (
                  <span className="flex shrink-0 items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 font-mono text-micro font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                    <MapPin className="h-3 w-3" />
                    {r.then.placement}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-caption text-text-faint">
        Default ·{' '}
        {defaultPort ? (
          <span className="font-semibold text-text-muted">{labelOf(defaultPort)}</span>
        ) : (
          <span className="italic">park for a human</span>
        )}
      </p>
    </div>
  );
}
