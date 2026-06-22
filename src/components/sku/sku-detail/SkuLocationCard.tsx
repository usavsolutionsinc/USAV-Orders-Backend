import { Check, MapPin, X } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { SkuDetailData } from './sku-detail-types';
import type { SkuDetailController } from './useSkuDetailView';

/** Location card — shows assigned locations, or a room-grouped editor on Change. */
export function SkuLocationCard({ c, data }: { c: SkuDetailController; data: SkuDetailData }) {
  // Group DB locations by room for the dropdown.
  const locationsByRoom = (data.allLocations || []).reduce<Record<string, typeof data.allLocations>>((acc, loc) => {
    const room = loc.room || 'Other';
    if (!acc[room]) acc[room] = [];
    acc[room].push(loc);
    return acc;
  }, {});

  return (
    <div className="rounded-xl bg-white border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className={sectionLabel}>
          <MapPin className="inline h-3 w-3 mr-1" />
          Location
        </h2>
        {!c.editingLocation && (
          <button
            onClick={() => {
              c.setEditingLocation(true);
              c.setSelectedLocation(data.locations[0] || '');
            }}
            className="text-micro font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800"
          >
            Change
          </button>
        )}
      </div>

      {c.editingLocation ? (
        <div className="flex items-center gap-2">
          <select
            value={c.selectedLocation}
            onChange={(e) => c.setSelectedLocation(e.target.value)}
            className="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500"
          >
            <option value="">Select location...</option>
            {Object.entries(locationsByRoom).map(([room, locs]) => (
              <optgroup key={room} label={room}>
                {locs.map((loc) => (
                  <option key={loc.id} value={loc.name}>{loc.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            type="text"
            value={c.selectedLocation}
            onChange={(e) => c.setSelectedLocation(e.target.value)}
            placeholder="Or type custom..."
            className="h-10 w-40 rounded-lg border border-gray-300 px-3 text-sm font-bold focus:border-blue-500"
          />
          <button
            onClick={c.handleLocationSave}
            disabled={c.saving || !c.selectedLocation.trim()}
            className="h-10 px-3 rounded-lg bg-emerald-600 text-white"
            aria-label="Save location"
          >
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => c.setEditingLocation(false)} className="h-10 px-3 rounded-lg bg-gray-200 text-gray-600" aria-label="Cancel">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.locations.length > 0 ? (
            data.locations.map((loc) => (
              <span key={loc} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                <MapPin className="h-3 w-3" />
                {loc}
              </span>
            ))
          ) : (
            <span className="text-xs font-bold text-gray-400">No location set</span>
          )}
        </div>
      )}
    </div>
  );
}
