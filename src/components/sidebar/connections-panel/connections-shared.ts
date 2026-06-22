export type LogStatus = 'success' | 'error' | 'info';

export interface ConnectionLogEntryInput {
  group: string;
  title: string;
  detail: string;
  status: LogStatus;
}

export interface EbayAccount {
  id: number;
  account_name: string;
  token_expires_at: string;
}

export interface AmazonAccountRow {
  id: number;
  account_name: string;
  seller_id: string | null;
  region: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

export function emitConnectionsLog(entry: ConnectionLogEntryInput) {
  window.dispatchEvent(new CustomEvent('admin-connections-log', { detail: entry }));
}
