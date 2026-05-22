/**
 * /inventory/po-mailbox — scan the dedicated PO mailbox from the inventory area.
 *
 * Reuses the same preview panel mounted on /admin?section=po_mailbox. Eventually
 * this same route will host the "Missing from Zoho" panel; for now it's the
 * dry-run extractor so we can validate against real vendor emails.
 */

import { requirePermission } from '@/lib/auth/page-guard';

export default async function InventoryPoMailboxPage() {
  await requirePermission('admin.view', { enforce: true });

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-gray-700">PO Mailbox</h1>
        <p className="mt-2 text-[13px] text-gray-500">
          Scan, reconcile, and triage purchase-order emails from the sidebar →
        </p>
        <p className="mt-3 text-[12px] text-gray-400">
          The Missing-from-Zoho worklist, scan controls, and mirror status all live in the
          left panel. Future feature: clicking a row will open the email body here.
        </p>
      </div>
    </div>
  );
}
