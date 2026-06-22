/**
 * `LibraryPhoto` — a photo row rendered in the photo library. Extracted into a
 * leaf module so `PhotoLibraryGrid` and the `usePhotoLibrary` hook can reference
 * it without importing `PhotoLibraryPage` (which imports them back, forming a
 * cycle). `PhotoLibraryPage` re-exports it for backwards compatibility.
 */
export interface LibraryPhoto {
  id: number;
  photoType: string | null;
  poRef: string | null;
  /** Linked Zendesk ticket id (claims scope), surfaced for folder grouping/labels. */
  ticketId?: number | null;
  takenByStaffId?: number | null;
  /** Resolved name of the uploader (joined from `staff`), for the viewer panel. */
  takenByStaffName?: string | null;
  createdAt: string;
  displayUrl: string;
  thumbUrl: string;
  damageDetected?: boolean | null;
  hasAnalysis?: boolean | null;
  caption?: string | null;
}
