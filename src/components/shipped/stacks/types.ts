import { ShippedOrder } from '@/lib/neon/orders-queries';

export interface DetailsStackDurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

export interface DetailsStackProps {
  shipped: ShippedOrder;
  durationData: DetailsStackDurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showShippingTimestamp?: boolean;
  mode?: 'dashboard' | 'tech';
}
