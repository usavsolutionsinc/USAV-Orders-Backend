'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface HeaderContextType {
    panelContent: ReactNode | null;
    setPanelContent: (content: ReactNode | null) => void;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function HeaderProvider({ children }: { children: ReactNode }) {
    const [panelContent, setPanelContent] = useState<ReactNode | null>(null);

    return (
        <HeaderContext.Provider value={{ panelContent, setPanelContent }}>
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
