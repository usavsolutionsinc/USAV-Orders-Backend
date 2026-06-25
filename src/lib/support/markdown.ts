/**
 * Lightweight, dependency-free inline markdown for the support console.
 *
 * Supports the small grammar staff actually use in replies/notes:
 *   **bold**   *italic*   `code`   bare URLs (autolinked)   line breaks.
 *
 * Two outputs from one grammar:
 *   - `renderInlineMarkdown(text)` → safe React nodes for the chat thread.
 *   - `markdownToHtml(text)`       → sanitized HTML string for the Zendesk
 *                                    `html_body` so the customer's email is formatted.
 *
 * Both escape first, then tokenize — there is no `dangerouslySetInnerHTML` and no
 * user input ever reaches the DOM/HTML un-escaped.
 */

import React from 'react';

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; value: string };

// Order matters: code first (so ** inside `code` is literal), then bold before
// italic (so ** isn't eaten as two * ), then autolinked URLs.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g;

/** Split one line of source text into typed inline tokens. */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: line.slice(last, m.index) });
    if (m[1]) tokens.push({ kind: 'code', value: m[1].slice(1, -1) });
    else if (m[2]) tokens.push({ kind: 'bold', value: m[2].slice(2, -2) });
    else if (m[3]) tokens.push({ kind: 'italic', value: m[3].slice(1, -1) });
    else if (m[4]) tokens.push({ kind: 'link', value: m[4] });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ kind: 'text', value: line.slice(last) });
  return tokens;
}

function linkHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Render inline markdown to safe React nodes (used in the chat thread). */
export function renderInlineMarkdown(text: string): React.ReactNode {
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.map((line, li) => {
    const nodes = tokenizeLine(line).map((t, ti) => {
      const key = `${li}-${ti}`;
      switch (t.kind) {
        case 'bold':
          return React.createElement('strong', { key }, t.value);
        case 'italic':
          return React.createElement('em', { key }, t.value);
        case 'code':
          return React.createElement(
            'code',
            { key, className: 'rounded bg-black/10 px-1 py-0.5 text-[0.9em]' },
            t.value,
          );
        case 'link':
          return React.createElement(
            'a',
            {
              key,
              href: linkHref(t.value),
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'underline underline-offset-2',
            },
            t.value,
          );
        default:
          return React.createElement(React.Fragment, { key }, t.value);
      }
    });
    // Re-join lines with <br/> so blank lines and wraps survive.
    return React.createElement(
      React.Fragment,
      { key: li },
      ...nodes,
      li < lines.length - 1 ? React.createElement('br', { key: `br-${li}` }) : null,
    );
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render inline markdown to a sanitized HTML string (used for Zendesk html_body). */
export function markdownToHtml(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/);
  const htmlLines = lines.map((line) =>
    tokenizeLine(line)
      .map((t) => {
        switch (t.kind) {
          case 'bold':
            return `<strong>${escapeHtml(t.value)}</strong>`;
          case 'italic':
            return `<em>${escapeHtml(t.value)}</em>`;
          case 'code':
            return `<code>${escapeHtml(t.value)}</code>`;
          case 'link': {
            const href = escapeHtml(linkHref(t.value));
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.value)}</a>`;
          }
          default:
            return escapeHtml(t.value);
        }
      })
      .join(''),
  );
  return htmlLines.join('<br>');
}
