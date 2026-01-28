/**
 * Zendesk integration utility for creating repair service tickets via Google Apps Script Web App
 */

interface RepairTicketData {
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    product: string;
    repairReasons: string[];
    additionalNotes?: string;
    serialNumber: string;
    price: string;
}

/**
 * Calculates a date that is 5 business days (Mon-Fri) from the current date.
 */
function calculateDueDate(startDate: Date): string {
    let date = new Date(startDate);
    let businessDaysAdded = 0;

    while (businessDaysAdded < 5) {
        date.setDate(date.getDate() + 1);
        const dayOfWeek = date.getDay();
        // 0 is Sunday, 6 is Saturday
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            businessDaysAdded++;
        }
    }

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${month}/${day}/${year}`;
}

/**
 * Send ticket data to Google Apps Script Web App to create a Zendesk ticket
 */
export async function createZendeskTicket(data: RepairTicketData): Promise<string | null> {
    const { 
        customerName, 
        customerPhone, 
        customerEmail, 
        product, 
        serialNumber, 
        price 
    } = data;

    // 1. Validate required fields
    if (!customerName || !customerPhone || !customerEmail || !product || !serialNumber || !price) {
        const missing = [];
        if (!customerName) missing.push('Name');
        if (!customerPhone) missing.push('Phone number');
        if (!customerEmail) missing.push('Email');
        if (!product) missing.push('Product Title');
        if (!serialNumber) missing.push('Serial #');
        if (!price) missing.push('Price');
        
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    const gasUrl = process.env.ZendeskTicketMailer_GAS_WebappURL;
    if (!gasUrl) {
        console.error('Missing ZendeskTicketMailer_GAS_WebappURL environment variable');
        throw new Error('Server configuration error: Missing Web App URL');
    }

    // 2. Calculate due date
    const dueDate = calculateDueDate(new Date());

    // 3. Format Price (ensure it has $)
    const formattedPrice = price.startsWith('$') ? price : `$${price}`;

    // 4. Build JSON payload
    const payload = {
        subject: `Repair: Walk-in ${customerName} - ${customerPhone} - Due Date: ${dueDate}`,
        description: `${customerName}\n${serialNumber}\n${customerEmail}\n${customerPhone}\n${formattedPrice}\nDue date: ${dueDate}`,
        customerName: customerName,
        customerEmail: customerEmail
    };

    try {
        const response = await fetch(gasUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('GAS Web App Error:', errorText);
            throw new Error('The ticket could not be created (Web App error)');
        }

        const result = await response.json();
        if (result.ok) {
            return result.ticketNumber || 'SUCCESS';
        } else {
            throw new Error(result.error || 'The ticket could not be created');
        }
    } catch (error: any) {
        console.error('Error calling GAS Web App:', error);
        throw new Error(error.message || 'The ticket could not be created due to a network error');
    }
}
