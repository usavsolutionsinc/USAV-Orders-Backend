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
    variant?: 'default' | 'sheet';
}

export function DataTable<T>({ data, columns, keyField, emptyMessage = 'No data found.', variant = 'default' }: DataTableProps<T>) {
    const isSheet = variant === 'sheet';

    return (
        <div className={`overflow-x-auto ${isSheet ? 'border border-gray-400' : 'border border-gray-300'}`}>
            <table className={`w-full text-left border-collapse ${isSheet ? 'text-[10px]' : 'text-xs'}`}>
                <thead className="bg-[#0a192f] text-white">
                    <tr>
                        {columns.map((col, idx) => (
                            <th
                                key={idx}
                                className={`font-semibold ${col.headerClassName || ''} ${isSheet
                                        ? 'p-1 border border-gray-500'
                                        : 'p-2 border-r border-gray-600'
                                    }`}
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
                                className={`transition-colors ${isSheet
                                        ? 'hover:bg-blue-100 even:bg-white odd:bg-gray-50'
                                        : 'hover:bg-blue-50 even:bg-gray-50'
                                    }`}
                            >
                                {columns.map((col, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className={`whitespace-nowrap ${col.className || ''} ${isSheet
                                                ? 'p-1 border border-gray-300'
                                                : 'p-2 border-r border-gray-200'
                                            }`}
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
