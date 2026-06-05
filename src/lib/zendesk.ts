/**
 * Zendesk integration utility for creating repair service tickets via the
 * Zendesk REST API.
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
 * Create a Zendesk repair-service ticket directly via the REST API.
 * Returns the ticket number formatted as `#<id>` (e.g. `#12345`).
 * Throws ZendeskNotConfiguredError / ZendeskApiError on failure.
 */
export async function createZendeskTicket(
    data: RepairTicketData,
    opts: { idempotencyKey?: string } = {},
): Promise<string | null> {
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

    // 2. Calculate due date
    const dueDate = calculateDueDate(new Date());

    // 3. Build description — clean, human-readable layout. Each fact gets its
    //    own labeled line (the old one crammed serial + issue onto a single
    //    "SN & Issue:" line and led with the internal table id). All the same
    //    data support relied on is still here, just easier to scan.
    const descriptionLines = [
        `Repair Service ${repairServiceNumber} (ID ${repairServiceId})`,
        '',
        `Product: ${productTitle}`,
        `Serial Number: ${serialNumber}`,
        `Reported Issue: ${issue}`,
        '',
        `Customer Contact: ${contactInfo}`,
        `Estimated Due Date: ${dueDate}`,
    ];

    // Add notes at the end if present
    if (notes) {
        descriptionLines.push('', 'Additional Notes:', notes);
    }
    const description = descriptionLines.join('\n');

    // 4. Create the ticket directly via the Zendesk REST API. external_id links
    //    it to the repair entity so the support workspace can resolve photos.
    //    The first comment is internal (public: false) so creating the intake
    //    ticket never emails the walk-in customer.
    const ticket = await createTicket({
        subject: `Repair RS ${repairServiceId}: Walk-in ${customerName} - ${customerPhone} - Due Date: ${dueDate}`,
        comment: { body: description, public: false },
        type: 'task',
        tags: ['repair_service', 'walk_in'],
        external_id: `repair:${repairServiceId}`,
        ...(customerEmail ? { requester: { name: customerName, email: customerEmail } } : {}),
    }, opts);

    return `#${ticket.id}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Direct Zendesk REST API client (tickets CRUD + comments)
 *
 * Unlike createZendeskTicket() above — which relays through the Google Apps
 * Script bridge — these helpers talk to the Zendesk REST API directly using
 * the same Basic-auth (email + API token) config as getZendeskSupportOverview.
 *
 * Credentials come from env (ZENDESK_SUBDOMAIN / ZENDESK_EMAIL /
 * ZENDESK_API_TOKEN). To move to the per-org encrypted credential vault
 * later, swap getZendeskAuthConfig() for getIntegrationCredentials(orgId,
 * 'zendesk') — the call shapes below don't change.
 * ──────────────────────────────────────────────────────────────────────── */

/** Thrown when the Zendesk API credentials are not configured. Routes map this to 503. */
export class ZendeskNotConfiguredError extends Error {
    constructor(message = 'Zendesk API credentials are not configured') {
        super(message);
        this.name = 'ZendeskNotConfiguredError';
    }
}

/** Thrown for non-2xx Zendesk API responses. `status` mirrors the HTTP status. */
export class ZendeskApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'ZendeskApiError';
    }
}

export function isZendeskConfigured(): boolean {
    return getZendeskAuthConfig() !== null;
}

function requireZendeskConfig(): ZendeskAuthConfig {
    const config = getZendeskAuthConfig();
    if (!config) throw new ZendeskNotConfiguredError();
    return config;
}

/** Generalized Zendesk REST call: any method, optional JSON body, typed result. */
async function zendeskApiRequest<T = any>(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
    const config = requireZendeskConfig();
    const auth = Buffer.from(`${config.user}/token:${config.apiToken}`).toString('base64');
    const response = await fetch(`https://${config.subdomain}.zendesk.com${path}`, {
        method: init.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`,
            ...(init.headers ?? {}),
        },
        body: init.body != null ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ZendeskApiError(
            response.status,
            `Zendesk request failed (${response.status})${errorText ? `: ${errorText}` : ''}`,
        );
    }

    if (response.status === 204) return undefined as T;
    return response.json().catch(() => ({} as T));
}

export type ZendeskTicketStatus = 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed';
export type ZendeskTicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ZendeskTicketType = 'problem' | 'incident' | 'question' | 'task';

/** Raw Zendesk ticket object (subset of fields we rely on; extra keys preserved). */
export interface ZendeskTicket {
    id: number;
    subject: string | null;
    description?: string | null;
    raw_subject?: string | null;
    status: ZendeskTicketStatus | string;
    priority: ZendeskTicketPriority | string | null;
    type?: ZendeskTicketType | string | null;
    requester_id?: number;
    assignee_id?: number | null;
    group_id?: number | null;
    tags?: string[];
    external_id?: string | null;
    created_at: string;
    updated_at: string;
    url?: string;
    [key: string]: unknown;
}

export interface ZendeskComment {
    id: number;
    author_id: number;
    body: string;
    html_body?: string;
    public: boolean;
    created_at: string;
    [key: string]: unknown;
}

export interface ListTicketsParams {
    page?: number;
    perPage?: number;
    sortBy?: 'created_at' | 'updated_at' | 'priority' | 'status' | 'id';
    sortOrder?: 'asc' | 'desc';
}

export interface PaginatedTickets {
    tickets: ZendeskTicket[];
    count: number;
    next_page: string | null;
    previous_page: string | null;
}

function clampPage(page?: number): number {
    return Math.max(1, Math.floor(Number(page) || 1));
}
function clampPerPage(perPage?: number): number {
    return Math.min(100, Math.max(1, Math.floor(Number(perPage) || 25)));
}

/** List tickets, newest first by default. */
export async function listTickets(params: ListTicketsParams = {}): Promise<PaginatedTickets> {
    const qs = new URLSearchParams({
        page: String(clampPage(params.page)),
        per_page: String(clampPerPage(params.perPage)),
        sort_by: params.sortBy ?? 'created_at',
        sort_order: params.sortOrder ?? 'desc',
    });
    const data = await zendeskApiRequest<any>(`/api/v2/tickets.json?${qs.toString()}`);
    return {
        tickets: Array.isArray(data?.tickets) ? data.tickets : [],
        count: Number.isFinite(Number(data?.count)) ? Number(data.count) : 0,
        next_page: data?.next_page ?? null,
        previous_page: data?.previous_page ?? null,
    };
}

/** Search tickets via the Zendesk Search API. `type:ticket` is added if absent. */
export async function searchTickets(
    query: string,
    params: { page?: number; perPage?: number } = {},
): Promise<{ results: ZendeskTicket[]; count: number; next_page: string | null }> {
    const fullQuery = /\btype:/.test(query) ? query : `type:ticket ${query}`.trim();
    const qs = new URLSearchParams({
        query: fullQuery,
        sort_by: 'updated_at',
        sort_order: 'desc',
        page: String(clampPage(params.page)),
        per_page: String(clampPerPage(params.perPage)),
    });
    const data = await zendeskApiRequest<any>(`/api/v2/search.json?${qs.toString()}`);
    const results = (Array.isArray(data?.results) ? data.results : []).filter(
        (r: any) => String(r?.result_type || 'ticket') === 'ticket',
    );
    return {
        results,
        count: Number.isFinite(Number(data?.count)) ? Number(data.count) : results.length,
        next_page: data?.next_page ?? null,
    };
}

/** Fetch a single ticket. Returns null on 404. */
export async function getTicket(id: number): Promise<ZendeskTicket | null> {
    try {
        const data = await zendeskApiRequest<any>(`/api/v2/tickets/${id}.json`);
        return data?.ticket ?? null;
    } catch (err) {
        if (err instanceof ZendeskApiError && err.status === 404) return null;
        throw err;
    }
}

export interface CreateTicketInput {
    subject: string;
    // `uploads` carries upload tokens from uploadFileToZendesk() — Zendesk turns
    // each into a file attachment on this comment.
    comment: { body: string; html_body?: string; public?: boolean; uploads?: string[] };
    priority?: ZendeskTicketPriority;
    status?: ZendeskTicketStatus;
    type?: ZendeskTicketType;
    tags?: string[];
    requester?: { name?: string; email?: string };
    assignee_id?: number;
    group_id?: number;
    external_id?: string;
}

/**
 * Create a ticket directly via the REST API.
 *
 * Pass `opts.idempotencyKey` to dedupe retries: Zendesk caches the result of an
 * identical-key create for ~2h and returns the original ticket instead of making
 * a duplicate. Use a per-submit UUID so distinct submissions still create distinct tickets.
 */
/**
 * Upload one file to Zendesk's Uploads API and return its upload token. Pass the
 * token (or several) as `comment.uploads` on createTicket so the file rides along
 * as a real attachment on the ticket — not a link in the body. The body must be
 * raw bytes (not JSON), so this bypasses zendeskApiRequest and calls fetch directly.
 */
export async function uploadFileToZendesk(
    filename: string,
    bytes: Uint8Array,
    contentType = 'application/octet-stream',
): Promise<string> {
    const config = requireZendeskConfig();
    const auth = Buffer.from(`${config.user}/token:${config.apiToken}`).toString('base64');
    const response = await fetch(
        `https://${config.subdomain}.zendesk.com/api/v2/uploads.json?filename=${encodeURIComponent(filename)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': contentType, Authorization: `Basic ${auth}` },
            // Raw bytes (not JSON). Node's fetch accepts a Uint8Array body at
            // runtime; the cast sidesteps the over-narrow DOM BodyInit typing.
            body: bytes as unknown as BodyInit,
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ZendeskApiError(
            response.status,
            `Zendesk upload failed (${response.status})${errorText ? `: ${errorText}` : ''}`,
        );
    }
    const data = (await response.json().catch(() => ({}))) as { upload?: { token?: string } };
    const token = data.upload?.token;
    if (!token) throw new ZendeskApiError(502, 'Zendesk upload returned no token');
    return token;
}

