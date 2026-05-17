import { redirect } from 'next/navigation';

/**
 * Legacy deep link `/tech/[id]` — the `[id]` no longer overrides the active
 * operator (Phase D of the global-identity migration). We just forward to
 * `/tech`; whoever is signed in stays signed in. If you want to view another
 * tech's queue, use the FAB → Switch staff.
 */
export default async function TechIdPage() {
  redirect('/tech');
}
