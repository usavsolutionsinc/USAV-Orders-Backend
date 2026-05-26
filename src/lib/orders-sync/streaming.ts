import type { SyncStreamEvent } from '@/lib/orders-sync/types';

const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

interface NdjsonStreamHandle {
  body: ReadableStream<Uint8Array>;
  emit: (event: SyncStreamEvent) => void;
  finish: () => void;
  fail: (error: unknown) => void;
}

/**
 * Returns a ReadableStream that emits NDJSON-encoded `SyncStreamEvent`s plus a
 * pair of helpers (`emit`, `finish`) for the job to push events into. The
 * stream stays open until `finish()` or `fail()` is called.
 */
export function createNdjsonStream(): NdjsonStreamHandle {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      closed = true;
      controllerRef = null;
    },
  });

  const emit = (event: SyncStreamEvent) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
    } catch {
      // Stream may have been closed by the consumer (browser tab navigation,
      // abort). Mark closed so we stop trying to write.
      closed = true;
    }
  };

  const finish = () => {
    if (closed || !controllerRef) return;
    closed = true;
    try {
      controllerRef.close();
    } catch {
      // ignore double-close
    }
    controllerRef = null;
  };

  const fail = (error: unknown) => {
    if (!closed && controllerRef) {
      try {
        controllerRef.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'error', error: String((error as any)?.message || error) } satisfies SyncStreamEvent) + '\n',
          ),
        );
      } catch {
        // ignore
      }
    }
    finish();
  };

  return { body, emit, finish, fail };
}

export function ndjsonResponseHeaders(): HeadersInit {
  return {
    'Content-Type': NDJSON_CONTENT_TYPE,
    // Prevent Vercel / proxy buffering so events flush row-by-row.
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  };
}