export async function createTicket(
    input: CreateTicketInput,
    opts: { idempotencyKey?: string } = {},
): Promise<ZendeskTicket> {
    const data = await zendeskApiRequest<any>(`/api/v2/tickets.json`, {
        method: 'POST',
        body: { ticket: input },
        headers: opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined,
    });
    return data.ticket;
}

export interface UpdateTicketInput {
    subject?: string;
    /** Adding a comment is how Zendesk records ticket replies / internal notes. */
    comment?: { body: string; html_body?: string; public?: boolean };
    priority?: ZendeskTicketPriority;
    status?: ZendeskTicketStatus;
    type?: ZendeskTicketType;
    tags?: string[];
    assignee_id?: number | null;
    group_id?: number | null;
    external_id?: string | null;
}

/** Update a ticket. Returns null on 404. */
export async function updateTicket(
    id: number,
    input: UpdateTicketInput,
): Promise<ZendeskTicket | null> {
    try {
        const data = await zendeskApiRequest<any>(`/api/v2/tickets/${id}.json`, {
            method: 'PUT',
            body: { ticket: input },
        });
        return data?.ticket ?? null;
    } catch (err) {
        if (err instanceof ZendeskApiError && err.status === 404) return null;
        throw err;
    }
}

/** Soft-delete a ticket (Zendesk moves it to the deleted tickets view). Returns false on 404. */
export async function deleteTicket(id: number): Promise<boolean> {
    try {
        await zendeskApiRequest<void>(`/api/v2/tickets/${id}.json`, { method: 'DELETE' });
        return true;
    } catch (err) {
        if (err instanceof ZendeskApiError && err.status === 404) return false;
        throw err;
    }
}

