'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Loader2, RefreshCw, Send, Sparkles } from '@/components/Icons';
import AiAnswerCard from '@/components/ai/AiAnswerCard';
import MarkdownRenderer from '@/components/ai/MarkdownRenderer';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useAiChat, type ChatMessage } from '@/components/ai/useAiChat';
import { linkifyOrderRefs, inferDestination, countOrderRefs } from '@/components/ai/ai-answer-enrich';

function ArrowRightGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const STARTER_PROMPTS = [
  'How many orders shipped last week and by who?',
  'Which open repairs are waiting for parts?',
  'What FBA shipments are currently open?',
  'Show this week shipped orders by tester',
];

function modeLabel(mode: ChatMessage['mode']): string {
  if (mode === 'local_ops') return 'Local Ops Query';
  if (mode === 'rag') return 'Bose Manual';
  if (mode === 'hybrid') return 'Hybrid';
  return 'Assistant';
}

function StopGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function PencilGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-micro font-semibold text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      aria-label="Copy answer"
      title="Copy answer"
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export interface AiChatConversationProps {
  /** 'panel' = narrow sidebar dock; 'full' = comfortable centered page column */
  variant?: 'panel' | 'full';
  chat: ReturnType<typeof useAiChat>;
}

/**
 * Presentational streaming chat surface. State lives in the `useAiChat` hook
 * passed in by the parent (sidebar panel or full page), so the same UI renders
 * in both places. Light theme throughout.
 *
 * Keyboard: Enter / ⌘↵ send · Shift+Enter newline · Esc cancel-edit or stop ·
 * ↑ (empty input) edit last message · ⌘K / Ctrl+K focus the composer.
 */
