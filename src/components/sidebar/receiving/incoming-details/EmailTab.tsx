import { OrderIdChip } from '@/components/ui/CopyChip';
import { type DetailsResponse, fmtDateTime } from './incoming-details-shared';
import { Empty } from './incoming-details-primitives';

// Simplified delivery view: just the email(s). An "ORDER DELIVERED" email
// (eBay) is the delivery signal for the email-driven Delivered · not scanned
// surface; this tab shows the raw email so the operator can eyeball it. Falls
// back to any PO-mailbox worklist emails when there's no delivery signal yet.
export function EmailTab({ data }: { data: DetailsResponse }) {
  const delivered = data.delivered_emails ?? [];
  const worklist = data.gmail ?? [];

  if (delivered.length === 0 && worklist.length === 0) {
    return <Empty msg="No PO-mailbox email matched this order yet." />;
  }

  return (
    <div className="space-y-2">
      {delivered.map((e) => (
        <div key={`d-${e.gmail_msg_id}`} className="border-l-2 border-rose-400 pl-3">
          {/* Order # copy chip — one identifier covers both the order and its
              return (same order ID), so a single chip is all the operator needs. */}
          <div className="flex items-center gap-2">
            <OrderIdChip value={e.order_number} display={e.order_number} dense />
            <span className="ml-auto whitespace-nowrap text-eyebrow font-semibold text-rose-700">
              Delivered · {fmtDateTime(e.delivered_at)}
            </span>
          </div>
          {e.email_subject ? (
            <div className="mt-1 text-label font-bold text-gray-900">{e.email_subject}</div>
          ) : null}
          {e.snippet ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-caption leading-relaxed text-gray-600">{e.snippet}</p>
          ) : null}
        </div>
      ))}

      {worklist.length > 0 ? (
        <div className="space-y-2 pt-1">
          {delivered.length > 0 ? (
            <div className="text-eyebrow font-black uppercase tracking-wide text-gray-400">PO mailbox</div>
          ) : null}
          {worklist.map((e) => (
            <div key={`w-${e.gmail_msg_id}`} className="border-l-2 border-gray-200 pl-3">
              <div className="flex items-center gap-2">
                {e.status ? (
                  <span className="text-eyebrow font-bold uppercase tracking-wide text-gray-500">{e.status}</span>
                ) : null}
                <span className="ml-auto whitespace-nowrap text-eyebrow font-semibold text-gray-400">
                  {fmtDateTime(e.email_received)}
                </span>
              </div>
              {e.email_subject ? (
                <div className="mt-0.5 text-label font-bold text-gray-900">{e.email_subject}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
