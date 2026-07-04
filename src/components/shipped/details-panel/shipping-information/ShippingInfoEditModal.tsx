import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, Trash2, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
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
            className="w-full max-w-2xl rounded-3xl border border-border-soft bg-surface-card shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-hairline px-5 py-4">
              <div>
                <p className="text-micro font-black uppercase tracking-[0.24em] text-text-soft">Shipping Info</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-text-default">Edit Order Details</h3>
              </div>
              <HoverTooltip label="Close shipping editor" asChild>
                <IconButton
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-sunken hover:text-text-muted"
                  ariaLabel="Close shipping editor"
                  icon={<X className="h-4 w-4" />}
                />
              </HoverTooltip>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-micro font-black uppercase tracking-[0.18em] text-text-soft">Ship By Date</span>
                  <input
                    type="text"
                    value={draft.shipByDate}
                    onChange={(e) => setDraft((current) => ({ ...current, shipByDate: e.target.value }))}
                    placeholder="MM-DD-YY"
                    className="h-10 w-full rounded-xl border border-border-soft bg-surface-card px-3 text-sm font-bold text-text-default outline-none transition-colors focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-micro font-black uppercase tracking-[0.18em] text-text-soft">Order ID</span>
                  <input
                    type="text"
                    value={draft.orderNumber}
                    onChange={(e) => setDraft((current) => ({ ...current, orderNumber: e.target.value }))}
                    placeholder="Enter order ID"
                    className="h-10 w-full rounded-xl border border-border-soft bg-surface-card px-3 text-sm font-bold text-text-default outline-none transition-colors focus:border-blue-400"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-micro font-black uppercase tracking-[0.18em] text-text-soft">Tracking Numbers</p>
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
                      <HoverTooltip label={`Delete tracking number ${index + 1}`} asChild>
                        <IconButton
                          onClick={() => {
                            setDraft((current) => {
                              const next = current.trackingRows.filter((_, i) => i !== index);
                              return {
                                ...current,
                                trackingRows: next.length > 0 ? next : [{ shipmentId: null, tracking: '' }],
                              };
                            });
                          }}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-soft hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                          ariaLabel={`Delete tracking number ${index + 1}`}
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </HoverTooltip>
                    </div>
                  ))}
                  <HoverTooltip label="Add tracking number" asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          trackingRows: [...current.trackingRows, { shipmentId: null, tracking: '' }],
                        }));
                      }}
                      icon={<Plus className="h-3.5 w-3.5" />}
                      className="w-full rounded-xl border border-dashed border-border-default text-text-soft hover:border-blue-400 hover:text-blue-600"
                      ariaLabel="Add tracking number"
                    >
                      Add Tracking Number
                    </Button>
                  </HoverTooltip>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-micro font-black uppercase tracking-[0.18em] text-text-soft">Serial Numbers</p>
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
                          <HoverTooltip label="Add serial number" asChild>
                            <IconButton
                              onClick={() => {
                                setDraft((current) => ({
                                  ...current,
                                  serialRows: current.serialRows.length > 0 ? [...current.serialRows, ''] : [''],
                                }));
                              }}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-600 bg-blue-600 transition-colors hover:border-blue-700 hover:bg-blue-700"
                              ariaLabel="Add serial number"
                              icon={<Plus className="h-4 w-4 text-white" />}
                            />
                          </HoverTooltip>
                        </div>
                      );
                    }

                    return <div key={`serial-${index}`}>{input}</div>;
                  })}
                </div>
              </div>

              {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-hairline px-5 py-4">
              <Button
                variant="secondary"
                size="md"
                onClick={onClose}
                disabled={isSaving || isSaveSuccess}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={onSave}
                disabled={isSaving || isSaveSuccess}
                className={`relative min-w-[140px] ${isSaveSuccess ? 'bg-emerald-600 hover:bg-emerald-600' : ''}`}
              >
                <span className="flex items-center justify-center">
                  {isSaveSuccess ? 'Saved' : isSaving ? 'Saving…' : 'Save Changes'}
                </span>
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 transition-all duration-200 ${
                  isSaveSuccess ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}>
                  <Check className="h-4 w-4" />
                </span>
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
