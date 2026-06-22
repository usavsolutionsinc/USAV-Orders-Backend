import { emitAppEvent } from '@/hooks';
import type { FbaPlanQueueItem } from '@/components/station/upnext/upnext-types';

/** A pending FBA plan card model (alias kept for readability across the sidebar). */
export type PendingPlan = FbaPlanQueueItem;

// Match TechSidebarPanel secondary bands (header-shell uses border-gray-100)
export const sidebarSubBandClass = 'shrink-0 border-b border-gray-100 bg-white';

/** Open the admin "Add FNSKU catalog row" dialog. */
export function emitOpenAddFba(): void {
  emitAppEvent('admin-fba-open-add');
}

/** Open the admin "Upload FNSKU catalog CSV" dialog. */
export function emitOpenUploadFba(): void {
  emitAppEvent('admin-fba-open-upload');
}