/** List the comment thread (public replies + internal notes) for a ticket. */
export async function listTicketComments(
    id: number,
    params: { page?: number; perPage?: number } = {},
): Promise<{ comments: ZendeskComment[]; count: number; next_page: string | null }> {
    const qs = new URLSearchParams({
        page: String(clampPage(params.page)),
        per_page: String(clampPerPage(params.perPage)),
    });
    const data = await zendeskApiRequest<any>(
        `/api/v2/tickets/${id}/comments.json?${qs.toString()}`,
    );
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        count: Number.isFinite(Number(data?.count)) ? Number(data.count) : 0,
        next_page: data?.next_page ?? null,
    };
}

/**
 * Add a comment to a ticket. In Zendesk a comment is applied via a ticket
 * update, so this returns the updated ticket (or null if the ticket is gone).
 * `public: false` posts an internal note.
 */
export async function addTicketComment(
    id: number,
    comment: { body: string; html_body?: string; public?: boolean },
): Promise<ZendeskTicket | null> {
    return updateTicket(id, { comment });
}

export interface ZendeskAgent {
    id: number;
    name: string;
    email: string | null;
    role: string;
    photo: string | null;
}

/**
 * List agents + admins (the people a ticket can be assigned to). Powers the
 * assignee dropdown. Cached in-process for 5 min — the roster rarely changes.
 */
let agentCache: { at: number; agents: ZendeskAgent[] } | null = null;
const AGENT_CACHE_MS = 5 * 60 * 1000;

export async function listAgents(force = false): Promise<ZendeskAgent[]> {
    requireZendeskConfig();
    const now = Date.now();
    if (!force && agentCache && now - agentCache.at < AGENT_CACHE_MS) {
        return agentCache.agents;
    }
    // role[]=agent&role[]=admin returns assignable staff only.
    const data = await zendeskApiRequest<any>(
        `/api/v2/users.json?role[]=agent&role[]=admin&per_page=100`,
    );
    const agents: ZendeskAgent[] = (Array.isArray(data?.users) ? data.users : []).map(
        (u: any) => ({
            id: Number(u?.id),
            name: String(u?.name || 'Agent'),
            email: u?.email ?? null,
            role: String(u?.role || 'agent'),
            photo: u?.photo?.content_url ?? null,
        }),
    );
    agentCache = { at: now, agents };
    return agents;
}
