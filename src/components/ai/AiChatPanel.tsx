'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Zap } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  ts: number;
  error?: boolean;
}

type ConnectionStatus = 'checking' | 'online' | 'offline';

// ---------------------------------------------------------------------------
// Icons not yet in Icons.tsx
// ---------------------------------------------------------------------------
function RefreshIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function BotIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.5l.345 2.623a2.25 2.25 0 01-2.243 2.502H6.098a2.25 2.25 0 01-2.243-2.502L4.157 15M5 14.5L3.5 14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helper: generate a short client-side message ID
// ---------------------------------------------------------------------------
let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AiChatPanel() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -- Session creation -------------------------------------------------------
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

  // -- Health polling ---------------------------------------------------------
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/tunnel-health');
      const data = await res.json();
      setConnectionStatus(data.ok ? 'online' : 'offline');
    } catch {
      setConnectionStatus('offline');
    }
  }, []);

  // -- New chat (clear + fresh session) ---------------------------------------
  const startNewChat = useCallback(async () => {
    setMessages([]);
    setInput('');
    await createSession();
    textareaRef.current?.focus();
  }, [createSession]);

  // -- Mount ------------------------------------------------------------------
  useEffect(() => {
    createSession();
    checkHealth();
    healthIntervalRef.current = setInterval(checkHealth, 30_000);

    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, [createSession, checkHealth]);

  // Listen for the "new-chat" event fired by the sidebar context panel
  useEffect(() => {
    const handler = () => startNewChat();
    window.addEventListener('ai-new-chat', handler);
    return () => window.removeEventListener('ai-new-chat', handler);
  }, [startNewChat]);

  // -- Auto-scroll ------------------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // -- Auto-resize textarea ---------------------------------------------------
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // -- Send -------------------------------------------------------------------
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !sessionId || connectionStatus !== 'online') return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/tunnel-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });

      const data = await res.json();

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
          { id: nextId(), role: 'assistant', content: data.reply, ts: Date.now() },
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
  }, [input, isLoading, sessionId, connectionStatus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // -- Derived state ----------------------------------------------------------
  const canSend = !!input.trim() && !isLoading && !!sessionId && connectionStatus === 'online';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-white min-w-0 overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className={`${mainStickyHeaderClass} flex-shrink-0`}>
        <div className={`${mainStickyHeaderRowClass} px-6`}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600">
            <BotIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-900">USAV AI</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-gray-400">
              Powered by Ollama
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection status badge */}
          <div className="flex items-center gap-1.5">
            {connectionStatus === 'checking' && (
              <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />
            )}
            {connectionStatus === 'online' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            {connectionStatus === 'offline' && (
              <span className="inline-flex rounded-full h-2 w-2 bg-red-500" />
            )}
            <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${
              connectionStatus === 'online' ? 'text-emerald-600' :
              connectionStatus === 'offline' ? 'text-red-500' : 'text-gray-400'
            }`}>
              {connectionStatus === 'checking' ? 'Connecting...' :
               connectionStatus === 'online' ? 'Connected' : 'Offline'}
            </span>
          </div>

          {/* New chat button */}
          <button
            type="button"
            onClick={startNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-[9px] font-black uppercase tracking-[0.2em] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <RefreshIcon className="w-3 h-3" />
            New Chat
          </button>
        </div>
        </div>
      </div>

      {/* ── Message list ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 min-h-0">

        {/* Empty state */}
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center select-none">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-600 to-blue-700 shadow-lg shadow-blue-600/25 mb-5">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <p className="text-[15px] font-black tracking-tight text-gray-900">
              USAV AI Assistant
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-gray-400 max-w-xs leading-relaxed">
              {connectionStatus === 'offline'
                ? 'The chatbot backend is offline. Make sure it is running on your home computer.'
                : 'Ask anything about orders, repairs, inventory, or operations.'}
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div className={`flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-xl ${
              msg.role === 'user'
                ? 'bg-blue-600'
                : msg.error
                ? 'bg-red-100'
                : 'bg-gray-100'
            }`}>
              {msg.role === 'user' ? (
                <span className="text-[9px] font-black text-white uppercase">You</span>
              ) : (
                <BotIcon className={`w-3.5 h-3.5 ${msg.error ? 'text-red-500' : 'text-gray-500'}`} />
              )}
            </div>

            {/* Bubble */}
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-sm'
                : msg.error
                ? 'bg-red-50 border border-red-200 text-red-700 rounded-tl-sm'
                : 'bg-gray-50 border border-gray-100 text-gray-800 rounded-tl-sm'
            }`}>
              <p className="text-[12px] font-medium leading-relaxed whitespace-pre-wrap break-words">
                {msg.content}
              </p>
              <p className={`mt-1 text-[9px] ${
                msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'
              }`}>
                {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-xl bg-gray-100">
              <BotIcon className="w-3.5 h-3.5 text-gray-500" />
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input footer ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
        <div className={`flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors ${
          connectionStatus === 'offline'
            ? 'border-red-200 bg-red-50'
            : 'border-gray-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
        }`}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              connectionStatus === 'offline'
                ? 'Chatbot is offline…'
                : !sessionId
                ? 'Starting session…'
                : 'Ask USAV AI anything… (Enter to send)'
            }
            disabled={connectionStatus === 'offline' || !sessionId || isLoading}
            className="flex-1 resize-none bg-transparent text-[12px] font-medium text-gray-800 placeholder-gray-400 focus:outline-none min-h-[24px] leading-relaxed disabled:cursor-not-allowed"
            style={{ maxHeight: '160px' }}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!canSend}
            aria-label="Send message"
            className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[9px] font-medium text-gray-300">
          Shift+Enter for new line · Enter to send
        </p>
      </div>
    </div>
  );
}
