'use client';

const STATUS_MAP: Record<string, { label: string; colorVar: string }> = {
  active: { label: 'Active', colorVar: '--color-status-active' },
  inactive: { label: 'Inactive', colorVar: '--color-status-inactive' },
  confirmed: { label: 'Confirmed', colorVar: '--color-status-confirmed' },
  shipped: { label: 'Shipped', colorVar: '--color-status-shipped' },
  delivered: { label: 'Delivered', colorVar: '--color-status-delivered' },
  invoiced: { label: 'Invoiced', colorVar: '--color-status-invoiced' },
  paid: { label: 'Paid', colorVar: '--color-status-paid' },
  overdue: { label: 'Overdue', colorVar: '--color-status-overdue' },
  void: { label: 'Void', colorVar: '--color-status-void' },
  draft: { label: 'Draft', colorVar: '--color-status-draft' },
  out_of_stock: { label: 'Out of Stock', colorVar: '--color-status-out-of-stock' },
  low_stock: { label: 'Low Stock', colorVar: '--color-status-low-stock' },
  pending: { label: 'Pending', colorVar: '--color-status-draft' },
  matched: { label: 'Matched', colorVar: '--color-status-confirmed' },
  arrived: { label: 'Arrived', colorVar: '--color-info' },
  hold: { label: 'Hold', colorVar: '--color-warning' },
  accept: { label: 'Accept', colorVar: '--color-success' },
  rtv: { label: 'RTV', colorVar: '--color-warning' },
  scrap: { label: 'Scrap', colorVar: '--color-error' },
  rework: { label: 'Rework', colorVar: '--color-info' },
  passed: { label: 'Passed', colorVar: '--color-success' },
  failed: { label: 'Failed', colorVar: '--color-error' },
  failed_damaged: { label: 'Failed Damaged', colorVar: '--color-error' },
  failed_incomplete: { label: 'Failed Incomplete', colorVar: '--color-warning' },
  purchase_order: { label: 'PO Sync', colorVar: '--color-status-confirmed' },
  purchase_receive: { label: 'Receive Sync', colorVar: '--color-status-invoiced' },
  sync_delayed: { label: 'Sync Delayed', colorVar: '--color-warning' },
};

function formatStatusLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusBadge({
  status,
  label,
  className = '',
}: {
  status: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const normalized = String(status || '').trim().toLowerCase();
  const config = STATUS_MAP[normalized] ?? {
    label: label || formatStatusLabel(normalized || 'Unknown'),
    colorVar: '--color-neutral-700',
  };

  return (
    <span
      className={`inline-flex items-center py-0.5 text-[10px] font-semibold tracking-[0.02em] ${className}`.trim()}
      style={{
        color: `var(${config.colorVar})`,
        boxShadow: `inset 0 -1px 0 color-mix(in srgb, var(${config.colorVar}) 25%, transparent)`,
      }}
    >
      {label || config.label}
    </span>
  );
}
