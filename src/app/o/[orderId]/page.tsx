import { redirect } from 'next/navigation';

/**
 * /o/[orderId] — short-URL landing for an order. Redirects to the dashboard
 * with the order pre-selected (Phase 1 stub). Auth gating lives on the
 * dashboard route, not here, so unauthenticated scans still resolve to the
 * sign-in flow naturally.
 */
export default async function OrderScanLandingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const cleaned = decodeURIComponent(orderId || '').trim();
  if (!cleaned) redirect('/dashboard');
  redirect(`/dashboard?orderId=${encodeURIComponent(cleaned)}`);
}
