'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders AI response markdown with correct bold, italic, lists, code,
 * and table formatting for employee-facing chat.
 */
export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-2 mt-4 text-[15px] font-bold text-gray-900">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-3 text-[14px] font-bold text-gray-900">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-3 text-[13px] font-semibold text-gray-900">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-2 text-[12px] leading-6 text-gray-800">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-gray-700">{children}</em>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 ml-4 list-disc space-y-1 text-[12px] leading-6 text-gray-800">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 ml-4 list-decimal space-y-1 text-[12px] leading-6 text-gray-800">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="pl-1">{children}</li>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <code
                className={`block overflow-x-auto rounded bg-gray-900 px-3 py-2 text-[11px] leading-5 text-gray-100 ${className ?? ''}`}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-800" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-2 mt-1 overflow-x-auto rounded border border-gray-200 bg-gray-900">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-gray-300 pl-3 text-[12px] italic text-gray-600">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full border-collapse border border-gray-200 text-[11px]">{children}</table>
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
