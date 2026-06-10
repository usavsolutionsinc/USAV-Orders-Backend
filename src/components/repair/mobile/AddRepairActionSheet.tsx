'use client';

import { useState } from 'react';
import { useBodyScrollLock } from '@/design-system/hooks';

type ActionType = 'replaced' | 'repaired' | 'cleaned' | 'tested' | 'no_fix' | 'awaiting_part';

interface Props {
  repairId: number;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: { id: ActionType; emoji: string; label: string; sub: string }[] = [
  { id: 'replaced',      emoji: '🔁', label: 'Replaced',      sub: 'Swapped a part' },
  { id: 'repaired',      emoji: '🔧', label: 'Repaired',      sub: 'Fixed without swap' },
  { id: 'cleaned',       emoji: '🧼', label: 'Cleaned',       sub: 'Contacts / ports' },
  { id: 'tested',        emoji: '✅', label: 'Tested',        sub: 'Verified working' },
  { id: 'no_fix',        emoji: '❌', label: 'No fix',        sub: 'Cannot be repaired' },
  { id: 'awaiting_part', emoji: '⏸', label: 'Awaiting part', sub: 'Ordered, waiting' },
];

interface FormState {
  partName: string;
  oldSku: string;
  newSku: string;
  oldSerial: string;
  newSerial: string;
  durationMin: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  partName: '',
  oldSku: '',
  newSku: '',
  oldSerial: '',
  newSerial: '',
  durationMin: '',
  notes: '',
};

export function AddRepairActionSheet({ repairId, onClose, onSaved }: Props) {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(true);

  const pick = (t: ActionType) => {
    setActionType(t);
    setStep('details');
  };

  const handleSave = async () => {
    if (!actionType || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/repair/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId,
          actionType,
          partName: form.partName || null,
          oldSku: form.oldSku || null,
          newSku: form.newSku || null,
          oldSerial: form.oldSerial || null,
          newSerial: form.newSerial || null,
          durationMin: form.durationMin ? Number(form.durationMin) : null,
          notes: form.notes || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        throw new Error(body?.details || body?.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const showReplacement = actionType === 'replaced';
  const showPartName = actionType === 'replaced' || actionType === 'repaired';
  const showDuration =
    actionType === 'repaired' ||
    actionType === 'tested' ||
    actionType === 'cleaned' ||
    actionType === 'replaced';

  return (
    <div className="fixed inset-0 z-modal flex flex-col bg-white">
      <header className="shrink-0 flex items-center justify-between border-b border-slate-200 px-4 py-3">
        {step === 'type' ? (
          <>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
              Add action
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-caption font-black uppercase tracking-wide text-slate-500 active:text-slate-900"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep('type')}
              className="text-caption font-black uppercase tracking-wide text-slate-500 active:text-slate-900"
            >
              ← Back
            </button>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
              {actionType && TYPES.find((t) => t.id === actionType)?.label}
            </h2>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-caption font-black uppercase tracking-wide text-white shadow-sm active:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {step === 'type' && (
          <div className="grid grid-cols-2 gap-3">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className="flex flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50 active:scale-[0.98] transition-transform"
              >
                <span className="text-3xl leading-none" aria-hidden>
                  {t.emoji}
                </span>
                <p className="mt-1 text-sm font-black text-slate-900">{t.label}</p>
                <p className="text-micro font-semibold text-slate-500 leading-snug">{t.sub}</p>
              </button>
            ))}
          </div>
        )}

        {step === 'details' && actionType && (
          <div className="space-y-3">
            {showPartName && (
              <Field
                label="Part name"
                value={form.partName}
                onChange={(v) => setForm({ ...form, partName: v })}
                placeholder="Battery, USB-C port, speaker driver…"
                autoFocus
              />
            )}

            {showReplacement && (
              <>
                <Field
                  label="Old SKU (removed)"
                  value={form.oldSku}
                  onChange={(v) => setForm({ ...form, oldSku: v })}
                  placeholder="SKU of the defective part"
                  mono
                />
                <Field
                  label="New SKU (replacement)"
                  value={form.newSku}
                  onChange={(v) => setForm({ ...form, newSku: v })}
                  placeholder="SKU of the new part"
                  mono
                />
                <Field
                  label="Old serial (optional)"
                  value={form.oldSerial}
                  onChange={(v) => setForm({ ...form, oldSerial: v })}
                  placeholder="Serial removed"
                  mono
                />
                <Field
                  label="New serial (optional)"
                  value={form.newSerial}
                  onChange={(v) => setForm({ ...form, newSerial: v })}
                  placeholder="Serial installed"
                  mono
                />
              </>
            )}

            {showDuration && (
              <Field
                label="Duration (min)"
                value={form.durationMin}
                onChange={(v) => setForm({ ...form, durationMin: v.replace(/[^0-9]/g, '') })}
                placeholder="15"
                inputMode="numeric"
              />
            )}

            <FieldTextarea
              label="Notes"
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              placeholder={
                actionType === 'no_fix'
                  ? 'Why this unit can\'t be repaired…'
                  : 'What you did, anything notable…'
              }
            />

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  inputMode,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  inputMode?: 'text' | 'numeric';
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-micro font-black uppercase tracking-[0.14em] text-slate-500 mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-micro font-black uppercase tracking-[0.14em] text-slate-500 mb-1">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-none"
      />
    </label>
  );
}
