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
          className="ds-raw-button border border-border-soft px-3 py-2 text-left text-caption leading-5 text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-default"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
