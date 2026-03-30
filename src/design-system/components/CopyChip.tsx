/**
 * Re-export CopyChip family from the canonical source.
 *
 * Wrap the app (or subtree) with `SiteTooltipProvider` so copy chips (and future
 * anchors) share one hover tooltip (bubble anchored to anchor center; caret follows the pointer).
 *
 * Hard rule: chip variants are semantically bound to data types:
 * - TrackingChip  → Blue  (carrier shipping tracking)
 * - FnskuChip     → Purple (Amazon FNSKU)
 * - SerialChip    → Emerald (device serial numbers)
 * - OrderIdChip   → Gray (internal order IDs)
 * - TicketChip    → Orange (repair/support ticket IDs)
 * - SourceOrderChip → Gray (external platform order numbers)
 *
 * Never interchange chip variants across data types.
 */
export {
  CopyChip,
  TrackingChip,
  FnskuChip,
  SerialChip,
  OrderIdChip,
  TicketChip,
  SourceOrderChip,
  PlatformChip,
  HashIcon,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';

export type { CopyChipProps } from '@/components/ui/CopyChip';

export { SiteTooltipProvider, useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';
export type { SiteTooltipContextValue } from '@/components/providers/SiteTooltipProvider';
