'use client';

import BarcodeSidebar from '@/components/BarcodeSidebar';

export default function SkuStockPage() {
    const sheetId = "1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE";
    const gid = "527136135";
    const iframeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}&rm=minimal&single=true&widget=false`;

    return (
        <div className="flex h-full w-full">
            <BarcodeSidebar />
            <div className="flex-1 overflow-hidden w-full">
                <iframe
                    src={iframeUrl}
                    width="100%"
                    height="100%"
                    frameBorder={0}
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
    );
}
