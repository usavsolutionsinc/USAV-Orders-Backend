'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { RepairDetailsController } from './useRepairDetailsPanel';
import { RepairRecordSection } from './RepairInfoSections';

/** Notes + audit metadata tab for a repair record. */
export function RepairNotesTab({
  repair,
  c,
}: {
  repair: RSRecord;
  c: RepairDetailsController;
}) {
  return (
    <div className="space-y-6">
      <section>
        <textarea
          value={c.notes}
          onChange={(e) => c.setNotes(e.target.value)}
          onBlur={c.handleSaveNotes}
          className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
          rows={7}
          placeholder="Add notes about this repair..."
          disabled={c.isSaving}
        />
        {c.isSaving ? (
          <p className="text-xs text-gray-500 mt-2">Saving...</p>
        ) : null}
      </section>

      <RepairRecordSection repair={repair} />
    </div>
  );
}
