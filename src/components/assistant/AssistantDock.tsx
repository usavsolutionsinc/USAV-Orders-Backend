'use client';

/**
 * AssistantDockBody — the assistant sidebar's CONTENT (plan §-2.1). Leads with
 * a collapsible context strip, then chat, then the AI-edits tray when mutations
 * exist, with suggestions + composer pinned at the bottom. Opened from the
 * Sparkles entry in the header search field or ⌘J (toggle; focuses composer on open).
 *
 * This is a geometry-free body: the right-edge slot (full-height dock on desktop)
 * and the crossfade are owned by `RightRailHost`, which renders this body as its
 * `assistant` occupant.
 *
 * House rules: named z tokens (z-panel), Button primitive, typography tokens,
 * semantic colors, HoverTooltip (no title=), linear scaffold.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Loader2, Send, Sparkles, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useActiveAssistantContext } from '@/hooks/useAssistantContext';
import {
  getComposerFocusSeq,
  subscribeComposerFocus,
} from '@/lib/assistant/composer-focus-store';
import {
  getComposerSeedSeq,
  getLatestComposerSeed,
  subscribeComposerSeed,
} from '@/lib/assistant/composer-seed-store';
import { cn } from '@/utils/_cn';
import { useAssistantChat } from './useAssistantChat';
import { AssistantEditsTray } from './AssistantEditsTray';
import { StudioNodeDetail } from './StudioNodeDetail';
import { PageContextSection } from './PageContextSection';
import { RecentDetailStacksSection } from './RecentDetailStacksSection';

const SUGGESTIONS = [
  'Why are units failing testing this week?',
  'Top return reasons this month',
  'How do we compare to typical?',
];

function focusTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.focus();
  const end = el.value.length;
  el.setSelectionRange(end, end);
}

export function AssistantDockBody({ onClose }: { onClose: () => void }) {
  const context = useActiveAssistantContext();
  const chat = useAssistantChat();
  const [draft, setDraft] = useState('');
  const [contextOpen, setContextOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const prevFocusSeqRef = useRef(0);
  const prevSeedSeqRef = useRef(0);
  const chatRef = useRef(chat);
  const contextRef = useRef(context);
  chatRef.current = chat;
  contextRef.current = context;
  const focusSeq = useSyncExternalStore(subscribeComposerFocus, getComposerFocusSeq, () => 0);
  const seedSeq = useSyncExternalStore(subscribeComposerSeed, getComposerSeedSeq, () => 0);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => focusTextarea(composerRef.current));
  }, []);

  useEffect(() => {
    if (focusSeq === prevFocusSeqRef.current) return;
    prevFocusSeqRef.current = focusSeq;
    focusComposer();
  }, [focusSeq, focusComposer]);

  useEffect(() => {
    if (seedSeq === prevSeedSeqRef.current) return;
    prevSeedSeqRef.current = seedSeq;
    const seed = getLatestComposerSeed();
    if (!seed?.text) return;
    if (seed.autoSend) {
      if (chatRef.current.status === 'streaming') {
        setDraft(seed.text);
        return;
      }
      setDraft('');
      void chatRef.current.send(seed.text, contextRef.current);
      return;
    }
    setDraft(seed.text);
    focusComposer();
  }, [seedSeq, focusComposer]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages]);

  useEffect(() => {
    if (chat.messages.length > 0) setContextOpen(false);
  }, [chat.messages.length]);

  const submit = () => {
    if (chat.status === 'streaming' || !draft.trim()) return;
    const text = draft;
    setDraft('');
    void chat.send(text, context);
  };

  const isEmpty = chat.messages.length === 0;

  return (
    <div role="region" aria-label="Operations assistant" className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Assistant</p>
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

      {/* Collapsible context — recents + page chips; tucks away once chatting. */}
      <div className="shrink-0 border-b border-border-hairline">
        {/* ds-raw-button: full-width context toggle row */}
        <button
          type="button"
          onClick={() => setContextOpen((v) => !v)}
          aria-expanded={contextOpen}
          className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-surface-sunken"
        >
          <span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Context</span>
          {contextOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-text-faint" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-text-faint" />
          )}
        </button>
        {contextOpen ? (
          <div className="max-h-[min(30vh,220px)] divide-y divide-border-hairline overflow-y-auto border-t border-border-hairline">
            <PageContextSection />
            <RecentDetailStacksSection />
          </div>
        ) : null}
      </div>

      {/* Chat transcript */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {!isEmpty ? (
          <div className="mt-auto space-y-3">
            {chat.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg px-3 py-2 text-caption leading-5',
                  m.role === 'user'
                    ? 'ml-8 bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-100'
                    : m.error
                      ? 'mr-2 bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                      : 'mr-8 bg-surface-canvas text-text-default ring-1 ring-inset ring-border-hairline',
                )}
              >
                <p className="whitespace-pre-wrap">{m.content || (m.streaming ? '…' : '')}</p>
              </div>
            ))}
            {chat.activeTool ? (
              <p className="flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {chat.activeTool.replaceAll('_', ' ')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <StudioNodeDetail />
      <AssistantEditsTray />

      {/* Bottom cluster — suggestions hug the composer when idle. */}
      {isEmpty ? (
        <div className="shrink-0 space-y-0.5 border-t border-border-hairline px-4 pt-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void chat.send(s, context)}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-caption font-medium text-text-muted hover:bg-surface-sunken"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="shrink-0 border-t border-border-hairline px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            rows={1}
            placeholder="Ask about your operation…"
            aria-keyshortcuts="Meta+J"
            className="block max-h-32 min-h-[40px] w-full resize-none rounded-lg border border-border-soft bg-surface-card py-2.5 pl-3 pr-11 text-caption leading-5 text-text-default placeholder:text-text-faint focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <div className="absolute bottom-1.5 right-1.5">
            <HoverTooltip label="Send (Enter)" focusable={false}>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                ariaLabel="Send message"
                disabled={chat.status === 'streaming' || !draft.trim()}
                className="h-7 w-7 p-0"
              >
                {chat.status === 'streaming' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </HoverTooltip>
          </div>
        </div>
        <p className="mt-1.5 text-micro text-text-faint">
          <span className="rounded bg-surface-canvas px-1 py-px text-[10px] font-semibold ring-1 ring-inset ring-border-hairline">
            ⌘J
          </span>{' '}
          ⌘J toggle · Enter send · Esc close
        </p>
      </form>
    </div>
  );
}
