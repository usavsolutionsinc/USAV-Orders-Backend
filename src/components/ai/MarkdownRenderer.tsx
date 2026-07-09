'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from '@/components/ai/CodeBlock';

/**
 * Renders AI response markdown with correct bold, italic, lists, code,
 * and table formatting for employee-facing chat. Fenced code blocks are
 * syntax-highlighted (rehype-highlight) and wrapped in CodeBlock chrome
 * (language label + copy). The light highlight.js theme lives in globals.css.
 */
export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-2 mt-4 text-base font-bold text-text-default">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-3 text-sm font-bold text-text-default">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-3 text-sm font-semibold text-text-default">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-2 text-label leading-6 text-text-default">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-text-default">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-text-muted">{children}</em>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 ml-4 list-disc space-y-1 text-label leading-6 text-text-default">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 ml-4 list-decimal space-y-1 text-label leading-6 text-text-default">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="pl-1">{children}</li>
        ),
        code: ({ className, children, ...props }) => {
          const cls = className ?? '';
          // rehype-highlight tags fenced blocks with `hljs` + `language-x`;
          // inline code (single backticks) carries neither.
          const isBlock = /(^|\s)(hljs|language-)/.test(cls);
          if (isBlock) {
            const language = /language-([\w-]+)/.exec(cls)?.[1] ?? '';
            return <CodeBlock language={language}>{children}</CodeBlock>;
          }
          return (
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-caption font-mono text-text-default" {...props}>
              {children}
            </code>
          );
        },
        // CodeBlock renders its own <pre>; pass through so we don't double-wrap.
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-border-default pl-3 text-label italic text-text-muted">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full border-collapse border border-border-soft text-caption">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-surface-canvas">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border border-border-soft px-2 py-1.5 text-left font-semibold text-text-muted">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-border-soft px-2 py-1.5 text-text-default">{children}</td>
        ),
        hr: () => <hr className="my-3 border-border-soft" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
