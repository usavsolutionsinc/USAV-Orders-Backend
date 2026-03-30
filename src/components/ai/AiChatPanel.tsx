'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Database,
  Loader2,
  PackageCheck,
  Send,
} from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import AiAnswerCard from '@/components/ai/AiAnswerCard';
import AiPromptChips from '@/components/ai/AiPromptChips';
import type { AiChatMode, AiChatRouteResponse, AiStructuredAnswer } from '@/lib/ai/types';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  ts: number;
  error?: boolean;
  analysis?: AiStructuredAnswer | null;
  mode?: AiChatMode;
}

type ConnectionStatus = 'checking' | 'online' | 'offline';

const STARTER_PROMPTS = [
  'How many orders were shipped last week and by who?',
  'Show this week shipped orders by tester',
  'Which shipped orders last week are missing a tester?',
];

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

function RefreshIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function BotIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.5l.345 2.623a2.25 2.25 0 01-2.243 2.502H6.098a2.25 2.25 0 01-2.243-2.502L4.157 15M5 14.5L3.5 14"
      />
    </svg>
  );
}

function statusLabel(status: ConnectionStatus) {
  if (status === 'online') return 'Model Connected';
  if (status === 'offline') return 'Model Offline';
  return 'Checking Model';
}

function modeLabel(mode: AiChatMode | undefined) {
  if (mode === 'local_ops') return 'Local Ops Query';
  if (mode === 'hybrid') return 'Hybrid Answer';
  return 'Assistant';
}

