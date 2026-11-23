// src/api/client.js
// Final build-safe version for Vite & Vercel
// No JSX, no advanced syntax that confuses Rollup parser
import i18n from '@/i18n';

/**
 * @typedef {Object} ApiRequestOptions
 * @property {string=} method
 * @property {Record<string, string>=} headers
 * @property {any=} body
 * @property {AbortSignal=} signal
 * @property {boolean=} auth
 */

var getToken = function () {
    if (typeof window !== 'undefined') {
        return sessionStorage.getItem('access_token');
    }
    return null;
};

/**
 * @param {string} path
 * @param {ApiRequestOptions=} opt
 */
var shouldAttachAuth = function (path, opt) {
    if (opt && opt.auth === false) return false;
    if (opt && opt.auth === true) return true;
    // Default: only attach token to /api/admin, /api/auth, /api/pro
    return /^\/api\/(admin|auth|pro)\b/.test(path);
};

/**
 * Read the __csrf cookie value for Double-Submit Cookie pattern.
 * @returns {string|null}
 */
var getCsrfToken = function () {
    if (typeof document === 'undefined') return null;
    var match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
    return match ? match[1] : null;
};

/**
 * @param {string} path
 * @param {ApiRequestOptions=} options
 * @returns {Promise<any>}
 */
var apiRequest = async function (path, options) {
    var opt = options || {};
    var method = (opt.method || 'GET').toUpperCase();

    /** @type {Record<string, string>} */
    var headers = {
        "Content-Type": "application/json",
        ...(opt.headers || {}),
    };

    var token = getToken();
    // Use helper to decide if we send Authorization header
    if (token && shouldAttachAuth(path, opt)) {
        headers["Authorization"] = "Bearer " + token;
    }

    // CSRF Double-Submit Cookie — attach token for mutating requests
    if (method !== 'GET' && method !== 'HEAD') {
        var csrfToken = getCsrfToken();
        if (csrfToken) {
            headers['x-csrf-token'] = csrfToken;
        }
    }

    var res = await fetch(path, {
        method: method,
        headers: headers,
        body: opt.body ? JSON.stringify(opt.body) : undefined,
        signal: opt.signal,
    });

    var contentType = res.headers.get("content-type") || "";
    var payload = null;

    if (contentType.includes("application/json")) {
        payload = await res.json().catch(() => null);
    } else {
        payload = await res.text().catch(() => null);
    }

    if (!res.ok) {
        // UX ecosystem (2026-11-12): a screen that shows error.message showed « API Error: 429 » when the administration's per-address limit was reached
        // (60 requests a minute: a fast review session reaches it). A refused-for-volume or failed-server answer now reads as a sentence in the interface
        // language; status and payload are unchanged for the callers that branch on them.
        var human = res.status === 429 ? i18n.t('common:server.too_many', 'Trop de demandes en peu de temps : patientez une minute, puis réessayez.')
            : res.status >= 500 ? i18n.t('common:unavailable.text', "Le serveur n'a pas répondu. Votre session est conservée : réessayez dans un instant.") : null;
        /** @type {Error & {status?: number, payload?: unknown}} */
        var err = new Error(human || ("API Error: " + res.status));
        err.status = res.status;
        err.payload = payload;
        throw err;
    }

    return payload;
};

/**
 * Normalize API responses that may be paginated objects or flat arrays.
 * Handles: { items: [...] }, { data: [...] }, plain array, or single object.
 * @param {any} response
 * @returns {any[]}
 */
var normalizeResponse = function (response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.items)) return response.items;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
};

/** @param {string} endpoint */
var createEntityClient = function (endpoint) {
    return {
        /** @param {string=} sort @param {number | string=} limit */
        list: function (sort, limit) {
            var params = new URLSearchParams();
            if (sort) params.append('sort', sort);
            if (limit) params.append('limit', String(limit));
            var qs = params.toString();
            return apiRequest('/api/' + endpoint + (qs ? '?' + qs : '')).then(normalizeResponse);
        },
        /** @param {any} id */
        get: function (id) {
            return apiRequest('/api/' + endpoint + '?id=' + id);
        },
        /** @param {any} data */
        create: function (data) {
            return apiRequest('/api/' + endpoint, { method: 'POST', body: data });
        },
        /** @param {any} id @param {any} data */
        update: function (id, data) {
            return apiRequest('/api/' + endpoint + '?id=' + id, { method: 'PUT', body: data });
        },
        /** @param {any} id */
        delete: function (id) {
            return apiRequest('/api/' + endpoint + '?id=' + id, { method: 'DELETE' });
        },
        /** @param {Record<string, any>} query @param {string=} sort @param {number | string=} limit */
        filter: function (query, sort, limit) {
            var params = new URLSearchParams();
            Object.keys(query).forEach(function (k) {
                if (query[k] != null) params.append(k, query[k]);
            });
            if (sort) params.append('sort', sort);
            if (limit) params.append('limit', String(limit));
            return apiRequest('/api/' + endpoint + '?' + params.toString());
        }
    };
};

