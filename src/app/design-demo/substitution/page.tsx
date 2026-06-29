'use client';

/**
 * Isolated showroom for the fulfillment-substitution surfaces — the
 * SubstitutePanel (scan-anchored substitution action) and OrderAmendmentsSection
 * (ordered-vs-fulfilled history via the shared EventTimeline). No DB/auth: pure
 * fixture props + a mock submit handler, so it can be Playwright-screenshotted
 * for visual review (same pattern as /design-demo/id-chips and /photo-peek).
 */

import { useState } from 'react';
import { SubstitutePanel, type SubstitutePayload } from '@/components/fulfillment/SubstitutePanel';
import { OrderAmendmentsSection } from '@/components/fulfillment/OrderAmendmentsSection';
import type { AmendmentTimelineRow } from '@/lib/timeline';

const AMENDMENTS: AmendmentTimelineRow[] = [
  {
    id: 3, created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(), status: 'PENDING',
    reason_code: 'CUSTOMER_REQUEST', customer_request_note: 'customer asked for white',
    original_sku: 'SKU-BLK-200', original_condition: 'USED_A',
    fulfilled_sku: 'SKU-WHT-201', fulfilled_condition: 'USED_A',
    substitute_serial: 'SN-WHT-88421', raised_by_name: 'M. Lee',
  },
  {
    id: 2, created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), status: 'APPLIED',
    reason_code: 'CONDITION_REGRADE', customer_request_note: null,
    original_sku: 'SKU-9', original_condition: 'USED_A',
    fulfilled_sku: 'SKU-9', fulfilled_condition: 'USED_B',
    substitute_serial: 'SN-33019', raised_by_name: 'A. Rivera',
  },
  {
    id: 1, created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), status: 'REJECTED',
    reason_code: 'DAMAGE_FOUND', customer_request_note: 'scuff on lid — supervisor reverted',
    original_sku: 'SKU-7', original_condition: 'USED_B',
    fulfilled_sku: 'SKU-7', fulfilled_condition: 'USED_C',
    substitute_serial: 'SN-55120', raised_by_name: 'M. Lee',
  },
];

export default function SubstitutionDemoPage() {
  const [lastPayload, setLastPayload] = useState<SubstitutePayload | null>(null);
  const [busy, setBusy] = useState(false);

  function handleSubmit(p: SubstitutePayload) {
    setLastPayload(p);
    setBusy(true);
    // Mock the round-trip so the busy state is visible, then settle.
    setTimeout(() => setBusy(false), 900);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10" data-testid="substitution-demo">
      <h1 className="mb-6 text-eyebrow font-black uppercase tracking-widest text-gray-500">
        Fulfillment substitution — panel + amendments timeline
      </h1>

      <div className="grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Advisory panel (live, mock submit) */}
        <div className="space-y-2">
          <p className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">Advisory · interactive</p>
          <SubstitutePanel
            orderLabel="#A-10472"
            original={{ sku: 'SKU-BLK-200', condition: 'USED_A', serial: 'SN-ORD-100' }}
            busy={busy}
            onSubmit={handleSubmit}
          />
          <pre
            data-testid="last-payload"
            className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-caption leading-relaxed text-emerald-300"
          >
            {lastPayload ? JSON.stringify(lastPayload, null, 2) : '// submit to see the payload'}
          </pre>
        </div>

        {/* Block-until-approved + error states + timeline */}
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">Block-until-approved · error</p>
            <SubstitutePanel
              orderLabel="#A-10488"
              original={{ sku: 'SKU-9', condition: 'USED_A', serial: 'SN-ORD-200' }}
              enforcement="block_until_approved"
              error="substitute unit is already allocated"
              onSubmit={() => {}}
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <OrderAmendmentsSection rows={AMENDMENTS} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-2 text-eyebrow font-bold uppercase tracking-widest text-gray-400">Empty state</p>
            <OrderAmendmentsSection rows={[]} />
          </div>
        </div>
      </div>
    </div>
  );
}
