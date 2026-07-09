import { ReceivingSurfacePage } from '@/components/receiving/ReceivingSurfacePage';

/**
 * `/receiving` — the legacy receiving page. Renders the shared receiving
 * surface shell; the Unbox mode now has its own first-class route (`/unbox`),
 * but `/receiving` (bare and `?mode=…`) keeps working as the back-compat alias
 * during the Studio-driven operator-surfaces migration.
 */
export default function ReceivingPage() {
  return <ReceivingSurfacePage mobileTitle="Receiving" />;
}
