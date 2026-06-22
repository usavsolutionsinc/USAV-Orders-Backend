'use client';

import { getNasPhotosPanel } from './nas-photos-navigation';
import { PhotosPlatformPanel } from './PhotosPlatformPanel';
import { type NasStorageTargets, STATIONS, TARGETS, targetKeyFromPicker } from './nas-folders/nas-folders-config';
import { useStationNasFolders } from './nas-folders/useStationNasFolders';
import { NasAddressPanel } from './nas-folders/NasAddressPanel';
import { NasWorkflowsPanel } from './nas-folders/NasWorkflowsPanel';
import { StationFoldersPanel } from './nas-folders/StationFoldersPanel';
import { FolderPickerModal } from './nas-folders/FolderPickerModal';

interface StationNasFoldersTabProps {
  mode?: string;
}

/**
 * Admin → Receiving Photos. Per-mode panels: NAS address, workflow folders,
 * per-station picker defaults, and the photos platform. Thin composition layer —
 * state/logic live in {@link useStationNasFolders}; the panels live under
 * `./nas-folders/`.
 */
export function StationNasFoldersTab({ mode }: StationNasFoldersTabProps) {
  const c = useStationNasFolders();
  const panel = getNasPhotosPanel(mode);
  const picking = c.picking; // const local so it narrows inside the modal guard

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="sr-only">NAS Photos</h1>
          <p className="mt-1 text-caption text-gray-500">
            Control the NAS endpoint, workflow storage folders, and station picker defaults.
          </p>
        </div>

        {panel === 'address' ? <NasAddressPanel c={c} /> : null}
        {panel === 'workflows' ? <NasWorkflowsPanel c={c} /> : null}
        {panel === 'stations' ? <StationFoldersPanel c={c} /> : null}
        {panel === 'platform' ? <PhotosPlatformPanel /> : null}
      </div>

      {picking ? (
        <FolderPickerModal
          station={
            targetKeyFromPicker(picking)
              ? (TARGETS.find((t) => t.key === targetKeyFromPicker(picking))?.label ?? picking)
              : (STATIONS.find((s) => s.key === picking)?.label ?? picking)
          }
          initialDir={
            targetKeyFromPicker(picking)
              ? (c.targets[targetKeyFromPicker(picking) as keyof NasStorageTargets]?.folder ?? '')
              : (c.draft[picking] ?? '')
          }
          onCancel={() => c.setPicking(null)}
          onPick={(folder) => {
            const targetKey = targetKeyFromPicker(picking);
            if (targetKey) {
              c.setTarget(targetKey, 'folder', folder);
            } else {
              c.setFolder(picking, folder);
            }
            c.setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}
