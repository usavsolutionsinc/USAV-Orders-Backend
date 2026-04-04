import { useRef, useCallback, useState } from 'react';

export interface CameraConfig {
    facingMode?: 'user' | 'environment';
    width?: { ideal: number };
    height?: { ideal: number };
}

export type CameraError = 'permission-denied' | 'not-found' | 'unknown';

export interface CameraHook {
    videoRef: React.RefObject<HTMLVideoElement>;
    startCamera: (config?: CameraConfig) => Promise<void>;
    stopCamera: () => void;
    takePhoto: () => string | null;
    isActive: boolean;
    /** Specific error type for UI to show appropriate guidance. */
    cameraError: CameraError | null;
}

/**
 * Request camera permission explicitly.
 * Safari requires getUserMedia to be called from a user gesture.
 * Call this from a button onClick handler to trigger the permission prompt.
 */
export async function requestCameraPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
    if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Got permission — stop the stream immediately, the actual camera start will re-acquire.
        stream.getTracks().forEach((t) => t.stop());
        return 'granted';
    } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') return 'denied';
        return 'unavailable';
    }
}

/**
 * Hook to manage camera stream for photo capture
 * @returns Camera control functions and video ref
 */
export function useCamera(): CameraHook {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cameraError, setCameraError] = useState<CameraError | null>(null);

    const startCamera = useCallback(async (config?: CameraConfig) => {
        setCameraError(null);

        // Check API availability
        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError('not-found');
            throw new Error('Camera API not available — requires HTTPS or localhost');
        }

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
        } catch (error: any) {
            const errName = error?.name || '';

            // Safari + Chrome: NotAllowedError when user denies or permission not granted
            if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
                setCameraError('permission-denied');
                throw error;
            }

            // No camera hardware
            if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
                setCameraError('not-found');
                throw error;
            }

            console.error('Failed to start camera:', error);

            // Fallback to basic constraints (e.g. OverconstrainedError)
            try {
                const fallbackStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: config?.facingMode || 'environment' }
                });
                streamRef.current = fallbackStream;

                if (videoRef.current) {
                    videoRef.current.srcObject = fallbackStream;
                }
            } catch (fallbackError: any) {
                const fbName = fallbackError?.name || '';
                if (fbName === 'NotAllowedError' || fbName === 'PermissionDeniedError') {
                    setCameraError('permission-denied');
                } else {
                    setCameraError('unknown');
                }
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
        cameraError,
    };
}
