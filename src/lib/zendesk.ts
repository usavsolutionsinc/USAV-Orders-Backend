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
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_PASS;
        const toZendeskEmail = process.env.ZENDESK_INBOUND;

        if (!gmailUser || !gmailPass || !toZendeskEmail) {
            console.error('Missing required Gmail or Zendesk parameters for integration.');
            return null;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailUser,
                pass: gmailPass,
            },
        });

        const emailBody = formatZendeskEmail(data);
        const subject = `New Repair Service - ${data.product} [Repair Service]`;

        const mailOptions = {
            from: `"Front Desk Bot" <${gmailUser}>`,
            to: toZendeskEmail,
            subject: subject,
            text: emailBody,
            replyTo: data.customerEmail || gmailUser,
            headers: {
                'X-Original-Sender': data.customerEmail || gmailUser
            }
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Zendesk ticket email sent via Gmail:', info.messageId);
        
        return null; 
    } catch (error) {
        console.error('Error creating Zendesk ticket via Gmail:', error);
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
