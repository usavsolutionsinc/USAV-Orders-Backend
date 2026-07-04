'use client';

/**
 * AssistantDock — the persistent right-side assistant dock (plan §-2.1):
 * chat on top, the AI-edits tray beneath (empty until the write path ships).
 * Present on every route via AssistantProvider; collapsible; desktop-only for
 * now (mobile dock design is an open §8 question). Realtime plumbing: the
 * dock subscribes to the org/session assistant channel so Phase 3 applies can
 * repaint the tray live.
 *
 * House rules: named z tokens (z-panel / z-fab), Button primitive, typography
 * tokens, semantic colors, HoverTooltip (no title=), linear scaffold.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useActiveAssistantContext } from '@/hooks/useAssistantContext';
import { cn } from '@/utils/_cn';
import { useAssistantChat } from './useAssistantChat';
import { AssistantEditsTray } from './AssistantEditsTray';
import { StudioNodeDetail } from './StudioNodeDetail';

const SUGGESTIONS = [
  'Why are units failing testing this week?',
  'Top return reasons this month',
  'How do we compare to typical?',
];

export function AssistantDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const context = useActiveAssistantContext();
  const chat = useAssistantChat();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages, open]);

  if (!open) return null;

  const submit = () => {
    if (chat.status === 'streaming' || !draft.trim()) return;
    const text = draft;
    setDraft('');
    void chat.send(text, context);
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 z-panel hidden w-96 flex-col border-l border-border-soft bg-surface-card shadow-xl lg:flex"
      aria-label="Operations assistant"
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Assistant</p>
          {context ? (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-blue-700 ring-1 ring-inset ring-blue-200">
              {context.page}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 -my-1.5">
          <Button variant="ghost" size="sm" onClick={chat.reset} ariaLabel="New conversation">
            New
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} ariaLabel="Close assistant">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chat.messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-caption leading-5 text-text-soft">
              Ask about this operation in plain English — failures, returns, a unit&rsquo;s journey, how you compare to
              typical. I can take you to the page that shows it.
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                /* ds-raw-button: suggestion chips are full-width custom rows, not a DS Button variant */
                <button
                  key={s}
                  type="button"
                  onClick={() => void chat.send(s, context)}
                  className="block w-full rounded-lg border border-border-soft bg-surface-canvas px-3 py-2 text-left text-caption font-semibold text-text-muted hover:bg-surface-sunken"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-xl px-3 py-2 text-caption leading-5',
                m.role === 'user'
                  ? 'ml-6 bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-100'
                  : m.error
                    ? 'mr-2 bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                    : 'mr-2 bg-surface-canvas text-text-default ring-1 ring-inset ring-border-hairline',
              )}
            >
              <p className="whitespace-pre-wrap">{m.content || (m.streaming ? '…' : '')}</p>
            </div>
          ))
        )}
        {chat.activeTool ? (
          <p className="flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {chat.activeTool.replaceAll('_', ' ')}
          </p>
        ) : null}
      </div>

      {/* On /studio the dock absorbs the inspector (plan §4): focused-node
          detail beneath the chat. */}
      <StudioNodeDetail />

      {/* AI-edits tray (plan §-2.1): live agent_mutations with revert. */}
      <AssistantEditsTray />

      {/* composer */}
      <form
        className="flex items-end gap-2 border-t border-border-hairline px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask about your operation…"
          className="min-h-0 flex-1 resize-none rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-caption text-text-default placeholder:text-text-faint focus:border-blue-400 focus:outline-none"
        />
        <HoverTooltip label="Send (Enter)" focusable={false}>
          <Button variant="primary" size="sm" type="submit" ariaLabel="Send message" disabled={chat.status === 'streaming' || !draft.trim()}>
            {chat.status === 'streaming' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </HoverTooltip>
      </form>
    </aside>
  );
}
