import { Clipboard, Copy, Pencil, Plus, X } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { InlineSaveIndicator } from '@/design-system/components';
import { useSerialRowEditor } from './hooks/useSerialRowEditor';

export function ShippingSerialNumberRow({
  rowId,
  trackingNumber,
  serialNumber,
  techId,
  fnskuLogId,
  salId,
  onUpdate,
  allowEdit = true,
}: {
  rowId: number;
  trackingNumber: string | null | undefined;
  serialNumber: string | null | undefined;
  techId?: number | null;
  fnskuLogId?: number | null;
  salId?: number | null;
  onUpdate?: () => void;
  allowEdit?: boolean;
}) {
  const {
    serialRows,
    normalizedRows,
    normalizedSerialNumber,
    isEditing,
    error,
    saveState,
    addRow,
    commitAndClose,
    startEditingFromPencil,
    startEditingFromDisplay,
    startEditingFromEmptyPaste,
    updateRow,
    pasteRow,
    copyAllSerials,
  } = useSerialRowEditor({ rowId, trackingNumber, serialNumber, techId, fnskuLogId, salId, onUpdate });

  return (
    <DetailsPanelRow
      label="Serial Number"
      dividerClassName="border-b border-gray-100"
      className="!border-b !border-gray-100"
      actions={(
        <div className="flex items-center gap-1.5 text-gray-400">
          <InlineSaveIndicator state={saveState} />
          {allowEdit && isEditing ? (
            <>
              <button
                type="button"
                onClick={addRow}
                className="transition-all hover:text-blue-700"
                aria-label="Add serial row"
                title="Add serial row"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { void commitAndClose(); }}
                className="transition-all hover:text-red-600"
                aria-label="Close serial editing"
                title="Close serial editing"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : allowEdit ? (
            <button
              type="button"
              onClick={startEditingFromPencil}
              className="transition-all hover:text-gray-900"
              aria-label="Edit serial numbers"
              title="Edit serial numbers"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={copyAllSerials}
            disabled={!normalizedSerialNumber}
            className="transition-all hover:text-gray-900 disabled:opacity-40"
            aria-label="Copy all serial numbers"
            title="Copy all serial numbers"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    >
      {allowEdit && isEditing ? (
        <div>
          {serialRows.map((serial, index) => (
            <div key={index} className="flex items-center gap-2 border-b border-gray-100 last:border-b-0">
              <input
                type="text"
                value={serial}
                onChange={(e) => updateRow(index, e.target.value)}
                placeholder={`Serial ${index + 1} · or SKU:tag`}
                className="flex-1 border-0 bg-transparent px-0 py-1.5 text-sm font-mono font-bold text-gray-900 outline-none focus:ring-0 placeholder:font-dm-sans placeholder:font-normal placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => { void pasteRow(index); }}
                className="shrink-0 text-gray-400 transition-colors hover:text-blue-600"
                aria-label={`Paste serial ${index + 1} from clipboard`}
                title="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : allowEdit ? (
        <button
          type="button"
          onClick={startEditingFromDisplay}
          className="block w-full text-left"
        >
          {normalizedRows.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {normalizedRows.map((serial, idx) => (
                <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 py-1">
              <p className="text-sm font-dm-sans font-normal text-gray-400">No serials — click to add</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void startEditingFromEmptyPaste();
                }}
                className="shrink-0 text-gray-400 transition-colors hover:text-blue-600"
                aria-label="Paste serial from clipboard"
                title="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </button>
      ) : (
        normalizedRows.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {normalizedRows.map((serial, idx) => (
              <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
            ))}
          </div>
        ) : (
          <p className="py-0.5 text-sm font-dm-sans font-normal text-gray-400">No serials</p>
        )
      )}

      {error ? (
        <p className="pt-1 text-micro font-bold text-red-600">{error}</p>
      ) : saveState === 'saved' ? (
        <p className="pt-1 text-micro font-bold text-emerald-600">Serial numbers saved.</p>
      ) : null}
    </DetailsPanelRow>
  );
}
