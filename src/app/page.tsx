'use client';

import React from 'react';

export default function Home() {
    // Google Sheet ID from the URL
    const sheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
    
    // Construct the iframe URL with parameters for clean, editable view
    const iframeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?rm=minimal&single=true&widget=false&headers=false`;

    return (
        <div className="min-h-screen bg-white">
            <iframe 
                src={iframeUrl}
                width="100%" 
                height="100vh" 
                frameBorder="0"
                style={{ 
                    border: '1px solid #ddd', 
                    background: 'transparent',
                    display: 'block'
                }}
                allow="clipboard-read; clipboard-write"
            />
        </div>
    );
}
