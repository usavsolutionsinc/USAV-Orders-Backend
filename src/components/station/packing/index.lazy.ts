/**
 * Lazy-loaded packing station components for code splitting
 */

import dynamic from 'next/dynamic';

export const PhotoGalleryLazy = dynamic(() => 
    import('./PhotoGallery').then(mod => ({ default: mod.PhotoGallery })),
    {
        loading: () => (
            <div className="fixed inset-0 bg-black z-[200] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        ),
    }
);

export const CameraScannerLazy = dynamic(() => 
    import('./CameraScanner').then(mod => ({ default: mod.CameraScanner })),
    {
        loading: () => (
            <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        ),
    }
);

export const PhotoCaptureLazy = dynamic(() => 
    import('./PhotoCapture').then(mod => ({ default: mod.PhotoCapture })),
    {
        loading: () => (
            <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        ),
    }
);
