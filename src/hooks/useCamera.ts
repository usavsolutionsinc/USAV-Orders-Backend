import { useRef, useCallback } from 'react';

export interface CameraConfig {
    facingMode?: 'user' | 'environment';
    width?: { ideal: number };
    height?: { ideal: number };
}

export interface CameraHook {
    videoRef: React.RefObject<HTMLVideoElement>;
    startCamera: (config?: CameraConfig) => Promise<void>;
    stopCamera: () => void;
    takePhoto: () => string | null;
    isActive: boolean;
}

/**
 * Hook to manage camera stream for photo capture
 * @returns Camera control functions and video ref
 */
export function useCamera(): CameraHook {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const startCamera = useCallback(async (config?: CameraConfig) => {
        try {
            // Stop any existing stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            const constraints: MediaStreamConstraints = {
                video: {
                    facingMode: config?.facingMode || 'environment',
                    ...(config?.width && { width: config.width }),
                    ...(config?.height && { height: config.height }),
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (error) {
            console.error('Failed to start camera:', error);
            
            // Fallback to basic constraints
            try {
                const fallbackStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: config?.facingMode || 'environment' }
                });
                streamRef.current = fallbackStream;
                
                if (videoRef.current) {
                    videoRef.current.srcObject = fallbackStream;
                }
            } catch (fallbackError) {
                console.error('Camera fallback failed:', fallbackError);
                throw fallbackError;
            }
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    const takePhoto = useCallback((): string | null => {
        if (!videoRef.current) return null;

        const canvas = document.createElement('canvas');
        const video = videoRef.current;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0);
        return canvas.toDataURL('image/jpeg');
    }, []);

    const isActive = !!streamRef.current;

    return {
        videoRef,
        startCamera,
        stopCamera,
        takePhoto,
        isActive,
    };
}
