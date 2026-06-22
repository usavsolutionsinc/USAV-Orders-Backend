import { useEffect, useRef, useState } from 'react';
import { formatDateTimePST } from '@/utils/date';
import type { TriageDetail } from '@/components/po-triage/types';
import { Row } from './details-primitives';

export function EmailTab({ detail }: { detail: TriageDetail }) {
  const { html, text, error } = detail.body;
  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-label">
        <Row label="From" value={detail.row.email_from ?? '—'} />
        <Row label="Subject" value={detail.row.email_subject ?? '—'} />
        <Row
          label="Received"
          value={
            detail.row.email_received
              ? formatDateTimePST(detail.row.email_received)
              : '—'
          }
        />
        {detail.body.hasAttachments && (
          <Row label="Attachments" value="present (see Gmail)" />
        )}
      </dl>
      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-caption text-amber-800">
          {error}
        </div>
      ) : html ? (
        <EmailHtmlFrame html={html} />
      ) : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <pre className="whitespace-pre-wrap break-words font-sans text-caption leading-relaxed text-gray-700">
            {text || '(empty body)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// Sandboxed iframe that renders the DOMPurify-sanitized email HTML. The
// iframe sandbox attribute (no allow-scripts, no allow-same-origin) keeps
// any residual inline content isolated from the host app. The iframe
// auto-sizes to its content so the email reads as a flowing block inside
// the details panel instead of a fixed-height scrollbox.
function EmailHtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(320);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
        `<style>` +
        `html,body{margin:0;padding:0;background:transparent;color:#1f2937;` +
        `font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
        `word-wrap:break-word;overflow-wrap:anywhere;}` +
        `img{max-width:100%;height:auto;}` +
        `table{max-width:100%;border-collapse:collapse;}` +
        `a{color:#2563eb;}` +
        `</style></head><body>${html}</body></html>`,
    );
    doc.close();

    const resize = () => {
      const next = doc.documentElement?.scrollHeight ?? doc.body?.scrollHeight ?? 0;
      if (next > 0) setHeight(next + 16);
    };
    resize();
    // Late-loading images change layout — observe and resize once they paint.
    const observer = new ResizeObserver(resize);
    if (doc.body) observer.observe(doc.body);
    return () => observer.disconnect();
  }, [html]);

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <iframe
        ref={ref}
        sandbox=""
        title="Email body"
        className="block w-full"
        style={{ height, border: 'none' }}
      />
    </div>
  );
}
