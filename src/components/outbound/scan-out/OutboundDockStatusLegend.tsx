'use client';

import { useQuery } from '@tanstack/react-query';
import { stagedOrdersQuery } from '@/lib/queries/outbound-queries';
import { OUTBOUND_STATE_META } from '@/lib/outbound-state';
import { StatusLegend, type StatusLegendItem } from '@/components/ui/StatusLegend';

const STAGING_ITEMS: StatusLegendItem<'staging'>[] = [
  { state: 'staging', short: 'At dock' },
];

/** Read-only staging count for the Outbound scan-out sidebar. */
export function OutboundDockStatusLegend() {
  const query = useQuery(stagedOrdersQuery());
  const count = query.data?.length ?? 0;

  const meta = {
    staging: {
      label: OUTBOUND_STATE_META.PACKED_STAGED.label,
      description: OUTBOUND_STATE_META.PACKED_STAGED.description,
      pill: OUTBOUND_STATE_META.PACKED_STAGED.pill,
      dot: OUTBOUND_STATE_META.PACKED_STAGED.dot,
    },
  };

  return (
    <StatusLegend
      items={STAGING_ITEMS}
      meta={meta}
      counts={{ staging: count }}
      isFetching={query.isFetching}
      activeState={null}
      onSelectState={() => undefined}
    />
  );
}
