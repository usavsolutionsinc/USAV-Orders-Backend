'use client';

import type { SyncStreamEvent } from '@/lib/orders-sync/types';

/**
 * Fetches an NDJSON endpoint and invokes `onEvent` for each parsed event.
 *
 * Each line of the response body is one JSON-encoded event. The server keeps
 * the connection open until the job finishes, so events arrive incrementally —
 * this lets the UI update per phase / per row without waiting for the whole job
 * to complete.
 *
 * Defaults to the orders-sync `SyncStreamEvent` contract but is generic so
 * other feeds (e.g. carrier-sync) can reuse it with their own event union;
 * transport-level failures are surfaced as a `{ type: 'error', error }` line,
 * which every such union includes.
 */
export async function streamNdjson<T = SyncStreamEvent>(
  url: string,
  init: RequestInit,
  onEvent: (event: T) => void,
): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok || !response.body) {
    // Surface server-side errors as a single `error` event so callers don't
    // need to special-case non-streaming failures.
    let text = '';
    try {
      text = await response.text();
    } catch {
      // ignore
    }
    onEvent({ type: 'error', error: text || `HTTP ${response.status}` } as T);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as T);
        } catch {
          // Malformed line — surface as an error event but keep reading so a
          // single bad line doesn't kill the rest of the stream.
          onEvent({ type: 'error', error: `Malformed sync event: ${line.slice(0, 120)}` } as T);
        }
      }
      newlineIdx = buffer.indexOf('\n');
    }
  }

  // Flush trailing partial line, if any.
  const trailing = buffer.trim();
  if (trailing) {
    try {
      onEvent(JSON.parse(trailing) as T);
    } catch {
      onEvent({ type: 'error', error: `Malformed trailing sync event` } as T);
    }
  }
}
