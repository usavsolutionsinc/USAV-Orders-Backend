'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useLocations } from '@/hooks/useLocations';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';
import { Check, Loader2, MapPin, Printer, Plus, X } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BinLabelPrinterProps {
  isActive: boolean;
}

interface BinLabel {
  barcode: string;
  zone: string;
  row: string;
  col: string;
  name: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BinLabelPrinter({ isActive }: BinLabelPrinterProps) {
  const {
    locations, rooms, roomStructure, roomNames, loading,
    create, creating, createError,
  } = useLocations();

  const [selectedRoom, setSelectedZone] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPrinting, setIsPrinting] = useState(false);

  // Manual entry state
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualRoom, setManualZone] = useState('');
  const [manualRow, setManualRow] = useState('');
  const [manualCol, setManualCol] = useState('');

  // Zone dropdown options
  const roomOptions = useMemo<ViewDropdownOption<string>[]>(() => {
    const opts: ViewDropdownOption<string>[] = [
      { value: '', label: 'Select room…' },
    ];
    for (const z of rooms) {
      opts.push({ value: z.room || z.name, label: z.room || z.name });
    }
    for (const z of roomNames) {
      if (!opts.some((o) => o.value === z)) {
        opts.push({ value: z, label: z });
      }
    }
    return opts;
  }, [rooms, roomNames]);

  // Grid data for selected zone
  const grid = useMemo(() => {
    if (!selectedRoom || !roomStructure[selectedRoom]) return null;
    const { rows } = roomStructure[selectedRoom];
    const rowLabels = Object.keys(rows).sort();
    const allCols = [...new Set(rowLabels.flatMap((r) => rows[r]))].sort();
    return { rowLabels, allCols, rows };
  }, [selectedRoom, roomStructure]);

  // All printable bins for current zone
  const roomBins = useMemo<BinLabel[]>(() => {
    if (!selectedRoom) return [];
    return locations
      .filter((l) => l.room === selectedRoom && l.row_label && l.col_label && l.barcode)
      .map((l) => ({
        barcode: l.barcode!,
        zone: l.room || selectedRoom,
        row: l.row_label!,
        col: l.col_label!,
        name: l.name,
      }));
  }, [selectedRoom, locations]);

  // Toggle helpers
  const toggleBin = useCallback((barcode: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(barcode)) next.delete(barcode);
      else next.add(barcode);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(roomBins.map((b) => b.barcode)));
  }, [roomBins]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleRoomChange = useCallback((z: string) => {
    setSelectedZone(z);
    setSelected(new Set());
  }, []);

  // Manual location creation
  const handleManualCreate = async () => {
    const name = manualName.trim();
    if (!name) return;
    const result = await create({
      name,
      room: manualRoom.trim() || null,
      rowLabel: manualRow.trim() || null,
      colLabel: manualCol.trim() || null,
    });
    if (result) {
      setManualName('');
      setManualZone('');
      setManualRow('');
      setManualCol('');
      setShowManual(false);
      // Auto-select the new bin if it has a barcode
      if (result.barcode) {
        setSelected((prev) => new Set([...prev, result.barcode!]));
      }
    }
  };

  const handleManualKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleManualCreate(); }
  };

  // Bulk print
  const handlePrint = useCallback(() => {
    const bins = roomBins.filter((b) => selected.has(b.barcode));
    if (bins.length === 0) return;

    setIsPrinting(true);

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }

    const labelsHtml = bins.map((bin) => `
      <div class="label">
        <canvas id="bc-${bin.barcode.replace(/[^a-zA-Z0-9]/g, '_')}"></canvas>
        <div class="barcode-text">${bin.barcode}</div>
        <div class="zone">${bin.zone}</div>
        <div class="address">Row ${bin.row} &middot; Col ${bin.col}</div>
        <div class="name">${bin.name}</div>
      </div>
    `).join('');

    const barcodeScripts = bins.map((bin) => {
      const canvasId = `bc-${bin.barcode.replace(/[^a-zA-Z0-9]/g, '_')}`;
      return `JsBarcode("#${canvasId}", "${bin.barcode}", {
        format: "CODE128", lineColor: "#000", width: 2, height: 40, displayValue: false
      });`;
    }).join('\n');

    const html = `
      <html>
        <head>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; }
            .label {
              page-break-inside: avoid;
              border: 1px dashed #ccc;
              padding: 8px 12px;
              margin: 4px;
              display: inline-block;
              width: 280px;
              text-align: center;
              vertical-align: top;
            }
            canvas { display: block; margin: 0 auto 4px; max-width: 100%; }
            .barcode-text { font-size: 14px; font-weight: bold; font-family: monospace; margin: 2px 0; }
            .zone { font-size: 11px; font-weight: bold; color: #333; text-transform: uppercase; letter-spacing: 1px; }
            .address { font-size: 12px; font-weight: bold; color: #555; margin: 2px 0; }
            .name { font-size: 9px; color: #999; }
            @media print {
              .label { border: none; }
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          ${labelsHtml}
          <script>
            window.onload = function() {
              ${barcodeScripts}
              setTimeout(function() { window.print(); window.close(); }, 600);
            };
          <\/script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    setIsPrinting(false);
  }, [roomBins, selected]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-6 bg-white">
        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
        <span className={sectionLabel}>Loading locations…</span>
      </div>
    );
  }

  return (
    <div className={`transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <MapPin className="h-3.5 w-3.5 text-gray-500" />
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Bulk Bin Labels
        </span>
      </div>

      {/* Zone picker + New button */}
      <div className="flex items-stretch border-t border-gray-200">
        <div className="flex-1 min-w-0">
          <ViewDropdown
            options={roomOptions}
            value={selectedRoom}
            onChange={handleRoomChange}
            variant="boxy"
            buttonClassName="h-14 w-full border-b border-gray-400 bg-white px-5 pr-12 text-left text-[13px] font-bold uppercase tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 border-b border-l border-gray-400 transition-colors ${
            showManual ? 'bg-gray-100 text-gray-600' : 'bg-white text-blue-600 hover:bg-blue-50'
          }`}
          title={showManual ? 'Cancel' : 'Add new location'}
        >
          {showManual ? <X className="h-3.5 w-3.5" /> : (
            <><Plus className="h-3.5 w-3.5" /><span className="text-[9px] font-black uppercase tracking-widest">New</span></>
          )}
        </button>
      </div>

      {/* Manual entry form */}
      {showManual && (
        <div className="border-b border-gray-200 bg-blue-50/40 px-5 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={handleManualKeyDown}
              placeholder="Name *"
              autoFocus
              autoComplete="off"
              className="col-span-2 h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
            />
            <input
              type="text"
              value={manualRoom}
              onChange={(e) => setManualZone(e.target.value)}
              onKeyDown={handleManualKeyDown}
              placeholder="Zone"
              autoComplete="off"
              className="h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={manualRow}
                onChange={(e) => setManualRow(e.target.value)}
                onKeyDown={handleManualKeyDown}
                placeholder="Row"
                autoComplete="off"
                className="flex-1 h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
              />
              <input
                type="text"
                value={manualCol}
                onChange={(e) => setManualCol(e.target.value)}
                onKeyDown={handleManualKeyDown}
                placeholder="Col"
                autoComplete="off"
                className="flex-1 h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualCreate}
              disabled={creating || !manualName.trim()}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center gap-1.5"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>Create</span>
            </button>
            <span className="text-[9px] text-gray-400">
              Barcode auto-generated from zone + row + col
            </span>
          </div>
          {createError && (
            <p className="text-[10px] font-bold text-red-600">{createError.message}</p>
          )}
        </div>
      )}

      {/* Grid selection */}
      {grid && (
        <div className="border-b border-gray-200 px-4 py-3">
          {/* Toolbar: select all / none + count */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={sectionLabel}>{selectedRoom}</span>
              <span className="text-[10px] font-bold text-gray-400">
                {selected.size} / {roomBins.length} selected
              </span>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={selectAll}
                className="text-[9px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 px-2 py-1"
              >
                All
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-700 px-2 py-1"
              >
                None
              </button>
            </div>
          </div>

          {/* Row × Col grid */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-10 p-1 text-[9px] font-black text-gray-400 text-center">ROW</th>
                  {grid.allCols.map((col) => (
                    <th key={col} className="p-1 text-[9px] font-black text-gray-400 text-center min-w-[36px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rowLabels.map((row) => (
                  <tr key={row}>
                    <td className="p-1 text-[10px] font-black text-gray-500 text-center">{row}</td>
                    {grid.allCols.map((col) => {
                      const hasCell = grid.rows[row]?.includes(col);
                      const bin = locations.find(
                        (l) => l.room === selectedRoom && l.row_label === row && l.col_label === col,
                      );
                      const binBarcode = bin?.barcode || '';

                      if (!hasCell || !binBarcode) {
                        return <td key={col} className="p-1"><div className="h-8 rounded bg-gray-50" /></td>;
                      }

                      const isSelected = selected.has(binBarcode);

                      return (
                        <td key={col} className="p-1">
                          <button
                            type="button"
                            onClick={() => toggleBin(binBarcode)}
                            className={`h-8 w-full rounded text-[9px] font-black uppercase tracking-wider transition-all ${
                              isSelected
                                ? 'bg-green-600 text-white ring-2 ring-green-300'
                                : 'bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-700'
                            }`}
                            title={binBarcode}
                          >
                            {isSelected ? <Check className="h-3 w-3 mx-auto" /> : `${row}${col}`}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zone-only (no bins) fallback */}
      {selectedRoom && !grid && roomBins.length === 0 && (
        <div className="border-b border-gray-200 px-5 py-4 text-center">
          <p className="text-[10px] font-bold text-gray-400">
            No bins in this zone. Use <span className="text-blue-600">+ New</span> to add locations with row/col.
          </p>
        </div>
      )}

      {/* Print button */}
      {selected.size > 0 && (
        <button
          onClick={handlePrint}
          disabled={isPrinting}
          className={`w-full py-4 bg-green-600 hover:bg-green-700 text-white ${sectionLabel} transition-colors disabled:opacity-40`}
        >
          {isPrinting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              Printing…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Printer className="h-4 w-4" />
              Print {selected.size} Label{selected.size !== 1 ? 's' : ''}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
