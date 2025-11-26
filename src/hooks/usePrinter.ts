import { useState } from 'react';
import qz from 'qz-tray';

export function usePrinter() {
    const [isPrinting, setIsPrinting] = useState(false);

    const printOrder = async (order: any) => {
        setIsPrinting(true);
        try {
            if (!qz.websocket.isActive()) {
                await qz.websocket.connect().catch((e: any) => console.error("QZ Connection Error:", e));
            }

            // Collect all manual PDFs from every SKU in the order
            const manualUrls = order.items.flatMap((item: any) =>
                item.skuDocuments ? item.skuDocuments.map((doc: any) => doc.url) : []
            );

            // 1. Normal printer → Packing slip + all manuals (as PDFs)
            const configDocs = qz.configs.create("Brother Laser"); // TODO: Make configurable
            await qz.print(configDocs, [
                { type: 'pdf', data: `/api/packing-slip?orderId=${order.id}` },
                ...manualUrls.map((url: string) => ({ type: 'pdf', data: url }))
            ]).catch((e: any) => console.error("Printing Docs Error:", e));

            // 2. Thermal label printer → Shipping label
            if (order.shippingLabelZpl) {
                const configLabel = qz.configs.create("Zebra GX430t"); // TODO: Make configurable
                await qz.print(configLabel, [
                    { type: 'raw', format: 'zpl', data: order.shippingLabelZpl }
                ]).catch((e: any) => console.error("Printing Label Error:", e));
            }

            // Mark as printed
            await fetch(`/api/orders/${order.id}/printed`, { method: 'POST' });
            alert(`Printed Order ${order.id}`);
        } catch (err) {
            console.error("Print failed", err);
            alert("Printing failed. Check console for details.");
        } finally {
            setIsPrinting(false);
        }
    };

    return { printOrder, isPrinting };
}
