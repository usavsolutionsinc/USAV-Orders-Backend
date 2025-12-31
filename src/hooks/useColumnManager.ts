import { useState, useEffect, useCallback } from 'react';

export interface ColumnConfig {
    visible: boolean;
    nickname: string;
    width?: number;
    sortDirection?: 'asc' | 'desc' | null;
    overflow?: 'hidden' | 'visible';
    bold?: boolean;
    locked?: boolean; // View only, copy/paste on click
}

export interface ColumnManagerState {
    [key: string]: ColumnConfig; // key is like "col_1", "col_2", etc.
}

const STORAGE_PREFIX = 'column_config_';

export function useColumnManager(tableName: string, totalColumns: number) {
    const storageKey = `${STORAGE_PREFIX}${tableName}`;

    const [columnConfig, setColumnConfig] = useState<ColumnManagerState>(() => {
        if (typeof window === 'undefined') return {};
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error('Failed to load column config:', e);
        }
        // Initialize with all columns visible and default nicknames
        const initial: ColumnManagerState = {};
        for (let i = 1; i <= totalColumns; i++) {
            initial[`col_${i}`] = {
                visible: true,
                nickname: `col_${i}`,
                width: 120, // Default width
                sortDirection: null,
                overflow: 'visible',
                bold: false,
                locked: false
            };
        }
        return initial;
    });

    // Save to localStorage whenever config changes
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(columnConfig));
        } catch (e) {
            console.error('Failed to save column config:', e);
        }
    }, [columnConfig, storageKey]);

    const toggleColumnVisibility = useCallback((colKey: string) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                visible: !prev[colKey]?.visible
            }
        }));
    }, []);

    const updateColumnNickname = useCallback((colKey: string, nickname: string) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                visible: prev[colKey]?.visible !== false,
                nickname: nickname || colKey,
                width: prev[colKey]?.width || 120,
                sortDirection: prev[colKey]?.sortDirection || null,
                overflow: prev[colKey]?.overflow || 'visible',
                bold: prev[colKey]?.bold || false,
                locked: prev[colKey]?.locked || false
            }
        }));
    }, []);

    const updateColumnWidth = useCallback((colKey: string, width: number) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                visible: prev[colKey]?.visible !== false,
                nickname: prev[colKey]?.nickname || colKey,
                width,
                sortDirection: prev[colKey]?.sortDirection || null,
                overflow: prev[colKey]?.overflow || 'visible',
                bold: prev[colKey]?.bold || false,
                locked: prev[colKey]?.locked || false
            }
        }));
    }, []);

    const setSortDirection = useCallback((colKey: string, direction: 'asc' | 'desc' | null) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                sortDirection: direction
            }
        }));
    }, []);

    const toggleOverflow = useCallback((colKey: string) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                overflow: prev[colKey]?.overflow === 'hidden' ? 'visible' : 'hidden'
            }
        }));
    }, []);

    const toggleBold = useCallback((colKey: string) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                bold: !prev[colKey]?.bold
            }
        }));
    }, []);

    const toggleLock = useCallback((colKey: string) => {
        setColumnConfig(prev => ({
            ...prev,
            [colKey]: {
                ...prev[colKey],
                locked: !prev[colKey]?.locked
            }
        }));
    }, []);

    const getColumnHeader = useCallback((colKey: string): string => {
        return columnConfig[colKey]?.nickname || colKey;
    }, [columnConfig]);

    const isColumnVisible = useCallback((colKey: string): boolean => {
        return columnConfig[colKey]?.visible !== false;
    }, [columnConfig]);

    const getColumnWidth = useCallback((colKey: string): number => {
        return columnConfig[colKey]?.width || 120;
    }, [columnConfig]);

    const resetToDefaults = useCallback(() => {
        const initial: ColumnManagerState = {};
        for (let i = 1; i <= totalColumns; i++) {
            initial[`col_${i}`] = {
                visible: true,
                nickname: `col_${i}`,
                width: 120,
                sortDirection: null,
                overflow: 'visible',
                bold: false,
                locked: false
            };
        }
        setColumnConfig(initial);
    }, [totalColumns]);

    return {
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
        getColumnWidth,
        resetToDefaults
    };
}
