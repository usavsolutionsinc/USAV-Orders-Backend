import { PoChip, getLast4 } from '@/components/ui/CopyChip';
import { type DetailsResponse, fmtDate, fmtDateTime, fmtMoney } from './incoming-details-shared';
import { Row, Empty } from './incoming-details-primitives';

export function PoTab({ data }: { data: DetailsResponse }) {
  const po = data.po;
  if (!po) return <Empty msg="PO not found in zoho_po_mirror yet — wait for the next sync tick." />;
  return (
    <div>
      <Row
        label="PO #"
        value={<PoChip value={po.zoho_purchaseorder_number} display={getLast4(po.zoho_purchaseorder_number)} />}
      />
      <Row label="Status" value={po.status ?? '—'} />
      <Row label="Vendor" value={po.vendor_name ?? '—'} />
      <Row label="Reference #" value={po.reference_number ?? '—'} copyValue={po.reference_number} />
      <Row label="PO Date" value={fmtDate(po.po_date)} />
      <Row label="Expected delivery" value={fmtDate(po.expected_delivery_date)} />
      <Row label="Total" value={fmtMoney(po.total, po.currency)} />
      <Row label="Modified in Zoho" value={fmtDateTime(po.last_modified_zoho)} />
      <Row label="Synced locally" value={fmtDateTime(po.last_synced_at)} />
    </div>
  );
}
