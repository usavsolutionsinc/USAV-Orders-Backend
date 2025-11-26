import React from 'react';

interface Column<T> {
    header: string;
    accessor: keyof T | ((item: T) => React.ReactNode);
    className?: string;
    headerClassName?: string;
}

interface DataTableProps<T> {
    data: T[];
    columns: Column<T>[];
    keyField: keyof T;
    emptyMessage?: string;
}

export function DataTable<T>({ data, columns, keyField, emptyMessage = 'No data found.' }: DataTableProps<T>) {
    return (
        <div className="overflow-x-auto border border-gray-300">
            <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#0a192f] text-white">
                    <tr>
                        {columns.map((col, idx) => (
                            <th
                                key={idx}
                                className={`p-2 border-r border-gray-600 font-semibold ${col.headerClassName || ''}`}
                            >
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {data.length === 0 ? (
                        <tr>
                            <td colSpan={columns.length} className="p-4 text-center text-gray-500">
                                {emptyMessage}
                            </td>
                        </tr>
                    ) : (
                        data.map((item, rowIdx) => (
                            <tr
                                key={String(item[keyField]) || rowIdx}
                                className="hover:bg-blue-50 transition-colors even:bg-gray-50"
                            >
                                {columns.map((col, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className={`p-2 border-r border-gray-200 whitespace-nowrap ${col.className || ''}`}
                                    >
                                        {typeof col.accessor === 'function'
                                            ? col.accessor(item)
                                            : (item[col.accessor] as React.ReactNode)}
                                    </td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
