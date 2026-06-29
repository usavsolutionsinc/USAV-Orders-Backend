import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, Trash2, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { Button, IconButton } from '@/design-system/primitives';
import type { Todo } from './goal-chip-shared';

/** Shared checklist list (used by both the recurring + to-do modes). */
export function TaskList({
  items,
  onToggle,
  onRemove,
  adding,
  draft,
  onDraft,
  onAdd,
  onStartAdd,
  onCancelAdd,
  emptyHint,
  placeholder,
  addLabel,
}: {
  items: Todo[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  adding: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  emptyHint: string;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <>
      {items.length === 0 && !adding && (
        <p className="px-2 py-3 text-center text-caption text-gray-400">{emptyHint}</p>
      )}
      {items.map((t) => (
        <div key={t.id} className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50">
          {/* ds-raw-button: custom checkbox toggle (active emerald fill + motion child + aria-pressed) */}
          <button
            type="button"
            onClick={() => onToggle(t.id)}
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md ring-1 transition-colors',
              t.done ? 'bg-emerald-500 ring-emerald-500' : 'bg-white ring-gray-300',
            )}
            aria-pressed={t.done}
          >
            <AnimatePresence>
              {t.done && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
                  <Check className="h-3 w-3 text-white" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          {/* ds-raw-button: flex-1 left-aligned text row (label is the whole hit target) */}
          <button
            type="button"
            onClick={() => onToggle(t.id)}
            className={cn('flex-1 text-left text-label font-semibold transition-colors', t.done ? 'text-gray-400 line-through' : 'text-gray-800')}
          >
            {t.text}
          </button>
          <IconButton
            icon={<Trash2 className="h-3.5 w-3.5 text-gray-400" />}
            ariaLabel="Delete task"
            onClick={() => onRemove(t.id)}
            className="opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
          />
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
              if (e.key === 'Escape') onCancelAdd();
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-label text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
          />
          <Button variant="primary" size="sm" onClick={onAdd} className="shrink-0 text-caption font-bold">
            Add
          </Button>
          <IconButton
            icon={<X className="h-3.5 w-3.5" />}
            ariaLabel="Cancel"
            onClick={onCancelAdd}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={onStartAdd}
          className="mt-0.5 w-full justify-start gap-2 rounded-xl px-2 py-2 text-caption font-bold text-blue-600 hover:bg-gray-50"
        >
          {addLabel}
        </Button>
      )}
    </>
  );
}
