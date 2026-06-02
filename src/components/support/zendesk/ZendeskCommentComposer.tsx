'use client';

import { useState } from 'react';
import { useAddComment } from '@/hooks/useZendeskQueries';
import { Loader2 } from '@/components/Icons';

export function ZendeskCommentComposer({ ticketId }: { ticketId: number }) {
  const [body, setBody] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const add = useAddComment();

  const submit = () => {
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate({ id: ticketId, body: text, isPublic }, { onSuccess: () => setBody('') });
  };

  return (
    <div className="shrink-0 border-t border-gray-100 bg-white p-3">
      <div className="mb-2 inline-flex rounded-lg border border-gray-200 p-0.5">
        <button
          type="button"
          onClick={() => setIsPublic(true)}
          className={`rounded-md px-3 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
            isPublic ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Public reply
        </button>
        <button
          type="button"
          onClick={() => setIsPublic(false)}
          className={`rounded-md px-3 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
            !isPublic ? 'bg-amber-500 text-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Internal note
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={isPublic ? 'Reply to the customer…' : 'Internal note (not emailed to the customer)…'}
        className={`block w-full resize-y rounded-lg border px-3 py-2 text-label text-gray-900 outline-none focus:ring-2 ${
          isPublic
            ? 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/20'
            : 'border-amber-300 bg-amber-50/40 focus:border-amber-500 focus:ring-amber-500/20'
        }`}
      />

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!body.trim() || add.isPending}
          className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-caption font-black uppercase tracking-widest text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isPublic ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-500 hover:bg-amber-600'
          }`}
        >
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isPublic ? 'Send reply' : 'Add note'}
        </button>
      </div>
    </div>
  );
}
