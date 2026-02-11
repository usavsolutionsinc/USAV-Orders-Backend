'use client';

import { ShippedDetailsPanelContent } from '../ShippedDetailsPanelContent';
import { DetailsStackProps } from './types';

export function PackerDetailsStack(props: DetailsStackProps) {
  return <ShippedDetailsPanelContent {...props} />;
}
