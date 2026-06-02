'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

/**
 * A page's selection affordance, surfaced as the pencil toggle in the global
 * header's right actions. A page registers one via {@link usePageSelection}
 * when it has a selectable surface up; the header shows the toggle and reflects
 * `active`. Null when no page exposes selection.
 */
export interface HeaderSelectionControl {
    active: boolean;
    onToggle: () => void;
}

interface HeaderContextType {
    panelContent: ReactNode | null;
    setPanelContent: (content: ReactNode | null) => void;
    selection: HeaderSelectionControl | null;
    setSelection: (control: HeaderSelectionControl | null) => void;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function HeaderProvider({ children }: { children: ReactNode }) {
    const [panelContent, setPanelContent] = useState<ReactNode | null>(null);
    const [selection, setSelection] = useState<HeaderSelectionControl | null>(null);

    return (
        <HeaderContext.Provider
            value={{ panelContent, setPanelContent, selection, setSelection }}
        >
            {children}
        </HeaderContext.Provider>
    );
}

export function useHeader() {
    const context = useContext(HeaderContext);
    if (context === undefined) {
        throw new Error('useHeader must be used within a HeaderProvider');
    }
    return context;
}
