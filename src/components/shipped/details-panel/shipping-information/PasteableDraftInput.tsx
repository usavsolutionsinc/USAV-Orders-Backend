export function PasteableDraftInput({
  value,
  onChange,
  onPaste,
  placeholder,
  inputClassName = '',
  ariaLabel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  onPaste: () => Promise<void>;
  placeholder: string;
  inputClassName?: string;
  ariaLabel: string;
  title: string;
}) {
  // `onPaste`, `ariaLabel`, `title` are kept on the prop type for callers but
  // the Clipboard quick-paste affordance was removed at the user's request.
  void onPaste;
  void ariaLabel;
  void title;
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white transition-colors focus-within:border-blue-400">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-10 w-full border-0 bg-transparent px-3 text-sm font-bold text-gray-900 outline-none ${inputClassName}`}
      />
    </div>
  );
}
