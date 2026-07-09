'use client';

import { useMemo, useState } from 'react';
import { PoLinesSection } from './PoLinesSection';
import { ReceivingSerialJourneys } from './ReceivingSerialJourneys';

export function ReceivingItemsTab({
  receivingId,
  trackingNumber,
  lineCount,
}: {
  receivingId: string;
  trackingNumber?: string;
  lineCount?: number;
}) {
  const hasLines = (lineCount ?? 0) > 0;
  const defaultOpen = !hasLines;
  const [journeysOpen, setJourneysOpen] = useState(defaultOpen);

  const journeysLabel = useMemo(
    () => (journeysOpen ? 'Hide unit journeys' : 'Unit journeys'),
    [journeysOpen],
  );

  return (
    <div className="space-y-4">
      <PoLinesSection receivingId={receivingId} trackingNumber={trackingNumber} />

      <section className="space-y-2">
        {/* ds-raw-button: simple disclosure toggle for the serial journey list (lazy-mount). */}
        <button
          type="button"
          className="ds-raw-button text-left text-eyebrow font-black uppercase tracking-widest text-text-soft hover:text-text-default"
          onClick={() => setJourneysOpen((v) => !v)}
        >
          {journeysLabel}
        </button>
        {journeysOpen ? (
          <ReceivingSerialJourneys receivingId={receivingId} />
        ) : (
          <p className="text-caption font-medium text-text-faint">
            Expand to see per-unit journeys and cross-station history.
          </p>
        )}
      </section>
    </div>
  );
}

