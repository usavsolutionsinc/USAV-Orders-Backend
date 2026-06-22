import { TimelineSection } from '@/components/ui/TimelineSection';
import { inventoryEventsToTimeline } from '@/lib/timeline';
import type { DetailsResponse } from './incoming-details-shared';

// Internal-handling trail for the PO's receiving lines ("line under PO"):
// receiving + per-unit testing verdicts (TEST_*) + putaway, from inventory_events.
// Distinct from the carrier-event trail in the Shipment tab.
export function ActivityTab({ data }: { data: DetailsResponse }) {
  const items = inventoryEventsToTimeline(data.receive_events ?? []);
  return (
    <TimelineSection
      title="Receiving & testing"
      items={items}
      emptyMessage="No receiving or testing activity yet."
      className=""
    />
  );
}
