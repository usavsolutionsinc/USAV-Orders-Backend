import { useState, useEffect, useCallback } from 'react';

export interface ColumnConfig {
    visible: boolean;
    nickname: string;
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
                nickname: `col_${i}`
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
                visible: prev[colKey]?.visible !== false,
                nickname: nickname || colKey
            }
        }));
    }, []);

    const getColumnHeader = useCallback((colKey: string): string => {
        return columnConfig[colKey]?.nickname || colKey;
    }, [columnConfig]);

    const isColumnVisible = useCallback((colKey: string): boolean => {
        return columnConfig[colKey]?.visible !== false;
    }, [columnConfig]);

    const resetToDefaults = useCallback(() => {
        const initial: ColumnManagerState = {};
        for (let i = 1; i <= totalColumns; i++) {
            initial[`col_${i}`] = {
                visible: true,
                nickname: `col_${i}`
            };
        }
        setColumnConfig(initial);
    }, [totalColumns]);

    return {
        columnConfig,
        toggleColumnVisibility,
        updateColumnNickname,
        getColumnHeader,
        isColumnVisible,
        resetToDefaults
    };
}

