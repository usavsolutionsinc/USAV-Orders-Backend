'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, Pencil } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';

interface QcCheckRow {
  id: number;
  step_label: string;
  step_type: string;
  sort_order: number;
  /** 'draft' steps are hidden from the tech execution view until published. */
  status?: string;
  // ─ Structured-value config (Phase 1; docs/qc-crud-endpoints-plan.md) ─
  value_kind?: string | null;
  value_unit?: string | null;
  value_enum?: string[] | null;
  pass_min?: string | number | null;
  pass_max?: string | number | null;
  /** Failure mode auto-tagged on the unit when this step fails. */
  failure_mode_id?: number | null;
}

interface FailureModeOption {
  id: number;
  label: string;
  severity: string;
}

interface QcChecklistSectionProps {
  catalogId: number;
  qcChecks: QcCheckRow[];
  onRefresh: () => void;
}

const STEP_TYPES = ['PASS_FAIL', 'NUMERIC', 'TEXT', 'VISUAL', 'MEASUREMENT'];

/** How the tester captures a step's answer. '' = legacy pass/fail boolean. */
const VALUE_KINDS = ['', 'BOOLEAN', 'PERCENT', 'NUMBER', 'ENUM', 'TEXT'] as const;
const VALUE_KIND_LABEL: Record<string, string> = {
  '': 'Pass / Fail (default)',
  BOOLEAN: 'Pass / Fail',
  PERCENT: 'Percent (%)',
  NUMBER: 'Number',
  ENUM: 'Choice list',
  TEXT: 'Free text',
};

/** Numeric kinds support a pass band (pass_min / pass_max) + a unit. */
const NUMERIC_KINDS = new Set(['PERCENT', 'NUMBER']);

