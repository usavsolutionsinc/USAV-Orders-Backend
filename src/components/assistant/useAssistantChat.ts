'use client';

/**
 * useAssistantChat — client engine for the global assistant dock: POSTs to
 * /api/assistant/chat, reads the SSE stream (meta/delta/tool/ui_tool/error/
 * done), and executes CLIENT UI TOOLS as they arrive (plan §-2.4):
 *   navigate(path, params) → router.push (URL-as-state is the payoff)
 *   highlight(ref)         → window CustomEvent any surface can listen for
 * Canvas-control tools (focus_node/set_lens/set_zoom) are acknowledged but
 * inert until Phase 3 wires the Studio URL state.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { useStudioWorkspace } from '@/components/studio/StudioWorkspaceContext';
import type { AssistantPageContext } from '@/lib/assistant/context-store';

export const ASSISTANT_HIGHLIGHT_EVENT = 'usav:assistant-highlight';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

export interface AssistantChatState {
  sessionId: string;
  messages: AssistantMessage[];
  status: 'idle' | 'streaming';
  activeTool: string | null;
  send: (text: string, context: AssistantPageContext | null) => Promise<void>;
  reset: () => void;
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let event = 'message';
    let data = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

export function useAssistantChat(): AssistantChatState {
  const router = useRouter();
  // The dock is inside StudioWorkspaceProvider, so it can drive the Studio's
  // URL view state directly (canvas-control tools). setParams hard-routes to
  // /studio, so it doubles as navigate-into-Studio from any page.
  const studio = useStudioWorkspace();
  const [sessionId, setSessionId] = useState(() => `asst-${safeRandomUUID()}`);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runUiTool = useCallback(
    (name: string, input: Record<string, unknown>) => {
      // '/'-anchored app paths only; '//host' is protocol-relative (external).
      if (name === 'navigate' && typeof input.path === 'string' && input.path.startsWith('/') && !input.path.startsWith('//')) {
        const params = input.params && typeof input.params === 'object' ? (input.params as Record<string, string>) : null;
        const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
        router.push(`${input.path}${qs}`);
        return;
      }
      if (name === 'highlight' && typeof input.ref === 'string') {
        window.dispatchEvent(new CustomEvent(ASSISTANT_HIGHLIGHT_EVENT, { detail: { ref: input.ref } }));
        return;
      }
      // Canvas-control tools drive the Studio URL view state (?focus/z/lens);
      // setParams hard-routes to /studio, so these also navigate there.
      if (name === 'focus_node' && typeof input.nodeId === 'string' && /^[a-z0-9:_-]+$/i.test(input.nodeId)) {
        studio.setParams({ focus: input.nodeId, z: '1' });
        return;
      }
      if (name === 'set_lens' && typeof input.lens === 'string') {
        const lens = input.lens;
        if (['build', 'live', 'flow', 'people', 'gaps', 'static'].includes(lens)) studio.setParams({ lens });
        return;
      }
      if (name === 'set_zoom' && (input.z === 0 || input.z === 1 || input.z === 2)) {
        studio.setParams({ z: String(input.z) });
        return;
      }
    },
    [router, studio],
  );

  const send = useCallback(
    async (text: string, context: AssistantPageContext | null) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'streaming') return;

      const assistantId = `m-${safeRandomUUID()}`;
      setMessages((prev) => [
        ...prev,
        { id: `m-${safeRandomUUID()}`, role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ]);
      setStatus('streaming');
      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: (m: AssistantMessage) => AssistantMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? patch(m) : m)));

      try {
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: trimmed,
            context: context
              ? {
                  page: context.page,
                  station: context.station ?? null,
                  mode: context.mode ?? null,
                  selection: context.selection ?? null,
                  skill: context.skill ?? null,
                }
              : null,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.detail || detail?.error || `assistant request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buffer);
          buffer = rest;
          for (const { event, data } of events) {
            const payload = JSON.parse(data) as Record<string, unknown>;
            if (event === 'delta' && typeof payload.text === 'string') {
              patchAssistant((m) => ({ ...m, content: m.content + payload.text }));
            } else if (event === 'tool') {
              setActiveTool(payload.status === 'start' ? String(payload.name) : null);
            } else if (event === 'ui_tool') {
              runUiTool(String(payload.name), (payload.input ?? {}) as Record<string, unknown>);
            } else if (event === 'error') {
              patchAssistant((m) => ({
                ...m,
                error: true,
                content: m.content || String(payload.message ?? 'The assistant hit an error.'),
              }));
            }
          }
        }
        patchAssistant((m) => ({ ...m, streaming: false }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The assistant is unavailable.';
        patchAssistant((m) => ({ ...m, streaming: false, error: true, content: m.content || message }));
      } finally {
        setActiveTool(null);
        setStatus('idle');
        abortRef.current = null;
      }
    },
    [router, runUiTool, sessionId, status],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(`asst-${safeRandomUUID()}`);
    setStatus('idle');
    setActiveTool(null);
  }, []);

  return { sessionId, messages, status, activeTool, send, reset };
}
