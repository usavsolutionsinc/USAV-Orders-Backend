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
          <h1 className="mb-2 mt-4 text-base font-bold text-gray-900">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-3 text-sm font-bold text-gray-900">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-3 text-sm font-semibold text-gray-900">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-2 text-label leading-6 text-gray-800">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-gray-700">{children}</em>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 ml-4 list-disc space-y-1 text-label leading-6 text-gray-800">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 ml-4 list-decimal space-y-1 text-label leading-6 text-gray-800">{children}</ol>
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
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-caption font-mono text-gray-800" {...props}>
              {children}
            </code>
          );
        },
        // CodeBlock renders its own <pre>; pass through so we don't double-wrap.
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-gray-300 pl-3 text-label italic text-gray-600">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full border-collapse border border-gray-200 text-caption">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-50">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-200 px-2 py-1.5 text-gray-800">{children}</td>
        ),
        hr: () => <hr className="my-3 border-gray-200" />,
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
