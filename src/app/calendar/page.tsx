import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkOrderCalendar } from '@/components/work-orders/calendar/WorkOrderCalendar';

export const metadata: Metadata = {
  title: 'Scheduling Calendar',
};

/**
 * P3-ADM-03 — Scheduling / staff-assignment calendar.
 *
 * A month-view calendar over work_assignments: assignments render on their
 * deadline day, and each can be assigned/reassigned in place through the
 * existing work-order endpoint. Auth/org scoping is enforced server-side by the
 * data route (GET /api/work-orders/calendar, permission work_orders.view).
 */
export default function CalendarPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <Suspense>
        <WorkOrderCalendar />
      </Suspense>
    </main>
  );
}
