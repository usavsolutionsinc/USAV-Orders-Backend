import { normalizeIdentifier } from '@/lib/product-manuals';

export interface ManualServerFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface ManualServerByItemResponse {
  itemNumber: string;
  folderPath: string;
  manuals: ManualServerFile[];
}

export interface ManualServerUnassignedResponse {
  folderPath: string;
  manuals: ManualServerFile[];
}

export interface ManualServerAssignedItem {
  itemNumber: string;
  folderPath: string;
  manualCount: number;
  manuals: ManualServerFile[];
}

export interface ManualServerAssignedItemsResponse {
  items: ManualServerAssignedItem[];
}

function getManualServerConfig() {
  const baseUrl = String(
    process.env.MANUAL_SERVER_URL
      || process.env.PRINT_SERVER_URL
      || process.env.GGD_MANUAL_SERVER_URL
      || '',
  ).trim().replace(/\/+$/, '');
  const apiKey = String(
    process.env.MANUAL_SERVER_API_KEY
      || process.env.PRINT_SERVER_API_KEY
      || process.env.GGD_MANUAL_SERVER_API_KEY
      || '',
  ).trim();

  return { baseUrl, apiKey };
}

export function isManualServerConfigured() {
  const { baseUrl, apiKey } = getManualServerConfig();
  return Boolean(baseUrl && apiKey);
}

function getRequiredManualServerConfig() {
  const config = getManualServerConfig();
  if (!config.baseUrl) {
    throw new Error('MANUAL_SERVER_URL is not configured');
  }
  if (!config.apiKey) {
    throw new Error('MANUAL_SERVER_API_KEY is not configured');
  }
  return config;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function manualServerRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const { baseUrl, apiKey } = getRequiredManualServerConfig();
  const headers = new Headers(init?.headers || {});
  headers.set('x-api-key', apiKey);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(String((data as any)?.error || `Manual server request failed (${response.status})`));
  }

  return data as T;
}

export function normalizeManualServerItemNumber(value: string) {
  return String(value || '').trim().toUpperCase();
}

export function buildManualServerItemKey(value: string) {
  return normalizeIdentifier(value);
}

export async function fetchManualServerByItem(itemNumber: string) {
  const safeItemNumber = normalizeManualServerItemNumber(itemNumber);
  if (!safeItemNumber) {
    return {
      itemNumber: '',
      folderPath: '',
      manuals: [],
    } satisfies ManualServerByItemResponse;
  }

  const params = new URLSearchParams({ itemNumber: safeItemNumber });
  return manualServerRequest<ManualServerByItemResponse>(`/manuals/by-item?${params.toString()}`);
}

export async function fetchManualServerUnassigned() {
  return manualServerRequest<ManualServerUnassignedResponse>('/manuals/unassigned');
}

export async function fetchManualServerAssignedItems() {
  return manualServerRequest<ManualServerAssignedItemsResponse>('/manuals/items');
}

export async function assignManualServerManual(params: {
  relativePath: string;
  itemNumber: string;
}) {
  return manualServerRequest<{
    success: boolean;
    itemNumber: string;
    folderPath: string;
    relativePath: string;
  }>('/manuals/assign', {
    method: 'POST',
    body: JSON.stringify({
      relativePath: params.relativePath,
      itemNumber: normalizeManualServerItemNumber(params.itemNumber),
    }),
  });
}
