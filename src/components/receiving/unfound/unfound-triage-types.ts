/**
 * Shared shape for an unfound-queue triage row. Extracted into a leaf module so
 * the `useUnfoundTriageDetail` hook and the `UnfoundQueueDetailsPanel` component
 * can both reference it without importing each other (which formed a cycle).
 */
export interface UnfoundQueueDetailsRow {
  kind: 'email_po' | 'unmatched_receiving' | 'station_exception';
  source_id: string;
  organization_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
  zendesk_ticket_id: string | null;
  zendesk_synced_at: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  follow_up_at: string | null;
  checked: boolean;
  checked_at: string | null;
}