export default function AiChatConversation({ variant = 'panel', chat }: AiChatConversationProps) {
  const { messages, status, step, send, stop, regenerate, editMessage } = chat;
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);

  const colWidth = variant === 'full' ? 'mx-auto w-full max-w-3xl' : 'w-full';

  const focusComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  // Track whether the user is pinned to the bottom so auto-scroll never fights them.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Elapsed timer while waiting on the model.
  useEffect(() => {
    if (status !== 'streaming') { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [status]);

  // ⌘K / Ctrl+K focuses the composer from anywhere in the surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusComposer]);

  const startEditing = useCallback((msg: ChatMessage) => {
    if (status === 'streaming') return;
    setEditingId(msg.id);
    setInput(msg.content);
    setTimeout(focusComposer, 0);
  }, [focusComposer, status]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setInput('');
  }, []);

  const submit = useCallback((text?: string) => {
    const value = (text ?? input).trim();
    if (!value || status === 'streaming') return;
    if (editingId) {
      editMessage(editingId, value);
      setEditingId(null);
    } else {
      send(value);
    }
    setInput('');
    pinnedRef.current = true;
  }, [editMessage, editingId, input, send, status]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editingId) cancelEditing();
      else if (status === 'streaming') stop();
      return;
    }
    if (e.key === 'ArrowUp' && !input && !editingId && status !== 'streaming') {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) { e.preventDefault(); startEditing(lastUser); }
    }
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant' && !m.streaming)?.id;
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfbfa]">
      {/* Thread */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={status === 'streaming'}
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {isEmpty ? (
          <div className={`${colWidth} flex h-full flex-col justify-center`}>
            <div className="flex items-center gap-2 text-gray-700">
              <Sparkles className="h-5 w-5 text-blue-500" />
              <p className="text-base font-semibold tracking-tight text-gray-900">USAV Assistant</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Ask about orders, shipping, staff pace, FBA, repairs, inventory, or Bose service manuals.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-caption leading-5 text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-gray-900"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={`${colWidth} flex flex-col gap-4`}>
            {messages.map((msg, i) => {
              const ts = new Date(msg.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
              const prevUser = i > 0 && messages[i - 1]?.role === 'user' ? messages[i - 1].content : '';

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="group ml-auto flex max-w-[88%] items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEditing(msg)}
                      disabled={status === 'streaming'}
                      className="mt-2 hidden rounded-md p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600 group-hover:block disabled:hidden"
                      aria-label="Edit and resend"
                      title="Edit & resend"
                    >
                      <PencilGlyph />
                    </button>
                    <div className="rounded-xl rounded-br-sm border border-blue-100 bg-blue-50 px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-900">{msg.content}</p>
                    </div>
                  </div>
                );
              }

              if (msg.error) {
                return (
                  <div key={msg.id} className="max-w-full rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">
                    <div className={`${sectionLabel} text-red-500`}>Error</div>
                    <p className="mt-1 whitespace-pre-wrap text-label leading-6">{msg.content}</p>
                  </div>
                );
              }

              const showCaret = msg.streaming;
              const isLastDone = msg.id === lastAssistantId;

              return (
                <div key={msg.id} className="group max-w-full">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {msg.analysis ? (
                        <AiAnswerCard analysis={msg.analysis} content={msg.content} modeLabel={modeLabel(msg.mode)} timestampLabel={ts} onFollowUp={(p) => submit(p)} />
                      ) : msg.content ? (
                        <div className="text-sm leading-7 text-gray-800">
                          <MarkdownRenderer content={msg.streaming ? msg.content : linkifyOrderRefs(msg.content)} />
                          {showCaret ? <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-blue-500 align-middle" /> : null}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-1 text-caption text-gray-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                          <span>{step ?? 'Working'}{status === 'streaming' && elapsed > 0 ? ` · ${elapsed}s` : ''}</span>
                        </div>
                      )}

                      {!msg.streaming && msg.content && !msg.analysis ? (() => {
                        const dest = inferDestination(prevUser, msg.content);
                        if (!dest) return null;
                        const n = countOrderRefs(msg.content);
                        return (
                          <a
                            href={dest.href}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-caption font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
                          >
                            {n >= 3 ? `${dest.label} — see all ${n}+` : dest.label}
                            <ArrowRightGlyph className="h-3.5 w-3.5" />
                          </a>
                        );
                      })() : null}

                      {!msg.streaming && msg.content && !msg.analysis ? (
                        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <CopyButton text={msg.content} />
                          {isLastDone ? (
                            <button
                              type="button"
                              onClick={() => regenerate()}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-micro font-semibold text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                              aria-label="Regenerate answer"
                              title="Regenerate answer"
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Retry
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-gray-200 bg-[#fbfbfa] px-3 py-3">
        <div className={colWidth}>
          {editingId ? (
            <div className="mb-1.5 flex items-center justify-between rounded-md bg-amber-50 px-2.5 py-1 text-micro font-semibold text-amber-700">
              <span>Editing your message — the reply will be regenerated.</span>
              <button type="button" onClick={cancelEditing} className="rounded px-1.5 py-0.5 hover:bg-amber-100" aria-label="Cancel edit">Cancel · Esc</button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-blue-400">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={editingId ? 'Edit your message…' : 'Ask about orders, staff, FBA, repairs, Bose manuals…'}
              className="min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-6 text-gray-800 placeholder-gray-400 focus:outline-none"
              style={{ maxHeight: '180px' }}
            />
            {status === 'streaming' ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                title="Stop generating"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-900 bg-gray-900 text-white transition-colors hover:bg-black"
              >
                <StopGlyph className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => submit()}
                disabled={!input.trim()}
                aria-label={editingId ? 'Resend edited message' : 'Send message'}
                title={editingId ? 'Resend' : 'Send'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-900 bg-gray-900 text-white transition-colors hover:bg-black disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-micro text-gray-400">
            <span>Enter to send · Shift+Enter newline{status === 'streaming' ? ' · Esc to stop' : ' · ⌘K to focus'}</span>
            {status === 'streaming' ? <span className="text-blue-500">{step ?? 'Working'}{elapsed > 0 ? ` · ${elapsed}s` : ''}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
