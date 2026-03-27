import { JWT } from 'google-auth-library';
import { normalizeEnvValue, normalizeMultilineEnvValue } from '@/lib/env-utils';

export function getGoogleAuth() {
    const rawClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!rawClientEmail || !rawPrivateKey) {
        throw new Error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
    }

    const clientEmail = normalizeEnvValue(rawClientEmail);
    const normalizedPrivateKey = normalizeMultilineEnvValue(rawPrivateKey);

    return new JWT({
        email: clientEmail,
        key: normalizedPrivateKey,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
}
