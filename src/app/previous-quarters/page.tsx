import { Suspense } from 'react';
import QuarterSelector from '@/components/QuarterSelector';

export default function PreviousQuartersPage() {
    return (
        <Suspense fallback={null}>
            <QuarterSelector />
        </Suspense>
    );
}