export const apiClient = {
    /**
     * Generic GET request — delegates to apiRequest.
     * Returns { data: payload } for compatibility with admin page callers.
     * @param {string} url
     * @returns {Promise<{ data: any }>}
     */
    get: function (url) {
        return apiRequest(url).then(function (payload) { return { data: payload }; });
    },
    taxonomy: {
        get: function () {
            return apiRequest('/api/taxonomy');
        }
    },
    /** G14 / DSA art. 16 — the account-free notice form and the notifier's appeal (closed while no content capability is open: 503) */
    notices: {
        status: function () { return apiRequest('/api/notices'); },
        /** @param {Record<string, unknown>} body */
        submit: function (body) { return apiRequest('/api/notices', { method: 'POST', body: Object.assign({}, body, { action: 'submit' }) }); },
        /** @param {{ noticeId: string, code: string, body: string }} body */
        appeal: function (body) { return apiRequest('/api/notices', { method: 'POST', body: Object.assign({}, body, { action: 'appeal' }) }); },
    },
    health: {
        check: function () {
            return apiRequest('/api/healthz');
        },
        deep: function () {
            return apiRequest('/api/health/deep', { auth: true });
        }
    },
    auth: {
        /** @param {string} email @param {string} password */
        login: async function (email, password) {
            var data = await apiRequest('/api/auth/login', {
                method: 'POST',
                body: { email: email, password: password, mode: 'admin' }
            });
            sessionStorage.setItem('access_token', data.token);
            return data.user;
        },
        /** PKG-5 / A16 — the separate administrator login surface; returns { mfa_required, mfa_setup_required }. @param {string} email @param {string} password */
        adminLogin: async function (email, password) {
            var data = await apiRequest('/api/admin/login', { method: 'POST', body: { email: email, password: password } });
            sessionStorage.setItem('access_token', data.token);
            return data;
        },
        /** @param {string} code */
        adminMfaVerify: async function (code) {
            var data = await apiRequest('/api/admin/mfa-verify', { method: 'POST', body: { code: code } });
            sessionStorage.setItem('access_token', data.token);
            return data;
        },
        adminMfaSetup: function () { return apiRequest('/api/admin/mfa-setup', { method: 'POST', body: {} }); },
        logout: async function () {
            // PKG-11 / ADM-10: the server ends every session of this administrator (best effort: the local token is dropped in any case)
            try { await apiRequest('/api/admin/sessions', { method: 'POST', body: { action: 'logout' } }); } catch { /* already signed out or offline */ }
            sessionStorage.removeItem('access_token');
            if (typeof window !== 'undefined') window.location.href = '/admin/login';
        },
        getUser: async function () {
            var token = getToken();
            if (!token) return null;
            try {
                var data = await apiRequest('/api/auth/me');
                return data.user;
            } catch (e) {
                // Q10: only a REFUSED session signs the administrator out; an outage (5xx, network) keeps the session and is reported to the caller
                var status = /** @type {{ status?: number }} */ (e || {}).status;
                if (status === 401 || status === 403) { sessionStorage.removeItem('access_token'); return null; }
                throw e;
            }
        }
    },
    admin: {
        /** automatic verification — the owner's digest (last runs, what was published / updated / withdrawn / added, the registry of sources). @param {number=} days */
        getVeille: function (days) { return apiRequest('/api/admin/veille?days=' + encodeURIComponent(String(days || 7))); },
        /** start a run now (LAB server only) */
        runVeille: function () { return apiRequest('/api/admin/veille', { method: 'POST', body: { action: 'run' } }); },
        /** one record's history, from its sources to the decisions. @param {string} kind @param {string} id */
        getVeilleHistory: function (kind, id) { return apiRequest('/api/admin/veille?history=' + encodeURIComponent(String(kind) + ':' + String(id))); },
        /** the owner's emergency stop (the run in progress stops at the next record, no new run starts) and its end. @param {string=} reason */
        pauseVeille: function (reason) { return apiRequest('/api/admin/veille', { method: 'POST', body: { action: 'pause', reason: reason || '' } }); },
        resumeVeille: function () { return apiRequest('/api/admin/veille', { method: 'POST', body: { action: 'resume' } }); },
        /** Actualités v2 — ADA's own articles. @param {string=} status */
        listNewsArticles: function (status) { return apiRequest('/api/admin/news-editorial' + (status ? '?status=' + encodeURIComponent(status) : '')); },
        /** @param {string} id */
        getNewsArticle: function (id) { return apiRequest('/api/admin/news-editorial?id=' + encodeURIComponent(String(id))); },
        /** @param {Record<string, unknown>} body { action: save|submit|reject|approve|correct|retract, id?, draft?, note?, kind? } */
        newsEditorial: function (body) { return apiRequest('/api/admin/news-editorial', { method: 'POST', body: body }); },
        /** C12 — the /ressources documents (needs migration 0050: available=false otherwise). */
        listResources: function () { return apiRequest('/api/admin/resources'); },
        /** @param {string} id */
        getResource: function (id) { return apiRequest('/api/admin/resources?id=' + encodeURIComponent(String(id))); },
        /** @param {Record<string, unknown>} body { action: create|edit|verify|publish|withdraw, id?, draft?, expectedVersion?, note?, reason? } */
        resourceAction: function (body) { return apiRequest('/api/admin/resources', { method: 'POST', body: body }); },
        /** X04 (expansion) — academy pages and events (closed by default: 503 CAPABILITY_NOT_OPEN). @param {string=} status */
        listAcademy: function (status) { return apiRequest('/api/admin/events' + (status ? '?status=' + encodeURIComponent(status) : '')); },
        /** @param {string} id */
        getAcademy: function (id) { return apiRequest('/api/admin/events?id=' + encodeURIComponent(String(id))); },
        /** @param {Record<string, unknown>} body { action: save|submit|reject|approve|cancel|withdraw, id?, draft?, note? } */
        academyAction: function (body) { return apiRequest('/api/admin/events', { method: 'POST', body: body }); },
        /** X02 (expansion) — testimonial moderation (closed by default: 503 CAPABILITY_NOT_OPEN). @param {string} queue pending | reported | published */
        listTestimonials: function (queue) { return apiRequest('/api/admin/testimonials?queue=' + encodeURIComponent(queue || 'pending')); },
        /** @param {Record<string, unknown>} body { action: approve|reject|takedown|dismiss_reports, id, reason? } */
        testimonialAction: function (body) { return apiRequest('/api/admin/testimonials', { method: 'POST', body: body }); },
        /** X01 (expansion) — community story moderation (closed by default: 503 CAPABILITY_NOT_OPEN). @param {string} queue pending | reported | published */
        listStories: function (queue) { return apiRequest('/api/admin/stories?queue=' + encodeURIComponent(queue || 'pending')); },
        /** @param {Record<string, unknown>} body { action: approve|reject|takedown|dismiss_reports, id, reason? } */
        storyAction: function (body) { return apiRequest('/api/admin/stories', { method: 'POST', body: body }); },
        /** X05 (expansion) — job listing review (closed by default: 503 CAPABILITY_NOT_OPEN). @param {string} queue pending | published */
        listJobListings: function (queue) { return apiRequest('/api/admin/employment?queue=' + encodeURIComponent(queue || 'pending')); },
        /** @param {Record<string, unknown>} body { action: approve|reject|takedown, id, reason? } */
        jobListingAction: function (body) { return apiRequest('/api/admin/employment', { method: 'POST', body: body }); },
        /** X03 (expansion) — Entraide moderation (closed by default: 503 CAPABILITY_NOT_OPEN; dedicated AIPD first). @param {string} queue reported | suspended */
        listEntraide: function (queue) { return apiRequest('/api/admin/entraide?queue=' + encodeURIComponent(queue || 'reported')); },
        /** @param {Record<string, unknown>} body { action: suspend|reinstate|dismiss_reports|close_offer, pseudonym?, offerId?, reason? } */
        entraideAction: function (body) { return apiRequest('/api/admin/entraide', { method: 'POST', body: body }); },
        /** G14 — the moderation desk: staffing, named roles, notices, appeals, transparency. @param {string} view staffing|roles|notices|appeals|transparency|misuse @param {Record<string, string>=} params */
        moderation: function (view, params) { return apiRequest('/api/admin/moderation?view=' + encodeURIComponent(view || 'staffing') + Object.entries(params || {}).map(function (kv) { return '&' + encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1]); }).join('')); },
        /** @param {Record<string, unknown>} body { action: role_assign|role_revoke|notice_record_email|notice_close|appeal_review|sanction|sanction_lift|authorities_informed, … } */
        moderationAction: function (body) { return apiRequest('/api/admin/moderation', { method: 'POST', body: body }); },
        /** PKG-5 / E01 — organizations with identity / activity / public status kept apart. @param {string=} q @param {string=} decision never | hold | rejected | verified */
        getOrganizations: function (q, decision) { return apiRequest('/api/admin/organizations?q=' + encodeURIComponent(q || '') + (decision ? '&decision=' + encodeURIComponent(decision) : '')); },
        /** PKG-5 / A16 — elevation state, JIT elevation, break-glass, review. The returned token replaces the session. */
        getElevation: function () { return apiRequest('/api/admin/elevation'); },
        /** PKG-11 / ADM-10 — administrators, recent session events; revoke / disable / enable another administrator (elevated superadmin). */
        getSessions: function () { return apiRequest('/api/admin/sessions'); },
        /** @param {Record<string, unknown>} body */
        sessions: function (body) { return apiRequest('/api/admin/sessions', { method: 'POST', body: body }); },
        /** @param {Record<string, unknown>} body */
        elevation: async function (body) {
            var data = await apiRequest('/api/admin/elevation', { method: 'POST', body: body });
            if (data && data.token) sessionStorage.setItem('access_token', data.token);
            return data;
        },
        /** PKG-5 batch 2 — K5 administrator surfaces (privacy, support, audit, platform, versions, data quality, institutions). @param {string} path @param {Record<string, unknown>=} body */
        k5: function (path, body) { return apiRequest('/api' + '/admin/' + path, body ? { method: 'POST', body: body } : undefined); },   // every target is an admin/* route listed in api/routes.js
        /** PKG-5 / P19 — content-report triage (administrator session); contentType filters by kind (DISPOSITIF covers both forms). @param {string} status @param {string=} contentType */
        contentReports: function (status, contentType) { return apiRequest('/api/reports?status=' + encodeURIComponent(status || 'NEW') + (contentType ? '&contentType=' + encodeURIComponent(contentType) : ''), { auth: true }); },
        /** @param {string} id @param {string} status */
        /** @param {string} id @param {string} status @param {string=} note kept in the journal */
        setContentReport: function (id, status, note) { return apiRequest('/api/reports?id=' + encodeURIComponent(id), { method: 'PUT', body: note ? { status: status, note: note } : { status: status }, auth: true }); },
        /** PKG-5 / WS2 — launch records with their human-verification state (ledger only). */
        getWs2Queue: function () { return apiRequest('/api/admin/ws2-queue'); },
        /** @param {string} id @param {'SUSPEND'|'REACTIVATE'} action @param {string} reason */
        setOrganizationActivity: function (id, action, reason) { return apiRequest('/api/admin/organizations', { method: 'POST', body: { id: id, action: action, reason: reason } }); },
        /** G8 — the organization's ADA Pro accounts (no secret). @param {string} id */
        getOrganizationMembers: function (id) { return apiRequest('/api/admin/organizations?members=' + encodeURIComponent(id || '')); },
        /** G8 — ADA's action on one professional account (MFA, reason). @param {string} userId @param {'DISABLE_PRO_ACCOUNT' | 'ERASE_PRO_ACCOUNT'} action @param {string} reason */
        administerProAccount: function (userId, action, reason) { return apiRequest('/api/admin/organizations', { method: 'POST', body: { userId: userId, action: action, reason: reason } }); },
        /** G14 — a structure's own ADA Pro sign-up request: verify on an official source, activate, send the MFA invitation (MFA, one transaction)
         * @param {string} userId @param {{ sourceUrl: string, evidenceNote: string, territoryConfirmed: boolean, expectedVersion: string }} input */
        verifyAndActivateProRegistration: function (userId, input) { return apiRequest('/api/admin/organizations', { method: 'POST', body: Object.assign({ userId: userId, action: 'VERIFY_AND_ACTIVATE_PRO_REGISTRATION' }, input) }); },
        /** G14 — refuse a structure's own ADA Pro sign-up request (the pending account is disabled; MFA, reason) @param {string} userId @param {string} reason */
        refuseProRegistration: function (userId, reason) { return apiRequest('/api/admin/organizations', { method: 'POST', body: { userId: userId, action: 'REFUSE_PRO_REGISTRATION', reason: reason } }); },
        /** identity verification = the existing MFA content-verification flow @param {{ entityId: string, action: string, sourceUrl?: string, evidenceNote?: string, territoryConfirmed?: boolean, holdReason?: string }} input */
        verifyContent: function (input) { return apiRequest('/api/admin/content-verification', { method: 'POST', body: Object.assign({ entityType: 'structure' }, input) }); },
        /** owner LAB audit: the public content of a record, in full, and the `version` a VERIFY / RELEASE_HOLD is bound to (+ the decision history) */
        /** D13 duplicate register: candidate pairs, or one pair in full (a, b) */
        getDuplicates: function (/** @type {string=} */ a, /** @type {string=} */ b) { return apiRequest('/api/admin/duplicates' + (a && b ? '?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b) : '')); },
        /** @param {{ a: string, b: string, decision: string, primaryId?: string, evidenceUrl: string, note: string, versionA: string, versionB: string }} input */
        decideDuplicate: function (input) { return apiRequest('/api/admin/duplicates', { method: 'POST', body: input }); },
        /** bulk duplicate register: every pair with both records, their versions and the evidence assistance; or the recent decisions ('history') @param {'register'|'history'} view */
        getDuplicateRegister: function (view) { return apiRequest('/api/admin/duplicates?view=' + encodeURIComponent(view || 'register')); },
        /** several decisions, each through the single-decision path; one result per item @param {any[]} decisions */
        decideDuplicates: function (decisions) { return apiRequest('/api/admin/duplicates', { method: 'POST', body: { decisions: decisions } }); },
        /** RA-05 — the decided pairs (filters, pages); a replacement goes through decideDuplicates with expectedDecisionId */
        getDecidedDuplicates: function (/** @type {Record<string, any>=} */ params) {
            var qs = Object.entries(params || {}).filter(function (e) { return e[1] !== '' && e[1] !== null && e[1] !== undefined; }).map(function (e) { return encodeURIComponent(e[0]) + '=' + encodeURIComponent(String(e[1])); }).join('&');
            return apiRequest('/api/admin/duplicates?view=decided' + (qs ? '&' + qs : ''));
        },
        /** @param {string} entityType @param {string} entityId */
        getVerification: function (entityType, entityId) { return apiRequest('/api/admin/content-verification?entityType=' + encodeURIComponent(entityType) + '&entityId=' + encodeURIComponent(entityId)); },
        /** PKG-4 / E02 — structure profile proposals awaiting ADA review. @param {string=} status */
        getStructureProposals: function (status) {
            return apiRequest('/api/admin/structure-proposals?status=' + encodeURIComponent(status || 'PENDING'));
        },
        /** @param {string} id @param {'ACCEPT'|'REJECT'} decision @param {string=} note @param {{ sourceUrl?: string, territoryConfirmed?: boolean }=} evidence */
        decideStructureProposal: function (id, decision, note, evidence) {
            return apiRequest('/api/admin/structure-proposals', { method: 'POST', body: { id: id, decision: decision, note: note || '', sourceUrl: (evidence && evidence.sourceUrl) || '', territoryConfirmed: Boolean(evidence && evidence.territoryConfirmed) } });
        },
        /** @param {string=} status @param {number=} page */
        getInbox: function (status, page) {
            return apiRequest('/api/admin/inbox?status=' + (status || 'brouillon') + '&page=' + (page || 1));
        },
        /** @param {string} action @param {string[]} ids @param {string} [reason] required to publish or reject (launch-readiness item 65) */
        performAction: function (action, ids, reason) {
            return apiRequest('/api/admin/actions', {
                method: 'POST',
                body: { action: action, ids: ids, ...(reason ? { reason } : {}) }
            });
        },
        // PKG-11 / A02: catalogue administration — drafts and unverified records included; writes need the session's MFA; archive, never delete
        content: {
            /** @param {'aide'|'demarche'|'structure'} kind @param {string=} q @param {string=} status all | never | hold | edit | rejected | verified */
            list: function (kind, q, status) { return apiRequest('/api/admin/content?kind=' + encodeURIComponent(kind) + (q ? '&q=' + encodeURIComponent(q) : '') + (status && status !== 'all' ? '&status=' + encodeURIComponent(status) : '')); },
            /** @param {'aide'|'demarche'|'structure'} kind @param {string} id */
            get: function (kind, id) { return apiRequest('/api/admin/content?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id)); },
            /** @param {'aide'|'demarche'|'structure'} kind @param {Record<string, any>} data */
            create: function (kind, data) { return apiRequest('/api/admin/content?kind=' + encodeURIComponent(kind), { method: 'POST', body: data }); },
            /** @param {'aide'|'demarche'|'structure'} kind @param {string} id @param {Record<string, any>} data */
            update: function (kind, id, data) { return apiRequest('/api/admin/content?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id), { method: 'PUT', body: data }); },
            /** @param {'aide'|'demarche'|'structure'} kind @param {string} id */
            archive: function (kind, id) { return apiRequest('/api/admin/content?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id), { method: 'DELETE' }); },
        },
        getRuns: function () {
            return apiRequest('/api/admin/runs');
        },
        /** @param {string=} job @param {number | string=} limit */
        getCronRuns: function (job, limit) {
            var params = new URLSearchParams();
            if (job) params.append('job', job);
            if (limit != null) params.append('limit', String(limit));
            return apiRequest('/api/admin/cron-runs?' + params.toString());
        },
        /** @param {string} id */
        getCronRun: function (id) {
            return apiRequest('/api/admin/cron-runs/' + encodeURIComponent(id));
        },
        /** @param {number=} limitPerType */
        scanReviewQueue: function (limitPerType) {
            var body = {};
            if (limitPerType != null) body.limitPerType = Number(limitPerType);
            return apiRequest('/api/admin/review-queue/scan', {
                method: 'POST',
                body: body
            });
        },
        /**
         * @param {{ status?: string, entityType?: string, reason?: string, limit?: number | string, cursor?: string }=} filters
         */
        getReviewQueueItems: function (filters) {
            var params = new URLSearchParams();
            var input = filters || {};
            if (input.status) params.append('status', String(input.status));
            if (input.entityType) params.append('entityType', String(input.entityType));
            if (input.reason) params.append('reason', String(input.reason));
            if (input.limit != null) params.append('limit', String(input.limit));
            if (input.cursor) params.append('cursor', String(input.cursor));
            return apiRequest('/api/admin/review-queue?' + params.toString());
        },
        /** @param {string} id @param {'resolved' | 'ignored'} status @param {string=} reason the reviewer's reason (required by the server for an AI suggestion) */
        updateReviewQueueStatus: function (id, status, reason) {
            return apiRequest('/api/admin/review-queue/' + encodeURIComponent(id), {
                method: 'PATCH',
                body: reason ? { status: status, reason: reason } : { status: status }
            });
        },
        /** @param {string[]} ids @param {'resolved' | 'ignored'} status @param {string=} reason */
        bulkUpdateReviewQueue: function (ids, status, reason) {
            return apiRequest('/api/admin/review-queue/bulk', {
                method: 'PATCH',
                body: Object.assign({
                    ids: Array.isArray(ids) ? ids : [],
                    status: status
                }, reason ? { reason: reason } : {})
            });
        },
        /** @param {string} itemId */
        hiveRepair: function (itemId) {
            return apiRequest('/api/admin/hive-repair', {
                method: 'POST',
                body: { itemId: itemId }
            });
        },
        /** @param {string=} severity @param {number=} limit */
        bulkRepairAI: function (severity, limit) {
            return apiRequest('/api/admin/bulk-repair', {
                method: 'POST',
                body: { severity: severity || 'P0', limit: limit || 10 }
            });
        }
    },
    monitor: {
        getDataQuality: function () {
            return apiRequest('/api/monitor/data-quality');
        },
        getIngestionFreshness: function () {
            return apiRequest('/api/monitor/ingestion-freshness');
        }
    },
    entities: {
        Aide: createEntityClient('aides'),
        Structure: createEntityClient('structures'),
        Demarche: createEntityClient('demarches'),
        Actualite: createEntityClient('actualites'),
        Guide: createEntityClient('guides'),
        UpdateLog: createEntityClient('update-logs'),
        Source: createEntityClient('sources')
    },
    integrations: {
        Core: {
            /** @param {string | { prompt: string }} input */
            InvokeLLM: function (input) {
                var prompt =
                    typeof input === 'string'
                        ? input
                        : (input && typeof input === 'object' && 'prompt' in input)
                            ? input.prompt
                            : '';
                return apiRequest('/api/integrations/core/invoke', {
                    method: 'POST',
                    body: { prompt: prompt }
                });
            }
        }
    }
};

export const adminClient = apiClient;
export const publicClient = apiClient;
export const client = apiClient;
export const api = apiClient;

export default apiClient;
