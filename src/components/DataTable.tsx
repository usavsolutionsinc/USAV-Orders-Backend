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
    const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
    const [editingHeader, setEditingHeader] = useState<string | null>(null);
    const [editHeaderValue, setEditHeaderValue] = useState('');
    const [editingCell, setEditingCell] = useState<EditingCell>(null);
    const [editCellValue, setEditCellValue] = useState('');
    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const [selectedCell, setSelectedCell] = useState<EditingCell>(null);
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'today+before' | 'today+after'>('all');
    const [dateFilterColumn, setDateFilterColumn] = useState<string | null>(null);
    const tableRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
        toggleTextWrap,
        getColumnHeader, 
        isColumnVisible,
        getColumnWidth
    } = useColumnManager(tableName, totalColumns);

    // Helper functions - defined before useMemo to avoid initialization errors
    const getCellValue = React.useCallback((item: T, col: Column<T>): string | React.ReactNode => {
        if (typeof col.accessor === 'function') {
            return col.accessor(item);
        }
        return String((item[col.accessor as keyof T] as any) || '');
    }, []);

    const getCellValueString = React.useCallback((item: T, col: Column<T>): string => {
        if (typeof col.accessor === 'function') {
            const result = col.accessor(item);
            if (React.isValidElement(result)) {
                return ''; // Don't try to edit JSX elements
            }
            return result ? String(result) : '';
        }
        return String((item[col.accessor as keyof T] as any) || '');
    }, []);

    // Filter visible columns - preserve original index for colKey
    const visibleColumns = columns
        .map((col, idx) => ({ col, originalIdx: idx }))
        .filter(({ col, originalIdx }) => {
            if (!col.colKey) return true; // Always show columns without colKey (e.g., action buttons)
            return isColumnVisible(col.colKey);
        })
        .map(({ col, originalIdx }) => ({ ...col, _originalIdx: originalIdx }));

    // Filter and sort data
    const sortedData = React.useMemo(() => {
        let filtered = [...data];
        
        // Apply date filter
        if (dateFilter !== 'all' && dateFilterColumn) {
            const col = visibleColumns.find(c => c.colKey === dateFilterColumn);
            if (col) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                
                filtered = filtered.filter(item => {
                    const colObj = (col as any).col || col;
                    const cellValue = getCellValueString(item, colObj);
                    if (!cellValue || cellValue.trim() === '') return dateFilter === 'today+before';
                    
                    const cellDate = new Date(cellValue);
                    if (isNaN(cellDate.getTime())) return dateFilter === 'today+before';
                    
                    cellDate.setHours(0, 0, 0, 0);
                    
                    switch (dateFilter) {
                        case 'today':
                            return cellDate.getTime() === today.getTime();
                        case 'today+before':
                            return cellDate.getTime() <= today.getTime();
                        case 'today+after':
                            return cellDate.getTime() >= today.getTime();
                        default:
                            return true;
                    }
                });
            }
        }
        
        // Sort data
        const sortCol = Object.entries(columnConfig).find(([_, config]) => config.sortDirection);
        if (sortCol) {
            const [colKey, config] = sortCol;
            const col = visibleColumns.find(c => c.colKey === colKey);
            if (col && config.sortDirection) {
                filtered.sort((a, b) => {
                    const colObj = (col as any).col || col;
                    const aVal = getCellValueString(a, colObj);
                    const bVal = getCellValueString(b, colObj);
                    
                    const aEmpty = !aVal || aVal.trim() === '';
                    const bEmpty = !bVal || bVal.trim() === '';
                    
                    // Empty values go to bottom
                    if (aEmpty && !bEmpty) return 1;
                    if (!aEmpty && bEmpty) return -1;
                    if (aEmpty && bEmpty) return 0;
                    
                    // Try to parse as number (for qty, etc.)
                    const aNum = parseFloat(aVal);
                    const bNum = parseFloat(bVal);
                    const aIsNum = !isNaN(aNum) && isFinite(aNum);
                    const bIsNum = !isNaN(bNum) && isFinite(bNum);
                    
                    if (aIsNum && bIsNum) {
                        return config.sortDirection === 'asc' 
                            ? aNum - bNum
                            : bNum - aNum;
                    }
                    
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
        return filtered;
    }, [data, columnConfig, visibleColumns, dateFilter, dateFilterColumn, getCellValueString]);

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

    // Auto-fit column width on double-click
    const handleAutoFitWidth = (colKey: string) => {
        const col = visibleColumns.find(c => c.colKey === colKey);
        if (!col) return;

        // Measure header width
        const headerText = getColumnHeader(colKey);
        const headerWidth = Math.max(headerText.length * 6 + 20, 20);

        // Measure all cell widths in this column
        let maxCellWidth = headerWidth;
        sortedData.forEach((item, rowIdx) => {
            const cellValue = getCellValueString(item, col);
            const cellWidth = Math.max((cellValue || '').length * 6 + 10, 20);
            maxCellWidth = Math.max(maxCellWidth, cellWidth);
        });

        // Set width with some padding, but allow very narrow columns (min 20px)
        updateColumnWidth(colKey, Math.max(20, Math.min(maxCellWidth + 10, 500)));
    };

    // Handle cell edit
    const handleCellClick = (rowIndex: number, colKey: string, currentValue: string | React.ReactNode, startEditing: boolean = true) => {
        const config = columnConfig[colKey];
        if (config?.locked) {
            // Copy to clipboard for locked cells
            navigator.clipboard.writeText(String(currentValue || ''));
            setSelectedCell({ rowIndex, colKey });
            return;
        }
        // Don't allow editing if the cell contains JSX (like buttons)
        if (React.isValidElement(currentValue)) {
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
                            const colObj = (col as any).col || col;
                            const value = getCellValueString(item, colObj);
                            // Don't allow editing JSX elements
                            if (!React.isValidElement(getCellValue(item, colObj))) {
                                setEditingCell({ rowIndex: selectedCell.rowIndex, colKey: col.colKey });
                                setEditCellValue(value);
                            }
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
        e.stopPropagation();
        setResizingCol(colKey);
        setResizeStartX(e.clientX);
        setResizeStartWidth(getColumnWidth(colKey));
    };

    useEffect(() => {
        const handleResize = (e: MouseEvent) => {
            if (!resizingCol) return;
            const diff = e.clientX - resizeStartX;
            const newWidth = Math.max(20, resizeStartWidth + diff);
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

    // Check if next column is empty for overflow behavior
    const isNextColumnEmpty = (rowIndex: number, colIndex: number): boolean => {
        if (colIndex >= visibleColumns.length - 1) return false;
        const nextCol = visibleColumns[colIndex + 1];
        if (!nextCol?.colKey) return false;
        const item = sortedData[rowIndex];
        const nextColObj = (nextCol as any).col || nextCol;
        const nextValue = getCellValueString(item, nextColObj);
        return !nextValue || nextValue.trim() === '';
    };

    const selectedConfig = selectedColumn ? columnConfig[selectedColumn] : null;

    return (
        <div className="relative flex flex-col h-full">
            {showColumnManager && (
                <div className="mb-2 flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={() => setShowManager(!showManager)}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                    >
                        {showManager ? 'Hide' : 'Show'} Column Settings
                    </button>
                    {showManager && selectedColumn && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-100 rounded text-sm">
                            <span>Editing: {getColumnHeader(selectedColumn)}</span>
                            <button
                                onClick={() => setSelectedColumn(null)}
                                className="text-gray-600 hover:text-gray-800"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>
            )}

            {showColumnManager && showManager && (
                <div className="mb-2 p-3 bg-gray-50 border border-gray-300 rounded flex-shrink-0">
                    {!selectedColumn ? (
                        <div>
                            <h3 className="font-bold mb-2 text-sm">Select a Column to Edit:</h3>
                            <div className="flex flex-wrap gap-2">
                                {columns.map((col, idx) => {
                                    const colKey = col.colKey || `col_${idx + 1}`;
                                    const config = columnConfig[colKey] || { visible: true, nickname: colKey };
                                    return (
                                        <button
                                            key={colKey}
                                            onClick={() => setSelectedColumn(colKey)}
                                            className={`px-3 py-1 rounded text-xs ${config.visible !== false ? 'bg-blue-200 hover:bg-blue-300' : 'bg-gray-200 hover:bg-gray-300'}`}
                                        >
                                            {config.nickname || colKey} {config.visible === false ? '(hidden)' : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-bold text-sm">Column Settings: {getColumnHeader(selectedColumn)}</h3>
                                <button
                                    onClick={() => setSelectedColumn(null)}
                                    className="text-gray-600 hover:text-gray-800 text-sm"
                                >
                                    Back to Column List
                                </button>
                            </div>
                            {selectedConfig && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Visibility</label>
                                        <button
                                            onClick={() => toggleColumnVisibility(selectedColumn)}
                                            className={`w-full px-2 py-1 rounded text-xs ${selectedConfig.visible !== false ? 'bg-green-200' : 'bg-red-200'}`}
                                        >
                                            {selectedConfig.visible !== false ? 'Visible' : 'Hidden'}
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Sort</label>
                                        <button
                                            onClick={() => setSortDirection(selectedColumn, selectedConfig.sortDirection === 'asc' ? 'desc' : selectedConfig.sortDirection === 'desc' ? null : 'asc')}
                                            className={`w-full px-2 py-1 rounded text-xs ${selectedConfig.sortDirection ? 'bg-blue-200' : 'bg-gray-100'}`}
                                        >
                                            {selectedConfig.sortDirection === 'asc' ? '↑ Asc' : selectedConfig.sortDirection === 'desc' ? '↓ Desc' : 'None'}
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Overflow</label>
                                        <button
                                            onClick={() => toggleOverflow(selectedColumn)}
                                            className={`w-full px-2 py-1 rounded text-xs ${selectedConfig.overflow === 'hidden' ? 'bg-blue-200' : 'bg-gray-100'}`}
                                        >
                                            {selectedConfig.overflow === 'hidden' ? 'Hidden' : 'Visible'}
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Bold</label>
                                        <button
                                            onClick={() => toggleBold(selectedColumn)}
                                            className={`w-full px-2 py-1 rounded text-xs ${selectedConfig.bold ? 'bg-blue-200' : 'bg-gray-100'}`}
                                        >
                                            <strong>B</strong>
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Lock</label>
                                        <button
                                            onClick={() => toggleLock(selectedColumn)}
                                            className={`w-full px-2 py-1 rounded text-xs ${selectedConfig.locked ? 'bg-blue-200' : 'bg-gray-100'}`}
                                        >
                                            🔒 {selectedConfig.locked ? 'Locked' : 'Unlocked'}
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Width</label>
                                        <div className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded">
                                            {selectedConfig.width || 120}px
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold mb-1">Nickname</label>
                                        <input
                                            type="text"
                                            value={selectedConfig.nickname || selectedColumn}
                                            onChange={(e) => updateColumnNickname(selectedColumn, e.target.value)}
                                            className="w-full px-2 py-1 rounded text-xs border"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Date Filter */}
            <div className="mb-2 flex items-center gap-2 flex-shrink-0">
                <label className="text-xs font-semibold">Date Filter:</label>
                <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value as any)}
                    className="px-2 py-1 border rounded text-xs"
                >
                    <option value="all">All</option>
                    <option value="today">Today Only</option>
                    <option value="today+before">Today + Before</option>
                    <option value="today+after">Today + After</option>
                </select>
                <select
                    value={dateFilterColumn || ''}
                    onChange={(e) => setDateFilterColumn(e.target.value || null)}
                    className="px-2 py-1 border rounded text-xs"
                >
                    <option value="">Select Column</option>
                    {visibleColumns.filter(c => c.colKey).map((col, idx) => {
                        const colKey = col.colKey!;
                        return (
                            <option key={idx} value={colKey}>
                                {getColumnHeader(colKey)}
                            </option>
                        );
                    })}
                </select>
            </div>

            <div 
                ref={tableRef}
                className={`flex-1 overflow-x-auto overflow-y-auto ${isSheet ? 'border border-gray-400' : 'border border-gray-300'}`}
                style={{ minHeight: 0 }}
            >
                <table className={`text-left border-collapse ${isSheet ? 'text-[10px]' : 'text-xs'}`} style={{ tableLayout: 'fixed', width: 'max-content' }}>
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
                                        style={{ width: `${width}px`, minWidth: `${width}px` }}
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
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAutoFitWidth(colKey);
                                                }}
                                                title="Drag to resize, double-click to auto-fit"
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
                                        const colObj = (col as any).col || col;
                                        const cellValue = getCellValue(item, colObj);
                                        const cellValueString = getCellValueString(item, colObj);
                                        const nextColEmpty = isNextColumnEmpty(rowIdx, colIdx);
                                        const shouldOverflow = config.overflow === 'visible' && nextColEmpty;
                                        const isJSX = React.isValidElement(cellValue);

                                        return (
                                    <td
                                        key={colIdx}
                                                style={{ 
                                                    width: `${width}px`, 
                                                    minWidth: `${width}px`,
                                                    position: 'relative'
                                                }}
                                                className={`${col.className || ''} ${isSheet ? 'p-0.5 border border-gray-300' : 'p-2 border-r border-gray-200'} ${isSelected ? 'ring-2 ring-blue-500' : ''} ${config.locked ? 'bg-gray-100 cursor-copy' : isJSX ? 'cursor-default' : 'cursor-cell'}`}
                                                onClick={() => {
                                                    if (!isJSX) {
                                                        handleCellClick(rowIdx, colKey, cellValueString, true);
                                                    }
                                                }}
                                                title={config.locked ? 'Click to copy' : isJSX ? '' : 'Click to edit'}
                                            >
                                                {isEditing && !isJSX ? (
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
                                                        ref={(el) => {
                                                            if (el) cellRefs.current.set(`${rowIdx}-${colKey}`, el);
                                                        }}
                                                        className={`px-0.5 whitespace-normal break-words ${config.bold ? 'font-bold' : ''}`}
                                                        style={{ 
                                                            fontSize: '10px'
                                                        }}
                                                    >
                                                        {isJSX ? cellValue : cellValueString}
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
