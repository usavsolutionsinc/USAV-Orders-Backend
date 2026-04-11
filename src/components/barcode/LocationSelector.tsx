'use client';

import { useMemo, useState } from 'react';
import { useLocations } from '@/hooks/useLocations';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';
import { Plus, Check, X, MapPin, Loader2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LocationSelectorProps {
  value: string;
  currentLocation?: string;
  onChange: (value: string) => void;
  /** Compact = single dropdown for optional field. Full = zone + grid picker. */
  compact?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LocationSelector({
  value,
  currentLocation,
  onChange,
  compact = false,
}: LocationSelectorProps) {
  const {
    locations, rooms, roomStructure, roomNames,
    loading, create, creating, createError,
  } = useLocations();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRoom, setNewZone] = useState('');

  // Cascading state for grid picker (full mode)
  const [selectedRoom, setSelectedZone] = useState('');

  // Build zone-level dropdown options
  const roomOptions = useMemo<ViewDropdownOption<string>[]>(() => {
    const opts: ViewDropdownOption<string>[] = [
      { value: '', label: 'Select room…' },
    ];
    for (const z of rooms) {
      opts.push({ value: z.room || z.name, label: z.room || z.name });
    }
    // Add zones that only exist as bin parents (have bins but no dedicated zone row)
    for (const z of roomNames) {
      if (!opts.some((o) => o.value === z)) {
        opts.push({ value: z, label: z });
      }
    }
    return opts;
  }, [rooms, roomNames]);

  // Flat dropdown for compact mode
  const flatOptions = useMemo<ViewDropdownOption<string>[]>(() => {
    const opts: ViewDropdownOption<string>[] = [
      { value: '', label: 'Location (optional)' },
    ];
    // Zone-level locations first
    for (const loc of rooms) {
      const isCurrent = loc.name === currentLocation;
      opts.push({
        value: loc.name,
        label: `${loc.name}${isCurrent ? ' (current)' : ''}`,
      });
    }
    // Then bins with full address
    for (const loc of locations) {
      if (!loc.row_label || !loc.col_label) continue;
      const isCurrent = loc.barcode === currentLocation || loc.name === currentLocation;
      opts.push({
        value: loc.barcode || loc.name,
        label: `${loc.room} › Row ${loc.row_label} Col ${loc.col_label}${isCurrent ? ' (current)' : ''}`,
      });
    }
    return opts;
  }, [locations, rooms, currentLocation]);

  // Grid data for selected zone
  const grid = useMemo(() => {
    if (!selectedRoom || !roomStructure[selectedRoom]) return null;
    const { rows } = roomStructure[selectedRoom];
    const rowLabels = Object.keys(rows).sort();
    // All unique cols across rows
    const allCols = [...new Set(rowLabels.flatMap((r) => rows[r]))].sort();
    return { rowLabels, allCols, rows };
  }, [selectedRoom, roomStructure]);

  const handleGridSelect = (row: string, col: string) => {
    // Find the bin barcode for this zone+row+col
    const bin = locations.find(
      (l) => l.room === selectedRoom && l.row_label === row && l.col_label === col,
    );
    if (bin) {
      onChange(bin.barcode || bin.name);
    }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const result = await create({ name, room: newRoom.trim() || null });
    if (result) {
      onChange(result.barcode || result.name);
      setNewName('');
      setNewZone('');
      setShowAdd(false);
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${compact ? 'px-5 py-3' : 'px-5 py-4'} bg-white`}>
        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
        <span className={sectionLabel}>Loading locations…</span>
      </div>
    );
  }

  // ── Compact mode: single flat dropdown ──
  if (compact) {
    return (
      <div className="bg-white">
        <div className="flex items-stretch">
          <div className="flex-1 min-w-0">
            <ViewDropdown
              options={flatOptions}
              value={value}
              onChange={onChange}
              variant="boxy"
              buttonClassName="h-12 w-full border-b border-gray-200 bg-white px-5 pr-12 text-left text-[10px] font-black uppercase tracking-widest text-gray-900 outline-none transition-colors hover:bg-gray-50"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 border-b border-l border-gray-200 transition-colors ${
              showAdd ? 'bg-gray-100 text-gray-600' : 'bg-white text-blue-600 hover:bg-blue-50'
            }`}
            title={showAdd ? 'Cancel' : 'Add new location'}
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : (
              <><Plus className="h-3.5 w-3.5" /><span className="text-[9px] font-black uppercase tracking-widest">New</span></>
            )}
          </button>
        </div>
        {showAdd && <AddForm {...{ newName, setNewName, newRoom, setNewZone, handleAdd, handleAddKeyDown, creating, createError }} />}
      </div>
    );
  }

  // ── Full mode: current badge + zone picker + row×col grid ──
  return (
    <div className="bg-white">
      {/* Current location badge */}
      {currentLocation && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 border-b border-gray-200">
          <MapPin className="h-3 w-3 text-orange-500" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Current:</span>
          <span className="text-xs font-black font-mono text-orange-600">{currentLocation}</span>
        </div>
      )}

      {/* Zone picker */}
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0">
          <ViewDropdown
            options={roomOptions}
            value={selectedRoom}
            onChange={(z) => { setSelectedZone(z); if (!z) onChange(''); }}
            variant="boxy"
            buttonClassName="h-14 w-full border-b border-gray-400 bg-white px-5 pr-12 text-left text-[13px] font-bold uppercase tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 border-b border-l border-gray-400 transition-colors ${
            showAdd ? 'bg-gray-100 text-gray-600' : 'bg-white text-blue-600 hover:bg-blue-50'
          }`}
          title={showAdd ? 'Cancel' : 'Add new location'}
        >
          {showAdd ? <X className="h-3.5 w-3.5" /> : (
            <><Plus className="h-3.5 w-3.5" /><span className="text-[9px] font-black uppercase tracking-widest">New</span></>
          )}
        </button>
      </div>

      {/* Row × Col grid */}
      {grid && (
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={sectionLabel}>Select Bin — {selectedRoom}</span>
            {value && (
              <span className="text-[10px] font-black font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                {value}
              </span>
            )}
          </div>

          {/* Grid header: col labels */}
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
                      const binBarcode = bin?.barcode || bin?.name || '';
                      const isSelected = value === binBarcode;
                      const isCurrent = binBarcode === currentLocation;

                      if (!hasCell) {
                        return <td key={col} className="p-1"><div className="h-8 rounded bg-gray-50" /></td>;
                      }

                      return (
                        <td key={col} className="p-1">
                          <button
                            type="button"
                            onClick={() => handleGridSelect(row, col)}
                            className={`h-8 w-full rounded text-[9px] font-black uppercase tracking-wider transition-all ${
                              isSelected
                                ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                                : isCurrent
                                  ? 'bg-orange-100 text-orange-700 border border-orange-300'
                                  : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700'
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

      {/* If zone selected but no grid (zone-only location), select it directly */}
      {selectedRoom && !grid && (
        <div className="border-b border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              const rm = rooms.find((z) => z.room === selectedRoom || z.name === selectedRoom);
              onChange(rm?.name || selectedRoom);
            }}
            className={`w-full h-10 rounded-lg text-sm font-bold transition-colors ${
              value === selectedRoom
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-blue-50'
            }`}
          >
            {value === selectedRoom ? '✓ Selected' : `Select "${selectedRoom}"`}
          </button>
        </div>
      )}

      {showAdd && <AddForm {...{ newName, setNewName, newRoom, setNewZone, handleAdd, handleAddKeyDown, creating, createError }} />}
    </div>
  );
}

// ─── Add Form (shared between compact/full) ────────────────────────────────

function AddForm({
  newName, setNewName, newRoom, setNewZone,
  handleAdd, handleAddKeyDown, creating, createError,
}: {
  newName: string; setNewName: (v: string) => void;
  newRoom: string; setNewZone: (v: string) => void;
  handleAdd: () => void; handleAddKeyDown: (e: React.KeyboardEvent) => void;
  creating: boolean; createError: Error | null;
}) {
  return (
    <div className="border-b border-gray-200 bg-blue-50/40 px-5 py-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Location name *"
          autoFocus
          autoComplete="off"
          className="flex-1 h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
        />
        <input
          type="text"
          value={newRoom}
          onChange={(e) => setNewZone(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Room (optional)"
          autoComplete="off"
          className="w-32 h-9 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={creating || !newName.trim()}
          className="h-9 px-3 rounded-lg bg-blue-600 text-white disabled:opacity-40 flex items-center gap-1"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
      </div>
      {createError && (
        <p className="text-[10px] font-bold text-red-600">{createError.message}</p>
      )}
    </div>
  );
}
