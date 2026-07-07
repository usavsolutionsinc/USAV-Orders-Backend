/**
 * Zendesk attachment helpers — turn library photos (and ad-hoc dropped files)
 * into real Zendesk ticket attachments, and link library photos to the ticket
 * entity so they also surface in the support detail strip + claims scope.
 *
 * Shared by POST /api/zendesk/photo-ticket (the photo→ticket modal) and the
 * support chat composer. Every helper is best-effort per item: one unreadable
 * photo never blocks the rest — it just reduces the attached count.
 */
import { uploadFileToZendesk } from './zendesk';
import { readPhotoBytesById } from './photos/read-bytes';
import { linkPhoto } from './photos/service';

export interface ZendeskUploadResult {
  /** Upload tokens to pass as `comment.uploads` on create / addTicketComment. */
  tokens: string[];
  attached: number;
  failed: number;
}

const EMPTY: ZendeskUploadResult = { tokens: [], attached: 0, failed: 0 };

/**
 * Read each library photo's bytes (GCS primary → NAS mirror → legacy) and upload
 * them to Zendesk's Uploads API, returning the attachment tokens.
 */
export async function uploadLibraryPhotosToZendesk(
  organizationId: string,
  photoIds: number[],
): Promise<ZendeskUploadResult> {
  if (photoIds.length === 0) return EMPTY;
  const tokens: string[] = [];
  let failed = 0;
  for (const id of photoIds) {
    try {
      const pb = await readPhotoBytesById(id, organizationId);
      if (!pb) {
        failed++;
        continue;
      }
      tokens.push(await uploadFileToZendesk(pb.filename, pb.bytes, pb.contentType, organizationId));
    } catch (err) {
      console.warn('[zendesk-attachments] library photo upload failed', id, err);
      failed++;
    }
  }
  return { tokens, attached: tokens.length, failed };
}

export interface RawAttachment {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}

/** Upload ad-hoc files (e.g. drag-dropped into the modal) to Zendesk's Uploads API. */
export async function uploadRawFilesToZendesk(
  files: RawAttachment[],
  organizationId?: string,
): Promise<ZendeskUploadResult> {
  if (files.length === 0) return EMPTY;
  const tokens: string[] = [];
  let failed = 0;
  for (const file of files) {
    try {
      tokens.push(
        await uploadFileToZendesk(
          file.filename || 'attachment',
          file.bytes,
          file.contentType || 'application/octet-stream',
          organizationId,
        ),
      );
    } catch (err) {
      console.warn('[zendesk-attachments] raw file upload failed', file.filename, err);
      failed++;
    }
  }
  return { tokens, attached: tokens.length, failed };
}

/**
 * Link library photos to the ZENDESK_TICKET entity so they appear in the support
 * detail's "linked photos" strip and the photo library's claims scope (which
 * reads photo_entity_links where entity_type = 'ZENDESK_TICKET'). Best-effort.
 */
export async function linkLibraryPhotosToTicket(
  organizationId: string,
  ticketId: number,
  photoIds: number[],
): Promise<void> {
  for (const id of photoIds) {
    try {
      await linkPhoto({
        organizationId,
        photoId: id,
        entityType: 'ZENDESK_TICKET',
        entityId: ticketId,
        linkRole: 'claim_evidence',
      });
    } catch (err) {
      console.warn('[zendesk-attachments] linkPhoto failed', id, err);
    }
  }
}

export function mergeUploadResults(...results: ZendeskUploadResult[]): ZendeskUploadResult {
  return results.reduce(
    (acc, r) => ({
      tokens: [...acc.tokens, ...r.tokens],
      attached: acc.attached + r.attached,
      failed: acc.failed + r.failed,
    }),
    EMPTY,
  );
}
