import { Clipboard } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/** Reads the clipboard and feeds the trimmed text into a field. */
export function PasteButton({ onPaste }: { onPaste: (value: string) => void }) {
  return (
    <HoverTooltip label="Paste from clipboard" asChild>
      <IconButton
        type="button"
        tone="accent"
        onClick={async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) onPaste(text.trim());
          } catch {
            /* clipboard blocked — operator can still type */
          }
        }}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
        ariaLabel="Paste from clipboard"
        icon={<Clipboard className="h-3.5 w-3.5" />}
      />
    </HoverTooltip>
  );
}
