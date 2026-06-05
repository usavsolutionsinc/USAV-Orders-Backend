/**
 * /receiving/unfound — relocated.
 *
 * The Unfound queue (email-PO / unmatched triage) is no longer a receiving
 * mode; it lives at Admin › PO Mailbox. This route now permanently redirects
 * so old links / bookmarks keep working.
 */

import { redirect } from 'next/navigation';

export default function UnfoundPage() {
  redirect('/admin?section=po_mailbox');
}
