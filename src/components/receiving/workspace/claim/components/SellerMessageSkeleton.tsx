import { SkeletonBase } from '@/design-system/components/Skeletons';
import { SELLER_SKELETON_WIDTHS } from '../claim-types';

/** Loading placeholder shown while the AI seller message is being drafted. */
export function SellerMessageSkeleton() {
  return (
    <div className="space-y-2.5 rounded-lg border border-blue-100 bg-white px-3 py-3" aria-hidden>
      {SELLER_SKELETON_WIDTHS.map((width) => (
        <SkeletonBase key={width} width={width} height="0.75rem" />
      ))}
    </div>
  );
}
