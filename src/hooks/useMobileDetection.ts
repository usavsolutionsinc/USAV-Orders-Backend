import { useState, useEffect } from 'react';

/**
 * Hook to detect if the current viewport is mobile size
 * @param breakpoint - The width breakpoint in pixels (default: 1024)
 * @returns boolean indicating if the viewport is mobile
 */
export function useMobileDetection(breakpoint: number = 1024): boolean {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < breakpoint);
        };

        // Initial check
        checkMobile();

        // Add event listener
        window.addEventListener('resize', checkMobile);

        // Cleanup
        return () => {
            window.removeEventListener('resize', checkMobile);
        };
    }, [breakpoint]);

    return isMobile;
}
