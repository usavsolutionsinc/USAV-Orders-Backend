export interface TransferOrderDetail {
  orderId: string;
  productTitle: string;
  sku: string;
  itemNumber: string;
  tracking: string;
  titleSource: 'sheet' | 'sku_catalog' | 'platform_lookup' | 'none';
}

export interface TransferOrderDetails {
  inserted: TransferOrderDetail[];
  updated: TransferOrderDetail[];
  deleted: TransferOrderDetail[];
  unknownTitle: TransferOrderDetail[];
}

export interface OrderExceptionResolutionDetail {
  exceptionId: number;
  tracking: string;
  matchedOrderId?: number;
  sourceStation?: string | null;
}

export type SyncTaskStatus = 'idle' | 'running' | 'done' | 'error';

export interface TransferTabState {
  status: SyncTaskStatus;
  summary?: string;
  details?: TransferOrderDetails | null;
  error?: string;
  tabName?: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  processedRows?: number;
}

export interface ExceptionsTabState {
  status: SyncTaskStatus;
  summary?: string;
  resolved?: OrderExceptionResolutionDetail[];
  stillOpen?: OrderExceptionResolutionDetail[];
  scanned?: number;
  matched?: number;
  error?: string;
}
