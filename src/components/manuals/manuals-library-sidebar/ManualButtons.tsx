import { FileText } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { statusBadgeClass, typeBadgeClass, type FolderNode, type ManualRow } from './manuals-library-shared';
import { HighlightedText, FolderIcon, ChevronRightTiny } from './manuals-library-icons';

export function FolderButton({
  node,
  onEnter,
  highlight,
}: {
  node: FolderNode;
  onEnter: () => void;
  highlight?: { label: string; indices: number[] };
}) {
  const subFileCount = node.totalCount;
  const subFolderCount = node.children.size;
  return (
    // ds-raw-button: text-left master-detail folder picker row, not a DS Button
    <button
      type="button"
      onClick={onEnter}
      className="ds-raw-button group flex w-full items-center gap-3 rounded-2xl border border-border-soft bg-surface-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500 ring-1 ring-inset ring-indigo-100 group-hover:from-indigo-100 group-hover:to-violet-100 group-hover:text-indigo-600">
        <FolderIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-black text-text-default">
          {highlight ? <HighlightedText text={highlight.label} indices={highlight.indices} /> : node.name}
        </p>
        <p className="mt-0.5 text-micro font-semibold text-text-soft">
          {subFolderCount > 0 && (
            <>
              {subFolderCount} {subFolderCount === 1 ? 'folder' : 'folders'}
              {' · '}
            </>
          )}
          {subFileCount} {subFileCount === 1 ? 'manual' : 'manuals'}
        </p>
      </div>
      <ChevronRightTiny className="h-3.5 w-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" />
    </button>
  );
}

export function FileButton({
  manual,
  isSelected,
  onClick,
  highlight,
}: {
  manual: ManualRow;
  isSelected: boolean;
  onClick: () => void;
  highlight?: { label: string; indices: number[] };
}) {
  const title = manual.display_name || manual.file_name || `Manual #${manual.id}`;
  return (
    // ds-raw-button: text-left master-detail file picker row, not a DS Button
    <button
      type="button"
      onClick={onClick}
      className={`ds-raw-button group flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all ${
        isSelected
          ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/50 shadow-sm ring-1 ring-inset ring-blue-200'
          : 'border-border-soft bg-surface-card shadow-sm hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm'
      }`}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
          isSelected
            ? 'bg-blue-100 text-blue-600 ring-blue-200'
            : 'bg-surface-canvas text-text-soft ring-border-soft group-hover:bg-blue-50 group-hover:text-blue-500 group-hover:ring-blue-100'
        }`}
      >
        <FileText className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-label font-black leading-tight ${isSelected ? 'text-blue-900' : 'text-text-default'}`}>
          {highlight ? <HighlightedText text={highlight.label} indices={highlight.indices} /> : title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className={`${microBadge} rounded-full border px-1.5 py-0.5 ${statusBadgeClass(manual.status)}`}>
            {manual.status}
          </span>
          {manual.type && (
            <span className={`${microBadge} rounded-full border px-1.5 py-0.5 ${typeBadgeClass(manual.type)}`}>
              {manual.type}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