function stepTypeBadgeClass(type: string): string {
  switch (type) {
    case 'PASS_FAIL': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'NUMERIC': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'TEXT': return 'bg-gray-50 text-gray-600 border-gray-200';
    case 'VISUAL': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'MEASUREMENT': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

/** Human summary of a step's value config for the row (e.g. "80–100 %", "A / B / C"). */
function valueSummary(check: QcCheckRow): string | null {
  const kind = check.value_kind || '';
  if (!kind || kind === 'BOOLEAN') return null;
  if (kind === 'ENUM') {
    const opts = check.value_enum ?? [];
    return opts.length ? opts.join(' / ') : 'choice';
  }
  if (NUMERIC_KINDS.has(kind)) {
    const min = check.pass_min == null ? null : Number(check.pass_min);
    const max = check.pass_max == null ? null : Number(check.pass_max);
    const unitRaw = check.value_unit || (kind === 'PERCENT' ? '%' : '');
    const unit = unitRaw ? ` ${unitRaw}` : '';
    if (min != null && max != null) return `${min}–${max}${unit}`;
    if (min != null) return `≥ ${min}${unit}`;
    if (max != null) return `≤ ${max}${unit}`;
    return kind === 'PERCENT' ? '%' : (check.value_unit || 'number');
  }
  return kind === 'TEXT' ? 'text' : null;
}

export function QcChecklistSection({ catalogId, qcChecks, onRefresh }: QcChecklistSectionProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [stepLabel, setStepLabel] = useState('');
  const [stepType, setStepType] = useState('PASS_FAIL');
  const [valueKind, setValueKind] = useState('');
  const [valueUnit, setValueUnit] = useState('');
  const [valueEnumText, setValueEnumText] = useState('');
  const [passMin, setPassMin] = useState('');
  const [passMax, setPassMax] = useState('');
  const [failureModeId, setFailureModeId] = useState('');
  const [failureModes, setFailureModes] = useState<FailureModeOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [publishing, setPublishing] = useState<number | null>(null);

  // Failure-mode taxonomy for the "auto-tag on fail" picker (active only).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/failure-modes?activeOnly=1', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && res.ok && json?.success) {
          setFailureModes(
            (json.modes as { id: number; label: string; severity: string }[]).map((m) => ({
              id: m.id, label: m.label, severity: m.severity,
            })),
          );
        }
      } catch { /* picker just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const resetForm = () => {
    setStepLabel('');
    setStepType('PASS_FAIL');
    setValueKind('');
    setValueUnit('');
    setValueEnumText('');
    setPassMin('');
    setPassMax('');
    setFailureModeId('');
    setShowAdd(false);
    setEditingId(null);
  };

  const openEditForm = (check: QcCheckRow) => {
    setEditingId(check.id);
    setStepLabel(check.step_label);
    setStepType(check.step_type);
    setValueKind(check.value_kind || '');
    setValueUnit(check.value_unit || '');
    setValueEnumText((check.value_enum ?? []).join(', '));
    setPassMin(check.pass_min == null ? '' : String(check.pass_min));
    setPassMax(check.pass_max == null ? '' : String(check.pass_max));
    setFailureModeId(check.failure_mode_id == null ? '' : String(check.failure_mode_id));
    setShowAdd(true);
  };

  /**
   * Build the structured-value payload, scoped to the selected kind so we never
   * send fields the server rejects (passMin/Max only on numeric kinds, valueEnum
   * only on ENUM). On update we send `null` to clear, so omitting → cleared.
   */
  const valuePayload = useCallback(() => {
    const kind = valueKind || null;
    const numeric = kind != null && NUMERIC_KINDS.has(kind);
    const enumList = valueEnumText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      valueKind: kind,
      valueUnit: numeric && valueUnit.trim() ? valueUnit.trim() : null,
      valueEnum: kind === 'ENUM' && enumList.length ? enumList : null,
      passMin: numeric && passMin.trim() !== '' ? Number(passMin) : null,
      passMax: numeric && passMax.trim() !== '' ? Number(passMax) : null,
      failureModeId: failureModeId ? Number(failureModeId) : null,
    };
  }, [valueKind, valueUnit, valueEnumText, passMin, passMax, failureModeId]);

  const handleSave = useCallback(async () => {
    if (!stepLabel.trim()) return;
    setSaving(true);
    try {
      const vp = valuePayload();
      if (editingId) {
        await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkId: editingId, stepLabel: stepLabel.trim(), stepType, ...vp }),
        });
      } else {
        await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepLabel: stepLabel.trim(),
            stepType,
            sortOrder: qcChecks.length,
            ...vp,
          }),
        });
      }
      resetForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [catalogId, editingId, stepLabel, stepType, valuePayload, qcChecks.length, onRefresh]);

  // Settle / unsettle a step. Drafts are hidden from the tech execution view;
  // publishing makes the step live. Optimistic-free — just refresh after.
  const togglePublish = useCallback(async (check: QcCheckRow) => {
    const next = (check.status ?? 'published') === 'published' ? 'draft' : 'published';
    setPublishing(check.id);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId: check.id, status: next }),
      });
      onRefresh();
    } finally {
      setPublishing(null);
    }
  }, [catalogId, onRefresh]);

  const handleRemove = useCallback(async (checkId: number) => {
    setRemoving(checkId);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId }),
      });
      resetForm();
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }, [catalogId, onRefresh]);

  const showNumeric = NUMERIC_KINDS.has(valueKind);
  const showEnum = valueKind === 'ENUM';

  return (
    <div className="space-y-2">
      {qcChecks.length === 0 && !showAdd && (
        <p className="text-micro font-semibold text-gray-400 px-1">No QC steps defined yet.</p>
      )}

      {qcChecks.map((check, idx) => {
        const isDraft = (check.status ?? 'published') === 'draft';
        const summary = valueSummary(check);
        return (
          <div
            key={check.id}
            className={`flex items-center gap-2 rounded-xl px-2.5 py-2 group ${
              isDraft ? 'bg-amber-50/60 ring-1 ring-amber-100' : 'bg-gray-50'
            }`}
          >
            <span className="shrink-0 w-5 text-center text-micro font-black text-gray-400 tabular-nums">{idx + 1}</span>
            <span className={`flex-1 min-w-0 truncate text-caption font-bold ${isDraft ? 'text-gray-500' : 'text-gray-800'}`}>
              {check.step_label}
            </span>
            {summary && (
              <span className={`shrink-0 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700 ${microBadge}`}>
                {summary}
              </span>
            )}
            {isDraft && (
              <span className={`shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 ${microBadge}`}>
                DRAFT
              </span>
            )}
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${stepTypeBadgeClass(check.step_type)}`}>
              {check.step_type}
            </span>
            <button
              type="button"
              onClick={() => togglePublish(check)}
              disabled={publishing === check.id}
              className={`shrink-0 rounded-lg px-1.5 py-0.5 text-micro font-black uppercase tracking-wider transition-colors opacity-0 group-hover:opacity-100 ${
                isDraft
                  ? 'text-emerald-600 hover:bg-emerald-50'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
              title={isDraft ? 'Publish — make this step live for techs' : 'Unpublish — hide from techs while reworking'}
            >
              {publishing === check.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isDraft ? 'Publish' : 'Unpublish'}
            </button>
            <button
              type="button"
              onClick={() => openEditForm(check)}
              className="shrink-0 p-1 rounded-lg text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100"
              title="Edit step"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-gray-200 bg-white p-2.5 space-y-2">
              <input
                type="text"
                value={stepLabel}
                onChange={(e) => setStepLabel(e.target.value)}
                placeholder="Check step description"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
              />
              <div className="flex gap-2">
                <select
                  value={stepType}
                  onChange={(e) => setStepType(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900"
                  title="Category badge"
                >
                  {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={valueKind}
                  onChange={(e) => setValueKind(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900"
                  title="How the tester records this step"
                >
                  {VALUE_KINDS.map((k) => (
                    <option key={k || 'default'} value={k}>{VALUE_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>

              {showNumeric && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={passMin}
                    onChange={(e) => setPassMin(e.target.value)}
                    placeholder="Pass min"
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
                  />
                  <input
                    type="number"
                    value={passMax}
                    onChange={(e) => setPassMax(e.target.value)}
                    placeholder="Pass max"
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
                  />
                  {valueKind !== 'PERCENT' && (
                    <input
                      type="text"
                      value={valueUnit}
                      onChange={(e) => setValueUnit(e.target.value)}
                      placeholder="Unit"
                      className="w-20 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
                    />
                  )}
                </div>
              )}

              {showEnum && (
                <input
                  type="text"
                  value={valueEnumText}
                  onChange={(e) => setValueEnumText(e.target.value)}
                  placeholder="Choices, comma-separated (e.g. A, B, C)"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900 placeholder:text-gray-400"
                />
              )}

              <select
                value={failureModeId}
                onChange={(e) => setFailureModeId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-caption font-bold text-gray-900"
                title="Auto-tag this failure mode on the unit when this step fails"
              >
                <option value="">Auto-tag on fail: none</option>
                {failureModes.map((m) => (
                  <option key={m.id} value={m.id}>{`⚠ ${m.label} (${m.severity})`}</option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !stepLabel.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {editingId ? 'Update' : 'Add Step'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => handleRemove(editingId)}
                    disabled={removing === editingId}
                    title="Delete step"
                    className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-micro font-black uppercase tracking-wider text-red-600 hover:bg-red-50"
                  >
                    {removing === editingId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showAdd && (
        <button
          type="button"
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-micro font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add Step
        </button>
      )}
    </div>
  );
}
