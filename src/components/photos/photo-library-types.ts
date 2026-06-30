/**
 * `LibraryPhoto` — a photo row rendered in the photo library. Extracted into a
 * leaf module so `PhotoLibraryGrid` and the `usePhotoLibrary` hook can reference
 * it without importing `PhotoLibraryPage` (which imports them back, forming a
 * cycle). `PhotoLibraryPage` re-exports it for backwards compatibility.
 */
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';

/** A label chip carried on a library photo (subset of PhotoLabel for rendering). */
export interface LibraryPhotoLabel {
  id: number;
  key: string;
  label: string;
  /** Semantic token name ('blue','rose',…) — resolved to chip classes client-side. */
  color: string | null;
  icon?: string | null;
}

export interface LibraryPhoto {
  id: number;
  photoType: string | null;
  poRef: string | null;
  /** Labels assigned to this photo (many-to-many; one type, many labels). */
  labels?: LibraryPhotoLabel[];
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
  /**
   * Derived source scope (`unboxing` | `local_pickup` | `packing` | `repair` |
   * `claims`) from the photo's entity links — lets the sidebar highlight the
   * image-type a folder's photos belong to even under the "All photos" scope.
   */
  sourceScope?: PhotoLibrarySourceScope | null;
}
