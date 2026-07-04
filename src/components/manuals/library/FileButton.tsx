import { FileText, Pencil, Check } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { statusBadgeClass, typeBadgeClass, type ManualRow } from './manuals-tree';
import { HighlightedText } from './LibraryPrimitives';

/**
 * A file (manual) row. Draggable for moves, click-to-open, and a pencil that
 * adds it to the bulk selection (which then reveals the left-edge checkbox).
 */
export function FileButton({
  manual, isSelected, onClick, highlight, isChecked, onToggleCheck, selection,
}: {
  manual: ManualRow;
  isSelected: boolean;
  onClick: () => void;
  highlight?: { label: string; indices: number[] };
  isChecked: boolean;
  /** additive=true when Cmd/Ctrl/Shift held — preserves prior selection. */
  onToggleCheck: (additive: boolean) => void;
  selection: Set<number>;
}) {
  const title = manual.display_name || manual.file_name || `Manual #${manual.id}`;
  // If the dragged row is in the selection, drop carries every selected id (so
  // dragging one of N checked files moves all N). Otherwise just the single id.
  const handleDragStart = (e: React.DragEvent) => {
    const ids = selection.has(manual.id) ? Array.from(selection) : [manual.id];
    e.dataTransfer.setData('application/x-manual-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    // div outer + button overlay so the checkbox isn't nested inside another button.
    <div
      draggable
      onDragStart={handleDragStart}
      className={`group relative flex w-full items-start gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all ${
        isChecked
          ? 'border-indigo-300 bg-indigo-50/60 shadow-sm ring-1 ring-inset ring-indigo-200'
          : isSelected
            ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/50 shadow-sm ring-1 ring-inset ring-blue-200'
            : 'border-border-soft bg-surface-card shadow-sm hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50/30 hover:shadow-md active:translate-y-0 active:shadow-sm'
      }`}
    >
      {/* Checkbox on the left — only rendered when the row is in the selection
          set. Entering selection is the pencil's job (right side). */}
      {isChecked && (
        <HoverTooltip label="Deselect" asChild>
          {/* ds-raw-button — selection checkbox tile */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(e.metaKey || e.ctrlKey || e.shiftKey);
            }}
            className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-indigo-500 bg-indigo-500 text-white transition-all"
            aria-label={`Deselect ${title}`}
          >
            <Check className="h-3 w-3" />
          </button>
        </HoverTooltip>
      )}
      {/* ds-raw-button — full-card overlay click target */}
      <button type="button" onClick={onClick} className="absolute inset-0 rounded-2xl" aria-label={`Open ${title}`} />
      {/* Thumbnail (first PDF page) when available; fallback to the file glyph. */}
      {manual.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={manual.thumbnail_url}
          alt=""
          className={`pointer-events-none relative mt-0.5 h-10 w-8 shrink-0 rounded-md object-cover ring-1 ring-inset ${
            isSelected ? 'ring-blue-200' : 'ring-border-soft group-hover:ring-blue-100'
          }`}
        />
      ) : (
        <div
          className={`pointer-events-none relative mt-0.5 flex h-10 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${
            isSelected
              ? 'bg-blue-100 text-blue-600 ring-blue-200'
              : 'bg-surface-canvas text-text-soft ring-border-soft group-hover:bg-blue-50 group-hover:text-blue-500 group-hover:ring-blue-100'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
        </div>
      )}
      <div className="pointer-events-none relative min-w-0 flex-1">
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
      {/* Selection pencil — the only way into bulk-select. Held modifiers act
          additively to mirror normal multi-select semantics. */}
      <HoverTooltip label="Select for bulk action" asChild>
        {/* ds-raw-button — group-hover reveal pencil on card tile */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(e.metaKey || e.ctrlKey || e.shiftKey);
          }}
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-lg text-text-faint opacity-0 transition-opacity hover:bg-surface-sunken hover:text-text-muted group-hover:opacity-100 focus:opacity-100"
          aria-label={`Select ${title} for bulk action`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
    </div>
  );
}
