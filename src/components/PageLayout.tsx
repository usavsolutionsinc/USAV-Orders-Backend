'use client';

import Sidebar from './Sidebar';
import Checklist from './Checklist';

interface PageLayoutProps {
    role?: 'technician' | 'packer';
    userId?: string;
    sheetId: string;
    gid?: string;
    showChecklist?: boolean;
    showSidebar?: boolean;
}

export default function PageLayout({ 
    role, 
    userId = '1', 
    sheetId, 
    gid,
    showChecklist = false,
    showSidebar = false 
}: PageLayoutProps) {
    // Build the URL with proper gid parameter
    let iframeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    
    const params: string[] = [];
    if (gid) {
        params.push(`gid=${gid}`);
    }
    params.push('rm=minimal');
    params.push('single=true');
    params.push('widget=false');
    
    if (params.length > 0) {
        iframeUrl += '#' + params.join('&');
    }

    return (
        <div className="flex h-full w-full">
            {showSidebar && <Sidebar />}
            <div className="flex-1 flex flex-col overflow-hidden w-full">
                {showChecklist && role && <Checklist role={role} userId={userId} />}
                <div className="flex-1 overflow-hidden w-full">
                    <iframe
                        src={iframeUrl}
                        width="100%"
                        height="100%"
                        frameBorder="0"
                        style={{
                            border: 'none',
                            display: 'block',
                            background: 'white',
                            width: '100%'
                        }}
                        allow="clipboard-read; clipboard-write"
                    />
                </div>
            </div>
        </div>
    );
}
