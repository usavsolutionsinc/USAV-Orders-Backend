'use client';

import { useEffect, useState } from 'react';

export function InlineEdit({ value, onSave, displayClassName }: { value: string; onSave: (next: string) => void; displayClassName: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={`group ${displayClassName} text-left hover:underline`}>
        {value}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft.trim() || value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSave(draft.trim() || value); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className="h-9 min-w-[200px] flex-1 rounded-md border border-gray-300 px-2 text-base font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
      />
    </div>
  );
}
