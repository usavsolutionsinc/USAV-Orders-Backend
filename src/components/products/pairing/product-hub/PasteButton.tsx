import { Clipboard } from '@/components/Icons';

/** Reads the clipboard and feeds the trimmed text into a field. */
export function PasteButton({ onPaste }: { onPaste: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) onPaste(text.trim());
        } catch {
          /* clipboard blocked — operator can still type */
        }
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
      title="Paste from clipboard"
      aria-label="Paste from clipboard"
    >
      <Clipboard className="h-3.5 w-3.5" />
    </button>
  );
}
