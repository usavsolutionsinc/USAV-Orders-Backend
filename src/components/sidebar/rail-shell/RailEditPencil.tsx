import { Check, Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

/**
 * Eyebrow pencil — flips the rail into checkbox multi-select (see
 * {@link useRailEditMode}). Eyebrow-scale sibling of actions like the Scanned
 * rail's "Sync Zoho"; active state fills blue and swaps to a ✓ ("done").
 *
 * `-my-1.5` bleeds the 20px hit box out of the row's height math (same trick
 * as the Sync Zoho pill) so every rail eyebrow keeps the identical compact
 * text-governed height whether its right slot is a suffix, an action, or this.
 */
export function RailEditPencil({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <HoverTooltip label={active ? 'Done' : 'Select rows (bulk delete)'} asChild>
      <IconButton
        onClick={onToggle}
        aria-pressed={active}
        ariaLabel={active ? 'Done — exit select mode' : 'Select rows for bulk actions'}
        className={`group -my-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
          active ? 'bg-blue-600 shadow-sm hover:bg-blue-700' : 'hover:bg-gray-100'
        }`}
        icon={
          active ? (
            <Check className="h-3 w-3 text-white" />
          ) : (
            <Pencil className="h-3 w-3 text-gray-400 group-hover:text-gray-600" />
          )
        }
      />
    </HoverTooltip>
  );
}