export default function AiChatPanel() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createSession = useCallback(async () => {
    setSessionId(null);
    try {
      const res = await fetch('/api/ai/tunnel-session', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.session_id) {
        setSessionId(data.session_id);
      } else {
        console.error('[AiChatPanel] Failed to create session:', data?.error);
      }
    } catch (err) {
      console.error('[AiChatPanel] Session fetch error:', err);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/tunnel-health');
      const data = await res.json();
      setConnectionStatus(data.ok ? 'online' : 'offline');
    } catch {
      setConnectionStatus('offline');
    }
  }, []);

  const startNewChat = useCallback(async () => {
    setMessages([]);
    setInput('');
    await createSession();
    textareaRef.current?.focus();
  }, [createSession]);

  useEffect(() => {
    createSession();
    checkHealth();
    healthIntervalRef.current = setInterval(checkHealth, 30_000);

    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, [createSession, checkHealth]);

  useEffect(() => {
    const handler = () => startNewChat();
    window.addEventListener('ai-new-chat', handler);
    return () => window.removeEventListener('ai-new-chat', handler);
  }, [startNewChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const sendMessage = useCallback(async (rawText?: string) => {
    const text = String(rawText ?? input).trim();
    if (!text || isLoading || !sessionId) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: text,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/tunnel-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });

      const data = (await res.json()) as Partial<AiChatRouteResponse> & { error?: string };

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: data?.error ?? 'Something went wrong. Please try again.',
            ts: Date.now(),
            error: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: String(data.reply || '').trim() || 'No response received.',
            ts: Date.now(),
            analysis: data.analysis ?? null,
            mode: data.mode,
          },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: `Connection error: ${err?.message ?? 'Could not reach the server.'}`,
          ts: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, isLoading, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handlePromptSelect = useCallback((prompt: string) => {
    void sendMessage(prompt);
  }, [sendMessage]);

  const canSend = !!input.trim() && !isLoading && !!sessionId;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#fbfbfa] text-gray-900">
      <div className={`${mainStickyHeaderClass} flex-shrink-0 border-b border-gray-200 bg-[#fbfbfa]/95 backdrop-blur`}>
        <div className={`${mainStickyHeaderRowClass} px-6`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center border border-gray-300 bg-white text-gray-700">
              <BotIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={sectionLabel}>USAV Ops Assistant</p>
              <p className="truncate text-[13px] font-medium text-gray-700">
                Deterministic shipped-order summaries plus general AI responses
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-medium text-gray-600 md:block">
              PST week ranges
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className={`flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 ${sectionLabel} text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900`}
            >
              <RefreshIcon className="h-3 w-3" />
              New Chat
            </button>
          </div>
        </div>

        <div className="grid gap-px border-t border-gray-200 bg-gray-200 px-6 py-px md:grid-cols-3">
          <div className="flex items-center gap-2 bg-[#fbfbfa] px-3 py-2 text-[11px] text-gray-600">
            {connectionStatus === 'online' ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : connectionStatus === 'offline' ? (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            )}
            <span>{statusLabel(connectionStatus)}</span>
          </div>
          <div className="flex items-center gap-2 bg-[#fbfbfa] px-3 py-2 text-[11px] text-gray-600">
            <Database className="h-4 w-4 text-gray-500" />
            <span>Local shipped summaries use app-side order data</span>
          </div>
          <div className="flex items-center gap-2 bg-[#fbfbfa] px-3 py-2 text-[11px] text-gray-600">
            <Clock className="h-4 w-4 text-gray-500" />
            <span>
              {connectionStatus === 'offline'
                ? 'Model backend can be offline while shipped metrics still work'
                : 'General questions still route through the model backend'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && !isLoading ? (
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <section className="space-y-4 border border-gray-200 bg-white p-5">
                <div className={`flex items-center gap-2 ${sectionLabel}`}>
                  <PackageCheck className="h-4 w-4 text-gray-500" />
                  Reliable Ops Questions
                </div>
                <h1 className="text-[24px] font-semibold tracking-tight text-gray-900">
                  Ask shipped-count questions in plain English and get the exact timeframe back.
                </h1>
                <p className="max-w-2xl text-[13px] leading-7 text-gray-600">
                  The panel now handles shipped-order summaries locally against the same shipped-order data used by the dashboard.
                  For prompts like shipped counts by packer or tester, it returns the total, the operator breakdown, the source tables,
                  and a direct link back to the shipped view.
                </p>
                <AiPromptChips prompts={STARTER_PROMPTS} onSelect={handlePromptSelect} />
              </section>

              <section className="space-y-3 border border-gray-200 bg-white p-5">
                <div className={`flex items-center gap-2 ${sectionLabel}`}>
                  <Database className="h-4 w-4 text-gray-500" />
                  What The Panel Uses
                </div>
                <div className="space-y-3 text-[12px] leading-6 text-gray-600">
                  <div className="border-b border-gray-100 pb-3">
                    <p className="font-medium text-gray-900">Shipped summaries</p>
                    <p>`shipping_tracking_numbers`, `packer_logs`, and `work_assignments`</p>
                  </div>
                  <div className="border-b border-gray-100 pb-3">
                    <p className="font-medium text-gray-900">Timeframes</p>
                    <p>PST-aware date ranges with exact start and end dates shown in every answer</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Fallback behavior</p>
                    <p>General questions still use the AI backend. Structured shipping metrics do not need the model backend to answer.</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {messages.map((msg) => {
              const timestampLabel = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="ml-auto w-full max-w-2xl border border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className={sectionLabel}>Question</span>
                      <span className="text-[10px] text-gray-500">{timestampLabel}</span>
                    </div>
                    <p className="mt-2 text-[13px] leading-6 text-gray-900">{msg.content}</p>
                  </div>
                );
              }

              if (msg.error) {
                return (
                  <div key={msg.id} className="w-full max-w-3xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`${sectionLabel} text-red-500`}>Error</span>
                      <span className="text-[10px] text-red-500">{timestampLabel}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-6 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="w-full max-w-3xl">
                  <AiAnswerCard
                    analysis={msg.analysis}
                    content={msg.content}
                    modeLabel={modeLabel(msg.mode)}
                    timestampLabel={timestampLabel}
                    onFollowUp={handlePromptSelect}
                  />
                </div>
              );
            })}

            {isLoading ? (
              <div className="w-full max-w-3xl border border-gray-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  <div>
                    <p className={sectionLabel}>Working</p>
                    <p className="mt-1 text-[12px] text-gray-600">
                      {connectionStatus === 'offline'
                        ? 'Running local ops query or waiting for model backend'
                        : 'Preparing the answer'}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-end gap-2 border border-gray-300 bg-[#fbfbfa] px-3 py-2 focus-within:border-gray-400">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !sessionId
                  ? 'Starting session…'
                  : connectionStatus === 'offline'
                    ? 'Ask a shipped-count question or wait for the model backend…'
                    : 'Ask about shipped counts, staff breakdowns, or general ops questions…'
              }
              disabled={!sessionId || isLoading}
              className="min-h-[24px] flex-1 resize-none bg-transparent text-[13px] leading-6 text-gray-800 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed"
              style={{ maxHeight: '160px' }}
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!canSend}
              aria-label="Send message"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center border border-gray-900 bg-gray-900 text-white transition-colors hover:bg-black disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
            <span>Shift+Enter for new line. Deterministic shipped summaries use PST date ranges and local app data.</span>
            <span>{connectionStatus === 'offline' ? 'Model backend offline' : 'Model backend online'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
