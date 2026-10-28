/**
 * Assistant API client.
 *
 * Typed POST wrapper for /api/assistant/chat with 15s timeout.
 * No external dependencies — native fetch only.
 */

import { getApiBaseUrl } from '../api/config';
import { ensureCsrfHeaders, getCsrfHeaders } from '../csrf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssistantContext {
    territory?: string;
    lang?: 'fr' | 'en';
    page?: string;
    wizard?: Record<string, unknown>;
}

export interface AssistantRequest {
    message: string;
    context?: AssistantContext;
}

export interface AssistantCitation {
    label: string;
    url?: string;
}

export interface AssistantResponse {
    answer: string;
    citations?: AssistantCitation[];
    meta: {
        model: string;
        rulepack: string;
        requestId: string;
    };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AssistantError extends Error {
    status: number;
    code: string;
    userMessage: string;

    constructor(status: number, code: string, userMessage: string) {
        super(userMessage);
        this.name = 'AssistantError';
        this.status = status;
        this.code = code;
        this.userMessage = userMessage;
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASSISTANT_TIMEOUT_MS = 15_000;
const ENDPOINT = '/api/assistant/chat';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Send a message to the assistant API.
 *
 * @throws {AssistantError} on HTTP error, timeout, or network failure
 */
export async function sendMessage(
    message: string,
    context?: AssistantContext,
    options?: { signal?: AbortSignal },
): Promise<AssistantResponse> {
    const url = `${getApiBaseUrl()}${ENDPOINT}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);

    // Honour caller-provided signal (e.g. React unmount).
    if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), {
            once: true,
        });
    }

    const body: AssistantRequest = { message };
    if (context) body.context = context;

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                // PKG-11: bootstrap the CSRF token in a browser (the first POST of a page carried none and was refused)
                ...(typeof document !== 'undefined' ? ((await ensureCsrfHeaders().catch(() => null)) || {}) : getCsrfHeaders()),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error: unknown) {
        clearTimeout(timeoutId);
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new AssistantError(
                0,
                'timeout',
                'L\'assistant met trop de temps à répondre. Veuillez réessayer.',
            );
        }
        throw new AssistantError(
            0,
            'network_error',
            'Impossible de contacter l\'assistant. Vérifiez votre connexion.',
        );
    } finally {
        clearTimeout(timeoutId);
    }

    // ---------- Parse response ----------
    let data: Record<string, unknown>;
    try {
        data = (await response.json()) as Record<string, unknown>;
    } catch {
        throw new AssistantError(
            response.status,
            'invalid_response',
            'Réponse invalide du serveur.',
        );
    }

    // ---------- HTTP errors ----------
    if (!response.ok) {
        const code = (typeof data.error === 'string' ? data.error : 'unknown') as string;
        const msg = (typeof data.message === 'string' ? data.message : undefined) as string | undefined;

        if (response.status === 429) {
            throw new AssistantError(429, code, msg || 'Trop de messages envoyés. Veuillez patienter.');
        }
        if (response.status === 400) {
            throw new AssistantError(400, code, msg || 'Message invalide.');
        }
        throw new AssistantError(
            response.status,
            code,
            msg || 'Une erreur est survenue. Veuillez réessayer.',
        );
    }

    return data as unknown as AssistantResponse;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface RecommendationItem {
    type: 'aide' | 'demarche' | 'structure';
    slug: string | null;
    title: string | null;
    excerpt: string | null;
    url: string | null;
    sourceLabel?: string | null;
    sourceUrl?: string | null;
    verifiedAt?: string | null;
}

export interface RecommendationsRequest {
    need: string;
    territory?: string;
    limit?: number;
    types?: Array<'aide' | 'demarche' | 'structure'>;
}

export interface RecommendationsResponse {
    items: RecommendationItem[];
    meta: {
        from: string;
        method: string;
        requestId: string;
    };
}

const RECOS_ENDPOINT = '/api/assistant/recommendations';

/**
 * Fetch recommendations from the ADA search API.
 *
 * @throws {AssistantError} on HTTP error, timeout, or network failure
 */
export async function postRecommendations(
    params: RecommendationsRequest,
    options?: { signal?: AbortSignal },
): Promise<RecommendationsResponse> {
    const url = `${getApiBaseUrl()}${RECOS_ENDPOINT}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);

    if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), {
            once: true,
        });
    }

    let response: Response;
    try {
        // PKG-11 audit: a protected POST — before, no CSRF header was sent and the orientation wizard's recommendations were refused (403) in every real browser
        const csrf = typeof document !== 'undefined' ? ((await ensureCsrfHeaders().catch(() => null)) || {}) : getCsrfHeaders();
        response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...csrf,
            },
            body: JSON.stringify(params),
            signal: controller.signal,
        });
    } catch (error: unknown) {
        clearTimeout(timeoutId);
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new AssistantError(
                0,
                'timeout',
                'La recherche prend trop de temps. Veuillez réessayer.',
            );
        }
        throw new AssistantError(
            0,
            'network_error',
            'Impossible de contacter le serveur. Vérifiez votre connexion.',
        );
    } finally {
        clearTimeout(timeoutId);
    }

    let data: Record<string, unknown>;
    try {
        data = (await response.json()) as Record<string, unknown>;
    } catch {
        throw new AssistantError(
            response.status,
            'invalid_response',
            'Réponse invalide du serveur.',
        );
    }

    if (!response.ok) {
        const code = (typeof data.error === 'string' ? data.error : 'unknown') as string;
        const msg = (typeof data.message === 'string' ? data.message : undefined) as string | undefined;
        throw new AssistantError(
            response.status,
            code,
            msg || 'Une erreur est survenue. Veuillez réessayer.',
        );
    }

    return data as unknown as RecommendationsResponse;
}
