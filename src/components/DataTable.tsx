import React, { useState, useRef, useEffect, useCallback } from 'react';
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
    onCellUpdate?: (rowIndex: number, colKey: string, value: string) => void; // Callback for cell updates
}

type EditingCell = { rowIndex: number; colKey: string } | null;

export function DataTable<T>({ 
    data, 
    columns, 
    keyField, 
    emptyMessage = 'No data found.', 
    variant = 'sheet',
    tableName = 'default',
    showColumnManager = false,
    onColumnConfigChange,
    onCellUpdate
}: DataTableProps<T>) {
    const isSheet = variant === 'sheet';
    const [showManager, setShowManager] = useState(false);
    const [editingHeader, setEditingHeader] = useState<string | null>(null);
    const [editHeaderValue, setEditHeaderValue] = useState('');
    const [editingCell, setEditingCell] = useState<EditingCell>(null);
    const [editCellValue, setEditCellValue] = useState('');
    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const [selectedCell, setSelectedCell] = useState<EditingCell>(null);
    const tableRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Get total columns for column manager
    const totalColumns = columns.length;
    const { 
        columnConfig, 
        toggleColumnVisibility, 
        updateColumnNickname,
        updateColumnWidth,
        setSortDirection,
        toggleOverflow,
        toggleBold,
        toggleLock,
        getColumnHeader, 
        isColumnVisible,
        getColumnWidth
    } = useColumnManager(tableName, totalColumns);

    // Filter visible columns - preserve original index for colKey
    const visibleColumns = columns
        .map((col, idx) => ({ col, originalIdx: idx }))
        .filter(({ col, originalIdx }) => {
            if (!col.colKey) return true; // Always show columns without colKey (e.g., action buttons)
            return isColumnVisible(col.colKey);
        })
        .map(({ col, originalIdx }) => ({ ...col, _originalIdx: originalIdx }));

    // Sort data based on column sort direction
    const sortedData = React.useMemo(() => {
        const sorted = [...data];
        const sortCol = Object.entries(columnConfig).find(([_, config]) => config.sortDirection);
        if (sortCol) {
            const [colKey, config] = sortCol;
            const col = visibleColumns.find(c => c.colKey === colKey);
            if (col && config.sortDirection) {
                sorted.sort((a, b) => {
                    const aVal = typeof col.accessor === 'function' 
                        ? String(col.accessor(a) || '')
                        : String((a[col.accessor as keyof T] as any) || '');
                    const bVal = typeof col.accessor === 'function'
                        ? String(col.accessor(b) || '')
                        : String((b[col.accessor as keyof T] as any) || '');
                    
                    // Try to parse as date
                    const aDate = new Date(aVal);
                    const bDate = new Date(bVal);
                    const isDate = !isNaN(aDate.getTime()) && !isNaN(bDate.getTime());
                    
                    if (isDate) {
                        return config.sortDirection === 'asc' 
                            ? aDate.getTime() - bDate.getTime()
                            : bDate.getTime() - aDate.getTime();
                    }
                    
                    return config.sortDirection === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                });
            }
        }
        return sorted;
    }, [data, columnConfig, visibleColumns]);

    // Notify parent of config changes
    React.useEffect(() => {
        if (onColumnConfigChange) {
            onColumnConfigChange(columnConfig);
        }
    }, [columnConfig, onColumnConfigChange]);

    // Handle header edit
    const handleEditHeader = (colKey: string, currentNickname: string) => {
        setEditingHeader(colKey);
        setEditHeaderValue(currentNickname);
    };

    const handleSaveHeader = (colKey: string) => {
        updateColumnNickname(colKey, editHeaderValue || colKey);
        setEditingHeader(null);
        setEditHeaderValue('');
    };

    // Handle cell edit
    const handleCellClick = (rowIndex: number, colKey: string, currentValue: string, startEditing: boolean = true) => {
        const config = columnConfig[colKey];
        if (config?.locked) {
            // Copy to clipboard for locked cells
            navigator.clipboard.writeText(String(currentValue || ''));
            setSelectedCell({ rowIndex, colKey });
            return;
        }
        setSelectedCell({ rowIndex, colKey });
        if (startEditing) {
            setEditingCell({ rowIndex, colKey });
            setEditCellValue(String(currentValue || ''));
        }
    };

    const handleSaveCell = (rowIndex: number, colKey: string) => {
        if (onCellUpdate) {
            onCellUpdate(rowIndex, colKey, editCellValue);
        }
        setEditingCell(null);
        setEditCellValue('');
    };

    // Arrow key navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!selectedCell) return;
            
            const currentColIndex = visibleColumns.findIndex(c => c.colKey === selectedCell.colKey);
            if (currentColIndex === -1) return;

            let newRowIndex = selectedCell.rowIndex;
            let newColIndex = currentColIndex;

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    newRowIndex = Math.max(0, selectedCell.rowIndex - 1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    newRowIndex = Math.min(sortedData.length - 1, selectedCell.rowIndex + 1);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    newColIndex = Math.max(0, currentColIndex - 1);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    newColIndex = Math.min(visibleColumns.length - 1, currentColIndex + 1);
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (selectedCell) {
                        const col = visibleColumns.find(c => c.colKey === selectedCell.colKey);
                        if (col?.colKey) {
                            const item = sortedData[selectedCell.rowIndex];
                            const value = typeof col.accessor === 'function'
                                ? String(col.accessor(item) || '')
                                : String((item[col.accessor as keyof T] as any) || '');
                            setEditingCell({ rowIndex: selectedCell.rowIndex, colKey: col.colKey });
                            setEditCellValue(value);
                        }
                    }
                    return;
                default:
                    return;
            }

            const newCol = visibleColumns[newColIndex];
            if (newCol?.colKey) {
                setSelectedCell({ rowIndex: newRowIndex, colKey: newCol.colKey });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedCell, visibleColumns, sortedData]);

    // Focus input when editing
    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingCell]);

    // Column resize handlers
    const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
        e.preventDefault();
        setResizingCol(colKey);
        setResizeStartX(e.clientX);
        setResizeStartWidth(getColumnWidth(colKey));
    };

    useEffect(() => {
        const handleResize = (e: MouseEvent) => {
            if (!resizingCol) return;
            const diff = e.clientX - resizeStartX;
            const newWidth = Math.max(50, resizeStartWidth + diff);
            updateColumnWidth(resizingCol, newWidth);
        };

        const handleResizeEnd = () => {
            setResizingCol(null);
        };

        if (resizingCol) {
            window.addEventListener('mousemove', handleResize);
            window.addEventListener('mouseup', handleResizeEnd);
            return () => {
                window.removeEventListener('mousemove', handleResize);
                window.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [resizingCol, resizeStartX, resizeStartWidth, updateColumnWidth, getColumnWidth]);

    const getCellValue = (item: T, col: Column<T>): string => {
        if (typeof col.accessor === 'function') {
            const result = col.accessor(item);
            return result ? String(result) : '';
        }
        return String((item[col.accessor as keyof T] as any) || '');
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
                <div className="mb-4 p-4 bg-gray-50 border border-gray-300 rounded max-h-96 overflow-y-auto">
                    <h3 className="font-bold mb-3 text-sm">Column Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {columns.map((col, idx) => {
                            const colKey = col.colKey || `col_${idx + 1}`;
                            const config = columnConfig[colKey] || { visible: true, nickname: colKey, width: 120, overflow: 'visible', bold: false, locked: false };
                            const isEditing = editingHeader === colKey;

                            return (
                                <div key={colKey} className="p-3 bg-white rounded border">
                                    <div className="flex items-center gap-2 mb-2">
                                        <input
                                            type="checkbox"
                                            checked={config.visible !== false}
                                            onChange={() => toggleColumnVisibility(colKey)}
                                            className="cursor-pointer"
                                        />
                                        <div className="flex-1 min-w-0">
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={editHeaderValue}
                                                    onChange={(e) => setEditHeaderValue(e.target.value)}
                                                    onBlur={() => handleSaveHeader(colKey)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            handleSaveHeader(colKey);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingHeader(null);
                                                            setEditHeaderValue('');
                                                        }
                                                    }}
                                                    className="text-xs px-1 py-0.5 border rounded w-full"
                                                    autoFocus
                                                />
                                            ) : (
                                                <span
                                                    className="text-xs cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded"
                                                    onClick={() => handleEditHeader(colKey, config.nickname || colKey)}
                                                    title="Click to edit"
                                                >
                                                    {config.nickname || colKey}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <button
                                            onClick={() => setSortDirection(colKey, config.sortDirection === 'asc' ? 'desc' : config.sortDirection === 'desc' ? null : 'asc')}
                                            className={`px-2 py-1 rounded ${config.sortDirection ? 'bg-blue-200' : 'bg-gray-100'} hover:bg-gray-200`}
                                            title="Sort"
                                        >
                                            Sort {config.sortDirection === 'asc' ? '↑' : config.sortDirection === 'desc' ? '↓' : ''}
                                        </button>
                                        <button
                                            onClick={() => toggleOverflow(colKey)}
                                            className={`px-2 py-1 rounded ${config.overflow === 'hidden' ? 'bg-blue-200' : 'bg-gray-100'} hover:bg-gray-200`}
                                            title="Overflow"
                                        >
                                            {config.overflow === 'hidden' ? 'Hidden' : 'Visible'}
                                        </button>
                                        <button
                                            onClick={() => toggleBold(colKey)}
                                            className={`px-2 py-1 rounded ${config.bold ? 'bg-blue-200' : 'bg-gray-100'} hover:bg-gray-200`}
                                            title="Bold"
                                        >
                                            <strong>B</strong>
                                        </button>
                                        <button
                                            onClick={() => toggleLock(colKey)}
                                            className={`px-2 py-1 rounded ${config.locked ? 'bg-blue-200' : 'bg-gray-100'} hover:bg-gray-200`}
                                            title="Lock (Copy on click)"
                                        >
                                            🔒
                                        </button>
                                        <div className="text-xs text-gray-600">
                                            W: {config.width || 120}px
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div 
                ref={tableRef}
                className={`overflow-x-auto overflow-y-auto ${isSheet ? 'border border-gray-400' : 'border border-gray-300'}`}
                style={{ maxHeight: 'calc(100vh - 200px)' }}
            >
                <table className={`w-full text-left border-collapse ${isSheet ? 'text-[10px]' : 'text-xs'}`} style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-[#0a192f] text-white sticky top-0 z-10">
                        <tr>
                            {visibleColumns.map((col, idx) => {
                                const originalIdx = (col as any)._originalIdx ?? idx;
                                const colKey = col.colKey || `col_${originalIdx + 1}`;
                                const header = col.colKey ? getColumnHeader(colKey) : col.header;
                                const width = col.colKey ? getColumnWidth(colKey) : 120;
                                const config = columnConfig[colKey] || {};
                                const isEditing = editingHeader === colKey;

                                return (
                                    <th
                                        key={idx}
                                        style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                        className={`font-semibold ${col.headerClassName || ''} ${isSheet ? 'p-0.5 border border-gray-500' : 'p-2 border-r border-gray-600'} relative`}
                                    >
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={editHeaderValue}
                                                onChange={(e) => setEditHeaderValue(e.target.value)}
                                                onBlur={() => handleSaveHeader(colKey)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        handleSaveHeader(colKey);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingHeader(null);
                                                        setEditHeaderValue('');
                                                    }
                                                }}
                                                className="w-full h-full px-0.5 text-[10px] bg-white text-black border-none outline-none"
                                                autoFocus
                                            />
                                        ) : (
                                            <div 
                                                className="cursor-pointer hover:bg-[#112240] px-0.5"
                                                onClick={() => handleEditHeader(colKey, header)}
                                                title="Click to edit"
                                            >
                                                {header}
                                            </div>
                                        )}
                                        {col.colKey && (
                                            <div
                                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400"
                                                onMouseDown={(e) => handleResizeStart(e, colKey)}
                                            />
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {sortedData.length === 0 ? (
                            <tr>
                                <td colSpan={visibleColumns.length} className="p-2 text-center text-gray-500">
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            sortedData.map((item, rowIdx) => (
                                <tr
                                    key={String(item[keyField]) || rowIdx}
                                    className={`transition-colors ${isSheet ? 'hover:bg-blue-100 even:bg-white odd:bg-gray-50' : 'hover:bg-blue-50 even:bg-gray-50'}`}
                                >
                                    {visibleColumns.map((col, colIdx) => {
                                        const originalIdx = (col as any)._originalIdx ?? colIdx;
                                        const colKey = col.colKey || `col_${originalIdx + 1}`;
                                        const width = col.colKey ? getColumnWidth(colKey) : 120;
                                        const config = columnConfig[colKey] || {};
                                        const isEditing = editingCell?.rowIndex === rowIdx && editingCell?.colKey === colKey;
                                        const isSelected = selectedCell?.rowIndex === rowIdx && selectedCell?.colKey === colKey;
                                        const cellValue = getCellValue(item, col);

                                        return (
                                            <td
                                                key={colIdx}
                                                style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                                                className={`${col.className || ''} ${isSheet ? 'p-0.5 border border-gray-300' : 'p-2 border-r border-gray-200'} ${isSelected ? 'ring-2 ring-blue-500' : ''} ${config.locked ? 'bg-gray-100 cursor-copy' : 'cursor-cell'}`}
                                                onClick={() => {
                                                    handleCellClick(rowIdx, colKey, cellValue, true);
                                                }}
                                                title={config.locked ? 'Click to copy' : 'Click to edit'}
                                            >
                                                {isEditing ? (
                                                    <input
                                                        ref={inputRef}
                                                        type="text"
                                                        value={editCellValue}
                                                        onChange={(e) => setEditCellValue(e.target.value)}
                                                        onBlur={() => handleSaveCell(rowIdx, colKey)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                handleSaveCell(rowIdx, colKey);
                                                            } else if (e.key === 'Escape') {
                                                                setEditingCell(null);
                                                                setEditCellValue('');
                                                            }
                                                        }}
                                                        className="w-full h-full px-0.5 text-[10px] border-none outline-none bg-yellow-100"
                                                        style={{ width: '100%', minWidth: '100%' }}
                                                    />
                                                ) : (
                                                    <div
                                                        className={`px-0.5 ${config.overflow === 'hidden' ? 'overflow-hidden text-ellipsis whitespace-nowrap' : 'whitespace-normal break-words'} ${config.bold ? 'font-bold' : ''}`}
                                                        style={{ fontSize: '10px' }}
                                                    >
                                                        {cellValue}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
