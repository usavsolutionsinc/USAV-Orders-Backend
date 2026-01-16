import nodemailer from 'nodemailer';

/**
 * Zendesk integration utility for creating repair service tickets via email
 */

interface RepairTicketData {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    product: string;
    repairReasons: string[];
    additionalNotes?: string;
    serialNumber?: string;
    price?: string;
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
    const priceSection = data.price ? `\nPrice: $${data.price}\n` : '';

    return `New Repair Service Request

CUSTOMER INFORMATION:
Name: ${data.customerName}
Phone: ${data.customerPhone}
Email: ${data.customerEmail || 'Not provided'}

PRODUCT INFORMATION:
Product: ${data.product}
Serial #: ${data.serialNumber || 'Not provided'}
${priceSection}

REASON FOR REPAIR:
${reasonsList}
${additionalSection}
---
Tags: Repair Service
Auto-generated from USAV Repair Intake System
Drop Off Date: ${dateStr}`;
}

/**
 * Send email to Zendesk to create a support ticket
 */
export async function createZendeskTicket(data: RepairTicketData): Promise<string | null> {
    try {
        const smtpHost = process.env.SMTP_HOST;
        const smtpPort = Number(process.env.SMTP_PORT || 587);
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const fromEmail = process.env.SUPPORT_SENDER;
        const toZendeskEmail = process.env.ZENDESK_INBOUND;

        if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !toZendeskEmail) {
            console.error('Missing required SMTP or email parameters for Zendesk integration.');
            return null;
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        });

        const emailBody = formatZendeskEmail(data);
        const subject = `New Repair Service - ${data.product} [Repair Service]`;

        const mailOptions = {
            from: `"${data.customerName || fromEmail}" <${fromEmail}>`,
            to: toZendeskEmail,
            subject: subject,
            text: emailBody,
            headers: {
                'X-Original-Sender': data.customerEmail || fromEmail,
                'Reply-To': data.customerEmail || fromEmail
            }
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Zendesk ticket email sent:', info.messageId);
        
        // Return null as we don't have a ticket number yet (it's created asynchronously by Zendesk)
        // The calling code will handle generating an RS number if this returns null
        return null; 
    } catch (error) {
        console.error('Error creating Zendesk ticket via email:', error);
        return null;
    }
}

/**
 * Parse ticket number from Zendesk response/email
 * (Keeping this for backward compatibility if needed, though email submission is async)
 */
export function parseTicketNumber(response: any): string | null {
    const ticketMatch = response?.body?.match(/#(\d+)/);
    return ticketMatch ? ticketMatch[1] : null;
}
