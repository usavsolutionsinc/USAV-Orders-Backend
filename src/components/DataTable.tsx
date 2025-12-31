import React, { useState } from 'react';
import { useColumnManager, ColumnManagerState } from '@/hooks/useColumnManager';

interface Column<T> {
    header: string;
    accessor: keyof T | string | ((item: T) => React.ReactNode);
    className?: string;
    headerClassName?: string;
    colKey?: string; // e.g., "col_1", "col_2" - used for column management
}

interface DataTableProps<T> {
    data: T[];
    columns: Column<T>[];
    keyField: keyof T;
    emptyMessage?: string;
    variant?: 'default' | 'sheet';
    tableName?: string; // Used for column config storage
    showColumnManager?: boolean; // Show column visibility/nickname controls
    onColumnConfigChange?: (config: ColumnManagerState) => void; // Optional callback
}

export function DataTable<T>({ 
    data, 
    columns, 
    keyField, 
    emptyMessage = 'No data found.', 
    variant = 'default',
    tableName = 'default',
    showColumnManager = false,
    onColumnConfigChange
}: DataTableProps<T>) {
    const isSheet = variant === 'sheet';
    const [showManager, setShowManager] = useState(false);
    const [editingCol, setEditingCol] = useState<string | null>(null);
    const [editNickname, setEditNickname] = useState('');

    // Get total columns for column manager
    const totalColumns = columns.length;
    const { 
        columnConfig, 
        toggleColumnVisibility, 
        updateColumnNickname, 
        getColumnHeader, 
        isColumnVisible 
    } = useColumnManager(tableName, totalColumns);

    // Notify parent of config changes
    React.useEffect(() => {
        if (onColumnConfigChange) {
            onColumnConfigChange(columnConfig);
        }
    }, [columnConfig, onColumnConfigChange]);

    // Filter visible columns - preserve original index for colKey
    // Columns without colKey (like action buttons) are always visible
    const visibleColumns = columns
        .map((col, idx) => ({ col, originalIdx: idx }))
        .filter(({ col, originalIdx }) => {
            if (!col.colKey) return true; // Always show columns without colKey (e.g., action buttons)
            return isColumnVisible(col.colKey);
        })
        .map(({ col, originalIdx }) => ({ ...col, _originalIdx: originalIdx }));

    const handleEditNickname = (colKey: string, currentNickname: string) => {
        setEditingCol(colKey);
        setEditNickname(currentNickname);
    };

    const handleSaveNickname = (colKey: string) => {
        updateColumnNickname(colKey, editNickname || colKey);
        setEditingCol(null);
        setEditNickname('');
    };

    return (
        <div className="relative">
            {showColumnManager && (
                <div className="mb-2 flex items-center justify-between">
                    <button
                        onClick={() => setShowManager(!showManager)}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                    >
                        {showManager ? 'Hide' : 'Show'} Column Settings
                    </button>
                </div>
            )}

            {showColumnManager && showManager && (
                <div className="mb-4 p-4 bg-gray-50 border border-gray-300 rounded">
                    <h3 className="font-bold mb-3 text-sm">Column Settings</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {columns.map((col, idx) => {
                            const colKey = col.colKey || `col_${idx + 1}`;
                            const visible = isColumnVisible(colKey);
                            const nickname = getColumnHeader(colKey);
                            const isEditing = editingCol === colKey;

                            return (
                                <div key={colKey} className="flex items-center gap-2 p-2 bg-white rounded border">
                                    <input
                                        type="checkbox"
                                        checked={visible}
                                        onChange={() => toggleColumnVisibility(colKey)}
                                        className="cursor-pointer"
                                    />
                                    <div className="flex-1 min-w-0">
                                        {isEditing ? (
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    value={editNickname}
                                                    onChange={(e) => setEditNickname(e.target.value)}
                                                    onBlur={() => handleSaveNickname(colKey)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            handleSaveNickname(colKey);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingCol(null);
                                                            setEditNickname('');
                                                        }
                                                    }}
                                                    className="text-xs px-1 py-0.5 border rounded w-full"
                                                    autoFocus
                                                />
                                            </div>
                                        ) : (
                                            <span
                                                className="text-xs cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded"
                                                onClick={() => handleEditNickname(colKey, nickname)}
                                                title="Click to edit nickname"
                                            >
                                                {nickname}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className={`overflow-x-auto ${isSheet ? 'border border-gray-400' : 'border border-gray-300'}`}>
                <table className={`w-full text-left border-collapse ${isSheet ? 'text-[10px]' : 'text-xs'}`}>
                    <thead className="bg-[#0a192f] text-white">
                        <tr>
                            {visibleColumns.map((col, idx) => {
                                const originalIdx = (col as any)._originalIdx ?? idx;
                                const colKey = col.colKey || `col_${originalIdx + 1}`;
                                const header = col.colKey ? getColumnHeader(colKey) : col.header;
                                return (
                                    <th
                                        key={idx}
                                        className={`font-semibold ${col.headerClassName || ''} ${isSheet
                                                ? 'p-1 border border-gray-500'
                                                : 'p-2 border-r border-gray-600'
                                            }`}
                                    >
                                        {header}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={visibleColumns.length} className="p-4 text-center text-gray-500">
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
                                    {visibleColumns.map((col, colIdx) => (
                                        <td
                                            key={colIdx}
                                            className={`whitespace-nowrap ${col.className || ''} ${isSheet
                                                    ? 'p-1 border border-gray-300'
                                                    : 'p-2 border-r border-gray-200'
                                                }`}
                                        >
                                            {typeof col.accessor === 'function'
                                                ? col.accessor(item)
                                                : (item[col.accessor as keyof T] as React.ReactNode)}
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
