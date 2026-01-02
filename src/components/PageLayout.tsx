'use client';

import Sidebar from './Sidebar';
import Checklist from './Checklist';

interface PageLayoutProps {
    role?: 'technician' | 'packer';
    userId?: string;
    sheetId: string;
    showChecklist?: boolean;
}

export default function PageLayout({ role, userId = '1', sheetId, showChecklist = false }: PageLayoutProps) {
    const iframeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?rm=minimal&single=true&widget=false&headers=false`;

    return (
        <div className="flex h-full">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                {showChecklist && role && <Checklist role={role} userId={userId} />}
                <div className="flex-1 overflow-hidden">
                    <iframe
                        src={iframeUrl}
                        width="100%"
                        height="100%"
                        frameBorder="0"
                        style={{
                            border: 'none',
                            display: 'block',
                            background: 'white'
                        }}
                        allow="clipboard-read; clipboard-write"
                    />
                </div>
            </div>
        </div>
    );
}
