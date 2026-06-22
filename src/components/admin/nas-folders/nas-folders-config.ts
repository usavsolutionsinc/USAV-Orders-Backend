/** Types + constants for the Admin → Receiving Photos (NAS folders) tab. */

export type FolderMap = Record<string, string>;
export type NasServers = { test: string; prod: string; active: 'test' | 'prod' };
export type NasStorageTarget = { root: string; folder: string };
export type NasStorageTargets = {
  receiving: NasStorageTarget;
  shipping: NasStorageTarget;
  claims: NasStorageTarget;
};

export interface SettingsResponse {
  stationNasPhotoFolders: FolderMap;
  nasPhotoServers: NasServers;
  nasStorageTargets: NasStorageTargets;
}

// "DEFAULT" applies to every operator with no station-specific folder (and to
// staff with no station assigned). The rest mirror staff_stations for overrides.
export const STATIONS: { key: string; label: string; hint: string }[] = [
  { key: 'DEFAULT', label: 'Default (all stations)', hint: 'Used for everyone unless a station below overrides it — set this if you don’t assign stations' },
  { key: 'UNBOX', label: 'Receiving (Unbox)', hint: 'Overrides Default for staff whose primary station is Unbox' },
  { key: 'TECH', label: 'Tech', hint: '' },
  { key: 'PACK', label: 'Packing', hint: '' },
  { key: 'SALES', label: 'Sales', hint: '' },
  { key: 'FBA', label: 'FBA', hint: '' },
];

export const EMPTY_SERVERS: NasServers = { test: '', prod: '', active: 'prod' };

export const EMPTY_TARGETS: NasStorageTargets = {
  receiving: { root: '/Volumes/USAV Media/Puchasing photos/2026', folder: 'JUN 2026' },
  shipping: { root: '/Volumes/Shipping/2026', folder: 'Jun 2026' },
  claims: { root: '/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026', folder: '' },
};

export const TARGETS: Array<{
  key: keyof NasStorageTargets;
  label: string;
  rootPlaceholder: string;
  folderPlaceholder: string;
}> = [
  { key: 'receiving', label: 'Receiving photos', rootPlaceholder: '/Volumes/USAV Media/Puchasing photos/2026', folderPlaceholder: 'JUN 2026' },
  { key: 'shipping', label: 'Outbound labels', rootPlaceholder: '/Volumes/Shipping/2026', folderPlaceholder: 'Jun 2026' },
  { key: 'claims', label: 'Claims archive', rootPlaceholder: '/Volumes/USAV Media/Puchasing photos/2026/2 Zendesk 2026', folderPlaceholder: 'Ticket folders created here' },
];

export function targetKeyFromPicker(value: string): keyof NasStorageTargets | null {
  if (!value.startsWith('target:')) return null;
  const key = value.slice('target:'.length);
  return key === 'receiving' || key === 'shipping' || key === 'claims' ? key : null;
}
