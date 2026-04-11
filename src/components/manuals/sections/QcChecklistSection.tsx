'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Loader2, Trash2, Pencil } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';

interface QcCheckRow {
  id: number;
  step_label: string;
  step_type: string;
  sort_order: number;
}

interface QcChecklistSectionProps {
  catalogId: number;
  qcChecks: QcCheckRow[];
  onRefresh: () => void;
}

const STEP_TYPES = ['PASS_FAIL', 'NUMERIC', 'TEXT', 'VISUAL', 'MEASUREMENT'];

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

export function QcChecklistSection({ catalogId, qcChecks, onRefresh }: QcChecklistSectionProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [stepLabel, setStepLabel] = useState('');
  const [stepType, setStepType] = useState('PASS_FAIL');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const resetForm = () => {
    setStepLabel('');
    setStepType('PASS_FAIL');
    setShowAdd(false);
    setEditingId(null);
  };

  const openEditForm = (check: QcCheckRow) => {
    setEditingId(check.id);
    setStepLabel(check.step_label);
    setStepType(check.step_type);
    setShowAdd(true);
  };

  const handleSave = useCallback(async () => {
    if (!stepLabel.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkId: editingId, stepLabel: stepLabel.trim(), stepType }),
        });
      } else {
        await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepLabel: stepLabel.trim(),
            stepType,
            sortOrder: qcChecks.length,
          }),
        });
      }
      resetForm();
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [catalogId, editingId, stepLabel, stepType, qcChecks.length, onRefresh]);

  const handleRemove = useCallback(async (checkId: number) => {
    setRemoving(checkId);
    try {
      await fetch(`/api/sku-catalog/${catalogId}/qc-checks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkId }),
      });
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }, [catalogId, onRefresh]);

  return (
    <div className="space-y-2">
      {qcChecks.length === 0 && !showAdd && (
        <p className="text-[10px] font-semibold text-gray-400 px-1">No QC steps defined yet.</p>
      )}

      {qcChecks.map((check, idx) => (
        <div key={check.id} className="flex items-center gap-2 rounded-xl bg-gray-50 px-2.5 py-2 group">
          <span className="shrink-0 w-5 text-center text-[10px] font-black text-gray-400 tabular-nums">{idx + 1}</span>
          <span className="flex-1 min-w-0 truncate text-[11px] font-bold text-gray-800">{check.step_label}</span>
          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${stepTypeBadgeClass(check.step_type)}`}>
            {check.step_type}
          </span>
          <button
            type="button"
            onClick={() => openEditForm(check)}
            className="shrink-0 p-1 rounded-lg text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100"
            title="Edit step"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      ))}

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
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-900 placeholder:text-gray-400"
              />
              <select
                value={stepType}
                onChange={(e) => setStepType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-900"
              >
                {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !stepLabel.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  {editingId ? 'Update' : 'Add Step'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => handleRemove(editingId)}
                    disabled={removing === editingId}
                    className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-600 hover:bg-red-50"
                  >
                    {removing === editingId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50"
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
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add Step
        </button>
      )}
    </div>
  );
}
