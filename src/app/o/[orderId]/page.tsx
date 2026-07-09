import { OrderFullPageView } from '@/components/shipped/OrderFullPageView';

/**
 * /o/[orderId] — the full-page, Shopify-style order view: a two-column
 * (main scroll + right rail) display of everything about one order. Reached from
 * the shipped slide-over's magnifier launcher and from scanned short-links.
 *
 * `orderId` is either the numeric DB id (magnifier / detail-stack deep-links) or
 * a human order number (scanned QR/label); {@link OrderFullPageView} resolves
 * both to a full ShippedOrder. Auth is enforced by the data route
 * (`GET /api/orders/[id]` → `orders.view`); an unauthenticated fetch yields the
 * teaching "not found" state rather than leaking the record.
 */
export default async function OrderFullPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderFullPageView orderId={orderId} />;
}
