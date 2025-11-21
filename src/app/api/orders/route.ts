import { NextResponse } from 'next/server';

const MOCK_ORDERS = [
    {
        id: 'ORD-8421',
        buyerName: 'John Doe',
        shipBy: '2025-11-22',
        shippingSpeed: 'Standard',
        trackingNumber: '1Z999AA10123456784',
        shippingLabelZpl: '^XA^FO50,50^ADN,36,20^FDJohn Doe^FS^FO50,100^ADN,36,20^FD123 Gravity Ln^FS^XZ',
        items: [
            {
                title: 'Anti-Gravity Hover Boots',
                sku: 'HOV-001',
                qty: 1,
                skuDocuments: [
                    { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' } // Mock PDF
                ]
            }
        ]
    },
    {
        id: 'ORD-8422',
        buyerName: 'Jane Smith',
        shipBy: '2025-11-21',
        shippingSpeed: 'Expedited',
        trackingNumber: '1Z999AA10123456785',
        shippingLabelZpl: '^XA^FO50,50^ADN,36,20^FDJane Smith^FS^FO50,100^ADN,36,20^FD456 Zero G Rd^FS^XZ',
        items: [
            {
                title: 'Zero-G Coffee Mug',
                sku: 'ZCM-550',
                qty: 2,
                skuDocuments: [
                    { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' }
                ]
            }
        ]
    }
];

export async function GET() {
    return NextResponse.json(MOCK_ORDERS);
}
