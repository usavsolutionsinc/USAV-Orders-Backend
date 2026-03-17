/**
 * Zendesk integration utility for creating repair service tickets via Google Apps Script Web App
 */

interface RepairTicketData {
    repairServiceId: number;
    repairServiceNumber: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    productTitle: string;
    contactInfo: string;
    issue: string; // Repair reasons
    serialNumber: string;
    price: string;
    notes: string; // Additional notes
}

interface ZendeskAuthConfig {
    subdomain: string;
    user: string;
    apiToken: string;
}

export interface ZendeskSupportTicket {
    id: string;
    subject: string;
    status: string;
    priority: string;
    requesterName: string;
    updatedAt: string;
    url: string;
}

export interface ZendeskSupportOverview {
    configured: boolean;
    healthy: boolean;
    count: number;
    urgentCount: number;
    tickets: ZendeskSupportTicket[];
    agentUrl: string | null;
    error: string | null;
}

function getZendeskAuthConfig(): ZendeskAuthConfig | null {
    const subdomain = process.env.ZENDESK_SUBDOMAIN;
    const user = process.env.ZENDESK_EMAIL || process.env.ZENDESK_API_USER;
    const apiToken = process.env.ZENDESK_API_TOKEN;

    if (!subdomain || !user || !apiToken) {
        return null;
    }

    return { subdomain, user, apiToken };
}

async function zendeskRequest(config: ZendeskAuthConfig, path: string): Promise<any> {
    const auth = Buffer.from(`${config.user}/token:${config.apiToken}`).toString('base64');
    const response = await fetch(`https://${config.subdomain}.zendesk.com${path}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`,
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Zendesk request failed (${response.status})${errorText ? `: ${errorText}` : ''}`);
    }

    return response.json().catch(() => ({}));
}

export async function getZendeskSupportOverview(limit = 10): Promise<ZendeskSupportOverview> {
    const config = getZendeskAuthConfig();
    const fallbackSubdomain = process.env.ZENDESK_SUBDOMAIN || 'usav';
    const agentUrl = `https://${fallbackSubdomain}.zendesk.com/agent/filters`;

    if (!config) {
        return {
            configured: false,
            healthy: false,
            count: 0,
            urgentCount: 0,
            tickets: [],
            agentUrl,
            error: 'Zendesk API credentials are not configured',
        };
    }

    try {
        const encodedQuery = encodeURIComponent('type:ticket status<solved');
        const data = await zendeskRequest(
            config,
            `/api/v2/search.json?query=${encodedQuery}&sort_by=updated_at&sort_order=desc`
        );

        const results = Array.isArray(data?.results) ? data.results : [];
        const tickets = results
            .filter((entry: any) => String(entry?.result_type || 'ticket') === 'ticket')
            .slice(0, limit)
            .map((entry: any) => ({
                id: String(entry?.id || ''),
                subject: String(entry?.subject || 'Zendesk ticket'),
                status: String(entry?.status || 'open'),
                priority: String(entry?.priority || 'normal'),
                requesterName: String(entry?.requester?.name || entry?.via?.source?.from?.name || 'Customer'),
                updatedAt: String(entry?.updated_at || ''),
                url: `https://${config.subdomain}.zendesk.com/agent/tickets/${encodeURIComponent(String(entry?.id || ''))}`,
            }));

        const urgentCount = tickets.filter((ticket: ZendeskSupportTicket) => ['urgent', 'high'].includes(ticket.priority.toLowerCase())).length;
        const count = Number.isFinite(Number(data?.count)) ? Number(data.count) : tickets.length;

        return {
            configured: true,
            healthy: true,
            count,
            urgentCount,
            tickets,
            agentUrl,
            error: null,
        };
    } catch (error: any) {
        console.error('Zendesk support overview failed:', error);

        return {
            configured: true,
            healthy: false,
            count: 0,
            urgentCount: 0,
            tickets: [],
            agentUrl,
            error: error?.message || 'Failed to load Zendesk tickets',
        };
    }
}

/**
 * Returns a Date that is `businessDays` business days (Mon-Fri) from startDate.
 * Exported so callers can derive a deadline_at value independently of Zendesk.
 */
export function addBusinessDays(startDate: Date, businessDays = 5): Date {
    const date = new Date(startDate);
    let added = 0;
    while (added < businessDays) {
        date.setDate(date.getDate() + 1);
        const dow = date.getDay();
        if (dow !== 0 && dow !== 6) added++;
    }
    return date;
}

/** Returns the repair due date as a MM/DD/YYYY string for display in tickets. */
function calculateDueDate(startDate: Date): string {
    const date = addBusinessDays(startDate, 5);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
}

/**
 * Send ticket data to Google Apps Script Web App to create a Zendesk ticket
 */
export async function createZendeskTicket(data: RepairTicketData): Promise<string | null> {
    const { 
        repairServiceId,
        repairServiceNumber,
        customerName, 
        customerPhone, 
        customerEmail, 
        productTitle, 
        contactInfo,
        issue,
        serialNumber, 
        price,
        notes
    } = data;

    // 1. Validate required fields (email is optional)
    if (!customerName || !customerPhone || !productTitle || !serialNumber || !price) {
        const missing = [];
        if (!customerName) missing.push('Name');
        if (!customerPhone) missing.push('Phone number');
        if (!productTitle) missing.push('Product Title');
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

    // 4. Build JSON payload - Format like repair service paper
    let description = `RS Table ID: ${repairServiceId}\nRS Number: ${repairServiceNumber}\n\nProduct Title: ${productTitle}\n\nSN & Issue: ${serialNumber}, ${issue}\n\nContact Info: ${contactInfo}\n\nDue Date: ${dueDate}`;
    
    // Add notes at the end if present
    if (notes) {
        description += `\n\n${notes}`;
    }
    
    const payload = {
        subject: `Repair RS ${repairServiceId}: Walk-in ${customerName} - ${customerPhone} - Due Date: ${dueDate}`,
        description: description,
        customerName: customerName,
        customerEmail: customerEmail || ''
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
        console.log('Zendesk GAS Response:', JSON.stringify(result));
        
        if (result.ok) {
            // Try different possible property names for ticket number
            const ticketNumber = result.ticketNumber || result.ticket_number || result.ticketId || result.ticket_id || result.id;
            
            if (!ticketNumber) {
                console.error('Zendesk ticket created but no ticket number found in response:', result);
                throw new Error('Ticket created but ticket number not returned');
            }
            
            // Format ticket number with # prefix if not already present
            const formattedTicketNumber = ticketNumber.toString().startsWith('#') 
                ? ticketNumber.toString() 
                : `#${ticketNumber}`;
            
            return formattedTicketNumber;
        } else {
            throw new Error(result.error || 'The ticket could not be created');
        }
    } catch (error: any) {
        console.error('Error calling GAS Web App:', error);
        throw new Error(error.message || 'The ticket could not be created due to a network error');
    }
}
