import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, Trash2, X } from '@/components/Icons';
import { PasteableDraftInput } from './PasteableDraftInput';
import type { ShippingInfoEditDraft } from './types';

export function ShippingInfoEditModal({
  open,
  draft,
  setDraft,
  isSaving,
  isSaveSuccess,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: ShippingInfoEditDraft;
  setDraft: (updater: ShippingInfoEditDraft | ((current: ShippingInfoEditDraft) => ShippingInfoEditDraft)) => void;
  isSaving: boolean;
  isSaveSuccess: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="shipping-edit-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-0 z-panelPopover flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={onClose}
        >
          <motion.div
            key="shipping-edit-modal-panel"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-micro font-black uppercase tracking-[0.24em] text-gray-500">Shipping Info</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-gray-900">Edit Order Details</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close shipping editor"
                title="Close shipping editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-micro font-black uppercase tracking-[0.18em] text-gray-500">Ship By Date</span>
                  <input
                    type="text"
                    value={draft.shipByDate}
                    onChange={(e) => setDraft((current) => ({ ...current, shipByDate: e.target.value }))}
                    placeholder="MM-DD-YY"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-micro font-black uppercase tracking-[0.18em] text-gray-500">Order ID</span>
                  <input
                    type="text"
                    value={draft.orderNumber}
                    onChange={(e) => setDraft((current) => ({ ...current, orderNumber: e.target.value }))}
                    placeholder="Enter order ID"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-blue-400"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-500">Tracking Numbers</p>
                </div>
                <div className="space-y-2">
                  {draft.trackingRows.map((row, index) => (
                    <div key={`tracking-${row.shipmentId ?? 'new'}-${index}`} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <PasteableDraftInput
                          value={row.tracking}
                          onChange={(value) => {
                            setDraft((current) => ({
                              ...current,
                              trackingRows: current.trackingRows.map((entry, i) =>
                                i === index ? { ...entry, tracking: value } : entry
                              ),
                            }));
                          }}
                          onPaste={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (!text.trim()) return;
                              const pasted = text.trim().toUpperCase();
                              setDraft((current) => ({
                                ...current,
                                trackingRows: current.trackingRows.map((entry, i) =>
                                  i === index ? { ...entry, tracking: pasted } : entry
                                ),
                              }));
                            } catch {}
                          }}
                          placeholder={`Tracking Number ${index + 1}`}
                          ariaLabel={`Paste tracking number ${index + 1}`}
                          title="Paste tracking number"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((current) => {
                            const next = current.trackingRows.filter((_, i) => i !== index);
                            return {
                              ...current,
                              trackingRows: next.length > 0 ? next : [{ shipmentId: null, tracking: '' }],
                            };
                          });
                        }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete tracking number ${index + 1}`}
                        title={`Delete tracking number ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        trackingRows: [...current.trackingRows, { shipmentId: null, tracking: '' }],
                      }));
                    }}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600"
                    aria-label="Add tracking number"
                    title="Add tracking number"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Tracking Number
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-500">Serial Numbers</p>
                </div>
                <div className="space-y-2">
                  {(draft.serialRows.length > 0 ? draft.serialRows : ['']).map((row, index) => {
                    const input = (
                      <PasteableDraftInput
                        value={row}
                        onChange={(value) => {
                          setDraft((current) => ({
                            ...current,
                            serialRows: current.serialRows.map((entry, entryIndex) => (
                              entryIndex === index ? value.toUpperCase() : entry
                            )),
                          }));
                        }}
                        onPaste={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (!text.trim()) return;
                            const pasted = text.trim().toUpperCase();
                            setDraft((current) => ({
                              ...current,
                              serialRows: current.serialRows.length > 0
                                ? current.serialRows.map((entry, entryIndex) => (entryIndex === index ? pasted : entry))
                                : [pasted],
                            }));
                          } catch {}
                        }}
                        placeholder={`Serial ${index + 1}`}
                        inputClassName="font-mono"
                        ariaLabel={`Paste serial ${index + 1}`}
                        title="Paste serial"
                      />
                    );

                    if (index === 0) {
                      return (
                        <div key={`serial-${index}`} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">{input}</div>
                          <button
                            type="button"
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                serialRows: current.serialRows.length > 0 ? [...current.serialRows, ''] : [''],
                              }));
                            }}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-600 bg-blue-600 text-white transition-colors hover:border-blue-700 hover:bg-blue-700"
                            aria-label="Add serial number"
                            title="Add serial number"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    }

                    return <div key={`serial-${index}`}>{input}</div>;
                  })}
                </div>
              </div>

              {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving || isSaveSuccess}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving || isSaveSuccess}
                className={`relative min-w-[140px] rounded-xl px-4 py-2 text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 ${
                  isSaveSuccess
                    ? 'bg-emerald-600 hover:bg-emerald-600'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <span className="flex items-center justify-center">
                  {isSaveSuccess ? 'Saved' : isSaving ? 'Saving…' : 'Save Changes'}
                </span>
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 transition-all duration-200 ${
                  isSaveSuccess ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}>
                  <Check className="h-4 w-4" />
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
