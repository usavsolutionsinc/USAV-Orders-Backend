'use client';

/**
 * Integration showroom for SubstituteUnitCard — the REAL container + hooks
 * (useOrderPickTasks / useOrderAmendments / useSubstituteUnit), with the two GET
 * endpoints + the POST mocked via a scoped fetch override. Proves the
 * pick-tasks → panel → mutate → invalidate wiring without a DB. Isolated route
 * so the fetch shim never touches the app shell's own queries.
 */

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubstituteUnitCard } from '@/components/fulfillment/SubstituteUnitCard';

const ORDER_ID = 99001;

const PICK_TASKS = {
  orderId: ORDER_ID,
  orderLabel: '#A-10472',
  customerInitials: 'JD',
  shipByDate: null,
  tasks: [
    { allocationId: 501, serialUnitId: 1, serialNumber: 'SN-ORD-100', lineId: 1, sku: 'SKU-BLK-200', productTitle: 'Headset (Black)', bin: 'A-12', conditionGrade: 'USED_A', plannedQty: 1, currentState: 'PICKED', platforms: [] },
    { allocationId: 502, serialUnitId: 2, serialNumber: 'SN-ORD-101', lineId: 2, sku: 'SKU-RED-300', productTitle: 'Headset (Red)', bin: 'A-14', conditionGrade: 'USED_B', plannedQty: 1, currentState: 'PICKED', platforms: [] },
  ],
};

const AMENDMENTS = [
  {
    id: 2, created_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(), status: 'PENDING',
    reason_code: 'CUSTOMER_REQUEST', customer_request_note: 'asked for white',
    original_sku: 'SKU-BLK-200', original_condition: 'USED_A', fulfilled_sku: 'SKU-WHT-201', fulfilled_condition: 'USED_A',
    substitute_serial: 'SN-WHT-77001', raised_by_name: 'M. Lee',
  },
];

function makeMock(real: typeof window.fetch): typeof window.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes(`/api/orders/${ORDER_ID}/pick-tasks`)) return json(PICK_TASKS);
    if (url.includes(`/api/orders/${ORDER_ID}/amendments`)) return json({ ok: true, amendments: AMENDMENTS });
    if (url.includes(`/api/orders/${ORDER_ID}/substitute`)) {
      return json({ ok: true, amendmentId: 77, orderId: ORDER_ID, status: 'APPLIED' });
    }
    return real(input, init);
  }) as typeof window.fetch;
}

export default function SubstitutionLiveDemoPage() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  // Install the shim SYNCHRONOUSLY during render (before child query effects
  // fire) and DON'T restore it — a StrictMode effect-cleanup would otherwise
  // restore the real fetch before the later POST, and the mock only intercepts
  // this demo order's endpoints anyway. The route reloads on navigation.
  useState(() => {
    if (typeof window === 'undefined') return null;
    if ((window as unknown as { __subMock?: boolean }).__subMock) return null;
    (window as unknown as { __subMock?: boolean }).__subMock = true;
    window.fetch = makeMock(window.fetch.bind(window));
    return null;
  });

  return (
    <QueryClientProvider client={qc}>
      <div className="min-h-screen bg-surface-canvas p-10" data-testid="substitution-live-demo">
        <h1 className="mb-6 text-eyebrow font-black uppercase tracking-widest text-text-soft">
          SubstituteUnitCard — real container + hooks (mocked API)
        </h1>
        <div className="max-w-xl rounded-xl border border-border-soft bg-surface-card p-4">
          <SubstituteUnitCard orderId={ORDER_ID} orderLabel="#A-10472" />
        </div>
      </div>
    </QueryClientProvider>
  );
}
