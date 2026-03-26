'use client';

export default function AiPromptChips({
  prompts,
  onSelect,
}: {
  prompts: string[];
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="border border-gray-200 px-3 py-2 text-left text-[11px] leading-5 text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
