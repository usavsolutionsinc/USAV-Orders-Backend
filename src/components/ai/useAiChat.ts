'use client';

import { useCallback, useRef, useState } from 'react';
import type { AiChatMode, AiStructuredAnswer } from '@/lib/ai/types';

export type ChatRole = 'user' | 'assistant';

/** One SSE `step` frame captured while the assistant worked on this message. */
export interface AgentStep {
  label: string;
  at: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: number;
  error?: boolean;
  analysis?: AiStructuredAnswer | null;
  mode?: AiChatMode;
  /** true while tokens are still streaming into this assistant message */
  streaming?: boolean;
  /** SSE `step` labels accumulated during this run (drives AgentStepTimeline). */
  steps?: AgentStep[];
  /** when the run started / finished — for the elapsed timer + collapsed summary */
  startedAt?: number;
  doneAt?: number;
}

export type ChatStatus = 'idle' | 'streaming';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m-${Date.now()}-${counter}`;
}

function newSessionId(): string {
  return `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface UseAiChatOptions {
  /** Reuse an existing session id (e.g. resumed from history). */
  initialSessionId?: string;
  endpoint?: string;
}

/**
 * Owns the streaming chat conversation: message list, send/stop/regenerate,
 * and the SSE read-loop against /api/ai/chat/stream. Surface components stay
 * presentational and just render `messages` + call `send`/`stop`.
 */
export function useAiChat(opts: UseAiChatOptions = {}) {
  const endpoint = opts.endpoint ?? '/api/ai/chat/stream';
  const [sessionId, setSessionId] = useState<string>(() => opts.initialSessionId ?? newSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [step, setStep] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserTextRef = useRef<string>('');

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const stop = useCallback(() => {
    // Abort only — the run's `finally` clears abortRef/status itself so a
    // stopped run and a retried-over run clean up the same way.
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async (text: string, sid: string) => {
    const assistantId = nextId();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', ts: Date.now(), streaming: true, steps: [], startedAt: Date.now() }]);
    setStatus('streaming');
    setStep(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, message: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = 'Could not reach the assistant.';
        try { const j = await res.json(); msg = j?.error ?? msg; } catch { /* ignore */ }
        patchMessage(assistantId, { content: msg, error: true, streaming: false });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (event: string, data: string) => {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(data); } catch { /* keep-alive */ }
        switch (event) {
          case 'meta':
            patchMessage(assistantId, { mode: payload.mode as AiChatMode });
            break;
          case 'step': {
            const label = typeof payload.label === 'string' ? payload.label : null;
            setStep(label);
            if (label) {
              setMessages((prev) => prev.map((m) => (
                m.id === assistantId ? { ...m, steps: [...(m.steps ?? []), { label, at: Date.now() }] } : m
              )));
            }
            break;
          }
          case 'delta':
            if (typeof payload.text === 'string' && payload.text) {
              const piece = payload.text;
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + piece } : m)));
            }
            break;
          case 'analysis':
            patchMessage(assistantId, { analysis: payload as unknown as AiStructuredAnswer });
            break;
          case 'error':
            patchMessage(assistantId, { content: String(payload.message ?? 'Something went wrong.'), error: true });
            break;
          case 'done':
            patchMessage(assistantId, { streaming: false, doneAt: Date.now() });
            break;
          default:
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) handleEvent(event, data);
        }
      }
      patchMessage(assistantId, { streaming: false, doneAt: Date.now() });
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        patchMessage(assistantId, { streaming: false, content: '', doneAt: Date.now() });
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content.trim())));
      } else {
        const msg = err instanceof Error ? err.message : 'Connection error.';
        patchMessage(assistantId, { content: `Connection error: ${msg}`, error: true, streaming: false, doneAt: Date.now() });
      }
    } finally {
      // Only reset shared status if this run is still the active one — a retry
      // may have aborted us and already started a fresh run.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStatus('idle');
        setStep(null);
      }
    }
  }, [endpoint, patchMessage]);

  const send = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text || status === 'streaming') return;
    lastUserTextRef.current = text;
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text, ts: Date.now() }]);
    void run(text, sessionId);
  }, [run, sessionId, status]);

  /**
   * Re-send the last user message through the normal send path. Works on an
   * errored answer, the last completed answer, or mid-stream (aborts the
   * in-flight run first). The trailing assistant message is dropped and
   * replaced by the fresh run.
   */
  const retry = useCallback(() => {
    const lastUser = lastUserTextRef.current;
    if (!lastUser) return;
    abortRef.current?.abort();
    // drop the trailing assistant message before re-running
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      return prev.filter((_, i) => i !== realIdx);
    });
    void run(lastUser, sessionId);
  }, [run, sessionId]);

  /** Back-compat alias — regenerate the last answer. */
  const regenerate = retry;

  const editMessage = useCallback((id: string, newText: string) => {
    if (status === 'streaming') return;
    const text = newText.trim();
    if (!text) return;
    // Truncate the thread back to just before the edited user turn, then resend.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      const base = idx === -1 ? prev : prev.slice(0, idx);
      return [...base, { id: nextId(), role: 'user', content: text, ts: Date.now() }];
    });
    lastUserTextRef.current = text;
    void run(text, sessionId);
  }, [run, sessionId, status]);

  const reset = useCallback((nextId?: string) => {
    stop();
    setMessages([]);
    setStep(null);
    setSessionId(nextId ?? newSessionId());
  }, [stop]);

  const loadSession = useCallback((sid: string, loaded: ChatMessage[]) => {
    stop();
    setSessionId(sid);
    setMessages(loaded);
    setStep(null);
  }, [stop]);

  return { sessionId, messages, status, step, send, stop, retry, regenerate, editMessage, reset, loadSession };
}
