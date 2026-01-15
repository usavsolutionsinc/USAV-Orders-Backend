/**
 * Zendesk integration utility for creating repair service tickets
 */

interface RepairTicketData {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    product: string;
    repairReasons: string[];
    additionalNotes?: string;
    serialNumber?: string;
}

/**
 * Format the email body for Zendesk ticket creation
 */
export function formatZendeskEmail(data: RepairTicketData): string {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const reasonsList = data.repairReasons.map(r => `- ${r}`).join('\n');
    const additionalSection = data.additionalNotes ? `\nAdditional Notes:\n${data.additionalNotes}\n` : '';

    return `New Repair Service Request

CUSTOMER INFORMATION:
Name: ${data.customerName}
Phone: ${data.customerPhone}
Email: ${data.customerEmail || 'Not provided'}

PRODUCT INFORMATION:
Product: ${data.product}
Serial #: ${data.serialNumber || 'Not provided'}

REASON FOR REPAIR:
${reasonsList}
${additionalSection}
---
Auto-generated from USAV Repair Intake System
Drop Off Date: ${dateStr}`;
}

/**
 * Send email to Zendesk to create a support ticket
 * Email to: support@usav.zendesk.com
 */
export async function createZendeskTicket(data: RepairTicketData): Promise<string | null> {
    try {
        const emailBody = formatZendeskEmail(data);
        
        // Send email using your email service
        // This is a placeholder - you'll need to implement actual email sending
        // You can use services like SendGrid, Nodemailer, or your existing email API
        
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: 'support@usav.zendesk.com',
                subject: `New Repair Service - ${data.product}`,
                text: emailBody,
                from: 'repairs@usav.com' // Your sender email
            })
        });

        if (response.ok) {
            const result = await response.json();
            // Try to parse Zendesk ticket number from response
            // Zendesk typically returns ticket info in the auto-reply
            return result.ticketNumber || null;
        }

        return null;
    } catch (error) {
        console.error('Error creating Zendesk ticket:', error);
        return null;
    }
}

/**
 * Parse ticket number from Zendesk response/email
 */
export function parseTicketNumber(response: any): string | null {
    // Zendesk ticket numbers are usually in format: #12345
    // This regex looks for that pattern
    const ticketMatch = response?.body?.match(/#(\d+)/);
    return ticketMatch ? ticketMatch[1] : null;
}
