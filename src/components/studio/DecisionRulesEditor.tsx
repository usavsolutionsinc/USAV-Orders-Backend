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

interface OutputPort {
  id: string;
  label: string;
}

interface RuleRow {
  id: string;
  when: { grade?: string; channel?: string; disposition?: string };
  thenPort: string;
}

interface DecisionRulesEditorProps {
  nodeId: string;
  config: Record<string, unknown>;
  /** Same seam as NodeConfigForm — patch merges into node.config (null clears). */
  onChange: (nodeId: string, patch: Record<string, unknown>) => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700';
const SMALL_INPUT_CLASS =
  'min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-700';

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
    return {
      id: asString(row.id) || crypto.randomUUID(),
      when: {
        grade: asString(when.grade) || undefined,
        channel: asString(when.channel) || undefined,
        disposition: asString(when.disposition) || undefined,
      },
      thenPort: asString(row.thenPort),
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
    writeRules([...rules, { id: crypto.randomUUID(), when: {}, thenPort: outputs[0]?.id ?? '' }]);
  const updateRuleWhen = (i: number, field: keyof RuleRow['when'], value: string) =>
    writeRules(
      rules.map((r, idx) =>
        idx === i ? { ...r, when: { ...r.when, [field]: value || undefined } } : r,
      ),
    );
  const updateRuleThen = (i: number, thenPort: string) =>
    writeRules(rules.map((r, idx) => (idx === i ? { ...r, thenPort } : r)));
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Output ports
          </span>
          <button
            type="button"
            onClick={addOutput}
            className="-my-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50"
          >
            + Port
          </button>
        </div>
        {outputs.length === 0 ? (
          <p className="text-[11px] text-slate-400">No ports yet — add one to route to.</p>
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
                <button
                  type="button"
                  onClick={() => removeOutput(i)}
                  aria-label={`Remove port ${o.id || i + 1}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-500 transition-colors hover:bg-rose-50"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Rules */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Rules · first match wins
          </span>
          <button
            type="button"
            onClick={addRule}
            disabled={outputs.length === 0}
            className="-my-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            + Rule
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="text-[11px] text-slate-400">
            No rules — items fall through to the default port (or park).
          </p>
        ) : (
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <li key={r.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    #{i + 1} When
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveRule(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move rule ${i + 1} up`}
                      className="rounded px-1 text-[11px] font-semibold text-slate-400 transition-colors hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRule(i, 1)}
                      disabled={i === rules.length - 1}
                      aria-label={`Move rule ${i + 1} down`}
                      className="rounded px-1 text-[11px] font-semibold text-slate-400 transition-colors hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(i)}
                      aria-label={`Remove rule ${i + 1}`}
                      className="rounded px-1 text-[11px] font-semibold text-rose-500 transition-colors hover:bg-rose-100"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {WHEN_FIELDS.map((field) => (
                    <div key={field} className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 text-[10px] font-semibold capitalize text-slate-500">
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
                  <span className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Default port */}
      <div className="space-y-1">
        <label
          htmlFor={`decision-default-${nodeId}`}
          className="block text-[10px] font-bold uppercase tracking-wider text-slate-400"
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
        <p className="text-[11px] text-slate-400">
          Where items go when no rule matches. Leave unset to park them for a human.
        </p>
      </div>
    </div>
  );
}
