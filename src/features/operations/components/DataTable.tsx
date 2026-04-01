'use client';

import React from 'react';

interface Column<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  className?: string;
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  title: string;
  subtitle?: string;
  isLoading?: boolean;
}

export function DataTable<T extends { id: string | number }>({
  data,
  columns,
  title,
  subtitle,
  isLoading
}: DataTableProps<T>) {
  return (
    <div className="bg-white border border-slate-200 rounded-sm overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/30 flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.1em]">{title}</h3>
          {subtitle && <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{subtitle}</span>}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-left border-collapse table-fixed">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(226,232,240,1)]">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  style={{ width: col.width }}
                  className={`px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest ${col.className || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, idx) => (
                <tr key={idx} className="animate-pulse">
                  {columns.map((_, colIdx) => (
                    <td key={colIdx} className="px-4 py-3">
                      <div className="h-3 bg-slate-100 w-3/4 rounded-sm" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                  No records found
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                  {columns.map((col, idx) => (
                    <td
                      key={idx}
                      className={`px-4 py-2.5 text-[13px] font-medium text-slate-700 tabular-nums align-bottom ${col.className || ''}`}
                    >
                      <div className="pb-0.5 border-b border-transparent group-hover:border-slate-100 transition-colors">
                        {typeof col.accessor === 'function'
                          ? col.accessor(item)
                          : (item[col.accessor] as React.ReactNode)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
