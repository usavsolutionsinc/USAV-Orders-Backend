import type { StationScanType } from '@/lib/station-scan-routing';

// ─── Shared types ──────────────────────────────────────────────────────────

export interface ActivePackingOrder {
  orderId: string;
  productTitle: string;
  qty: number;
  condition: string;
  tracking: string;
  sku?: string;
  itemNumber?: string;
  shipByDate?: string;
  createdAt?: string;
}

export interface ActiveFbaScan {
  fnsku: string;
  productTitle: string;
  shipmentRef: string | null;
  plannedQty: number;
  combinedPackScannedQty: number;
  isNew: boolean;
}

export interface CapturedPhoto {
  previewUrl: string;
  blobUrl: string;
  photoId: number | null;
  index: number;
}

// ─── Wizard state machine ──────────────────────────────────────────────────

export type PackingWizardStep = 'scan' | 'lookup' | 'confirm' | 'photos' | 'review' | 'success';

export type OrderVariant = 'order' | 'fba' | 'repair' | 'exception';

export interface PackingWizardState {
  step: PackingWizardStep;
  scannedValue: string | null;
  scannedType: StationScanType | null;
  resolvedOrder: ActivePackingOrder | null;
  resolvedFba: ActiveFbaScan | null;
  orderVariant: OrderVariant;
  packerLogId: number | null;
  resolvedScanType: string | null;
  capturedPhotos: CapturedPhoto[];
  isLoading: boolean;
  errorMessage: string | null;
}

export type WizardAction =
  | { type: 'SCAN_CONFIRMED'; value: string; scanType: StationScanType }
  | { type: 'LOOKUP_START' }
  | { type: 'LOOKUP_ORDER_FOUND'; order: ActivePackingOrder; packerLogId: number | null; resolvedScanType: string; variant: OrderVariant }
  | { type: 'LOOKUP_FBA_FOUND'; fba: ActiveFbaScan; packerLogId: number | null }
  | { type: 'LOOKUP_EXCEPTION'; order: ActivePackingOrder; packerLogId: number | null }
  | { type: 'LOOKUP_ERROR'; message: string }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_NO' }
  | { type: 'PHOTO_ADDED'; photo: CapturedPhoto }
  | { type: 'PHOTO_REMOVED'; index: number }
  | { type: 'PHOTOS_DONE' }
  | { type: 'PHOTOS_SKIP' }
  | { type: 'COMPLETE_START' }
  | { type: 'COMPLETE_SUCCESS' }
  | { type: 'COMPLETE_ERROR'; message: string }
  | { type: 'BACK' }
  | { type: 'RESET' };

export const initialWizardState: PackingWizardState = {
  step: 'scan',
  scannedValue: null,
  scannedType: null,
  resolvedOrder: null,
  resolvedFba: null,
  orderVariant: 'order',
  packerLogId: null,
  resolvedScanType: null,
  capturedPhotos: [],
  isLoading: false,
  errorMessage: null,
};

export function wizardReducer(state: PackingWizardState, action: WizardAction): PackingWizardState {
  switch (action.type) {
    case 'SCAN_CONFIRMED':
      return {
        ...initialWizardState,
        step: 'lookup',
        scannedValue: action.value,
        scannedType: action.scanType,
        isLoading: true,
      };
    case 'LOOKUP_START':
      return { ...state, isLoading: true, errorMessage: null };
    case 'LOOKUP_ORDER_FOUND':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedOrder: action.order,
        resolvedFba: null,
        packerLogId: action.packerLogId,
        resolvedScanType: action.resolvedScanType,
        orderVariant: action.variant,
      };
    case 'LOOKUP_FBA_FOUND':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedFba: action.fba,
        resolvedOrder: null,
        packerLogId: action.packerLogId,
        resolvedScanType: 'FBA',
        orderVariant: 'fba',
      };
    case 'LOOKUP_EXCEPTION':
      return {
        ...state,
        step: 'confirm',
        isLoading: false,
        resolvedOrder: action.order,
        resolvedFba: null,
        packerLogId: action.packerLogId,
        resolvedScanType: 'ORDERS',
        orderVariant: 'exception',
      };
    case 'LOOKUP_ERROR':
      return { ...state, step: 'scan', isLoading: false, errorMessage: action.message };
    case 'CONFIRM_YES':
      return { ...state, step: 'photos', capturedPhotos: [] };
    case 'CONFIRM_NO':
      return { ...initialWizardState };
    case 'PHOTO_ADDED':
      return { ...state, capturedPhotos: [...state.capturedPhotos, action.photo] };
    case 'PHOTO_REMOVED':
      return { ...state, capturedPhotos: state.capturedPhotos.filter((_, i) => i !== action.index) };
    case 'PHOTOS_DONE':
    case 'PHOTOS_SKIP':
      return { ...state, step: 'review' };
    case 'COMPLETE_START':
      return { ...state, isLoading: true, errorMessage: null };
    case 'COMPLETE_SUCCESS':
      return { ...state, step: 'success', isLoading: false };
    case 'COMPLETE_ERROR':
      return { ...state, isLoading: false, errorMessage: action.message };
    case 'BACK': {
      const backMap: Record<PackingWizardStep, PackingWizardStep> = {
        scan: 'scan',
        lookup: 'scan',
        confirm: 'scan',
        photos: 'confirm',
        review: 'photos',
        success: 'scan',
      };
      return { ...state, step: backMap[state.step], errorMessage: null };
    }
    case 'RESET':
      return { ...initialWizardState };
    default:
      return state;
  }
}
