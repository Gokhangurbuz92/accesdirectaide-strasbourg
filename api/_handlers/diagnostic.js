// @ts-nocheck
import logger from '../_utils/logger.js';
import { resolveAuthContext } from '../_utils/auth.js';
/**
 * POST /api/diagnostic      — public: compute rights via OpenFisca
 * POST /api/diagnostic/trace — pro/admin: get OpenFisca trace
 *
 * Phase 2: SyncRun tracing for observability.
 */

import * as Sentry from '@sentry/node';
// DTA S1D: loaded lazily, only on the AUTHORITATIVE / trace paths. The client module throws at import when no OPENFISCA_URL is configured outside production, which made even SIMULATION_MODE answer 500.
let openfiscaModule = null;
const openfisca = async () => (openfiscaModule ??= await import('../lib/openfiscaClient.js'));
import { buildTestCase, parseResults, getCurrentPeriod } from '../lib/openfiscaMapping.js';
import { qualifyEstimates, traceQualification } from '../lib/openfiscaEstimate.js';
import { runLocalSimulation } from '../lib/LocalRulesEngine.js';
import { ageFromBand } from '../lib/ageBands.js';
import { checkRateLimit } from '../_utils/rateLimit.js';
import { db } from '../../src/db/index.js';
import { SyncRun } from '../../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import crypto from 'crypto';
import { engineUnavailableAssessment, simulationResponse } from '../lib/diagnosticAssessment.js';
import { ERROR_CODES, SAFE_MESSAGES, captureSafe, classifyError, parseJsonBody } from '../lib/diagnosticErrors.js';
import { clientIp } from '../_utils/client-ip.js';

// Simple input validation — we use manual checks to avoid adding a Zod dependency
/**
 * @param {{ birthDate: string; income: { salary: number | null; unemployment: number | null; }; housing: { rent: number | null; charges: number | null; }; }} answers
 */
function validateAnswers(answers) {
    const errors = [];
    if (!answers || typeof answers !== 'object') {
        return ['answers is required and must be an object'];
    }
    // DTA S2B (D3d, data minimisation): an exact birth date OR an age band from the closed vocabulary
    const hasBand = !answers.birthDate && ageFromBand(answers.ageBand) !== null;
    if (!hasBand && (!answers.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(answers.birthDate))) {
        errors.push('birthDate is required (YYYY-MM-DD format)');
    }
    if (answers.income) {
        if (answers.income.salary != null && (isNaN(answers.income.salary) || answers.income.salary < 0)) {
            errors.push('income.salary must be a non-negative number');
        }
        if (answers.income.unemployment != null && (isNaN(answers.income.unemployment) || answers.income.unemployment < 0)) {
            errors.push('income.unemployment must be a non-negative number');
        }
    }
    if (answers.housing) {
        if (answers.housing.rent != null && (isNaN(answers.housing.rent) || answers.housing.rent < 0)) {
            errors.push('housing.rent must be a non-negative number');
        }
        if (answers.housing.charges != null && (isNaN(answers.housing.charges) || answers.housing.charges < 0)) {
            errors.push('housing.charges must be a non-negative number');
        }
    }
    return errors;
}

/**
 * Generate a short request ID for logging (no PII).
 */
function generateRequestId() {
    return `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export default async function handler(req, /** @type {string | number | boolean | null | undefined} */ res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathSuffix = url.pathname.replace(/^\/api\/diagnostic\/?/, '');

    // Route: /api/diagnostic/trace
    if (pathSuffix === 'trace') {
        return handleTrace(req, res);
    }

    // Route: /api/diagnostic (main)
    return handleDiagnostic(req, res);
}

// @ts-ignore
/**
 * PKG-11 audit: the SyncRun opened for this request is always closed — a rate-limited, invalid or unavailable request used to leave a « running » row for
 * ever (and push the real synchronization runs out of the admin run history).
 */
async function handleDiagnostic(req, res) {
    const track = { syncRunId: null };
    try {
        return await handleDiagnosticInner(req, res, track);
    } finally {
        if (track.syncRunId) {
            await db.update(SyncRun).set({ status: 'rejected', ended_at: new Date() })
                .where(and(eq(SyncRun.id, track.syncRunId), eq(SyncRun.status, 'running'))).catch(() => {});
        }
    }
}

async function handleDiagnosticInner(req, res, track) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed', allowed: ['POST'] });
    }

    const requestId = generateRequestId();
    const start = Date.now();

    // ── Phase 2: SyncRun tracing ──
    let syncRunId = null;
    try {
        const [run] = await db.insert(SyncRun).values({
            id: crypto.randomUUID(),
            source_id: 'openfisca-diagnostic',
            status: 'running',
            started_at: new Date(),
            stats: { requestId },
        }).returning({ id: SyncRun.id });
        syncRunId = run.id;
        track.syncRunId = run.id;
    } catch {
        // SyncRun logging must never break the diagnostic flow
    }

    try {
        // Rate limiting
        const ip = clientIp(req);
        const rateLimitResult = await checkRateLimit('DIAGNOSTIC', ip);
        if (rateLimitResult && !rateLimitResult.allowed) {
            return res.status(429).json({
                error: 'rate_limit_exceeded',
                message: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
                requestId,
            });
        }

        // Parse and validate before selecting an engine.
        // No mode means authoritative OpenFisca behavior, preserving existing callers.
        let body;
        if (typeof req.body === 'object' && req.body !== null) {
            body = req.body;
        } else if (typeof req.body === 'string') {
            body = parseJsonBody(req.body);
        } else {
            return res.status(400).json({ error: 'invalid_body', message: 'Request body is required (JSON)', requestId });
        }

        const { answers } = body;
        const errors = validateAnswers(answers);
        if (errors.length > 0) {
            return res.status(400).json({ error: 'validation_error', details: errors, requestId });
        }

        const mode = body.mode || 'AUTHORITATIVE_MODE';
        if (mode !== 'AUTHORITATIVE_MODE' && mode !== 'SIMULATION_MODE') {
            return res.status(400).json({
                error: 'invalid_diagnostic_mode',
                message: 'mode must be AUTHORITATIVE_MODE or SIMULATION_MODE',
                requestId,
            });
        }

        // Explicit local simulation only. This is never an automatic fallback.
        if (mode === 'SIMULATION_MODE') {
            const simulation = runLocalSimulation(answers);
            const duration = Date.now() - start;
            logger.info('[Diagnostic/Simulation]', {
                requestId,
                duration_ms: duration,
                rightsCount: simulation.rights.length,
                mode: simulation.mode,
            });

            if (syncRunId) {
                try {
                    await db.update(SyncRun).set({
                        status: 'success',
                        ended_at: new Date(),
                        stats: {
                            requestId,
                            duration_ms: duration,
                            rightsCount: simulation.rights.length,
                            mode: simulation.mode,
                        },
                    }).where(eq(SyncRun.id, syncRunId));
                } catch {
                    // Metrics-only SyncRun update must never break the response.
                }
            }

            // DTA S1 2b-1: the response carries the assessment contract (states + provenance), never the legacy eligible flags / estimated amounts.
            return res.status(200).json(simulationResponse(simulation, answers, { requestId, duration_ms: duration }));
        }

        // AUTHORITATIVE_MODE remains fail-closed. Never fall back to LocalRulesEngine.
        let engineUp = false;
        try {
            engineUp = await (await openfisca()).isAvailable();
        } catch (healthCheckErr) {
            // privacy: never log/forward the original exception (message/detail/stack may carry upstream or request text)
            logger.warn('[Diagnostic] isAvailable() threw', { requestId, code: ERROR_CODES.HEALTHCHECK_FAILED });
            captureSafe(Sentry, ERROR_CODES.HEALTHCHECK_FAILED, { requestId, phase: 'health-check' });
        }
        if (!engineUp) {
            logger.warn('[Diagnostic] OpenFisca unavailable (cached health probe)', { requestId });
            return res.status(503).json({
                code: 'OPENFISCA_UNAVAILABLE',
                error: 'OPENFISCA_UNAVAILABLE',
                message: 'Service de calcul temporairement indisponible. Veuillez réessayer dans quelques instants.',
                assessment: engineUnavailableAssessment({ retryable: true }),
                requestId,
            });
        }

        // Build OpenFisca test case
        const period = getCurrentPeriod();
        const situation = buildTestCase(answers, period);

        // Call OpenFisca
        const result = await (await openfisca()).calculate(situation);

        // Parse results
        const rights = parseResults(result, period);
        // R15 (D10 / D20): an engine value is shown only as a qualified order of magnitude when the form gave what that right needs; otherwise the right is
        // INSUFFICIENT_INFORMATION and the missing inputs are named. The raw engine values (exact amounts, « eligible » flags) never leave the server.
        const engineVersion = process.env.OPENFISCA_FRANCE_VERSION || null;
        const estimates = qualifyEstimates(rights, answers, { period, engineVersion });

        const duration = Date.now() - start;
        logger.info('[Diagnostic]', { requestId, duration_ms: duration, rightsCount: rights.length });

        // ── Phase 2: SyncRun success ──
        if (syncRunId) {
            try {
                await db.update(SyncRun).set({
                    status: 'success',
                    ended_at: new Date(),
                    stats: {
                        requestId,
                        duration_ms: duration,
                        rightsCount: rights.length,
                        eligibleCount: estimates.items.filter((i) => i.status === 'INDICATIVE_ESTIMATE').length,
                        variables: rights.map(r => r.code),
                    },
                }).where(eq(SyncRun.id, syncRunId));
            } catch {
                // SyncRun update must never break the response
            }
        }

        return res.status(200).json({
            period,
            authoritative: false,
            estimates,
            meta: {
                source: 'openfisca',
                engineVersion,
                requestId,
                duration_ms: duration,
            },
        });
    } catch (err) {
        const duration = Date.now() - start;
        // privacy (DTA S1 stage 2a): the original exception is NEVER logged, stored or forwarded — only a closed-vocabulary code and the opaque request id.
        const code = classifyError(err);
        logger.error('[Diagnostic] ERROR', {
            requestId,
            duration_ms: duration,
            code,
        });

        // ── Phase 2: SyncRun failure ──
        if (syncRunId) {
            try {
                await db.update(SyncRun).set({
                    status: 'failed',
                    ended_at: new Date(),
                    error: code,
                    stats: { requestId, duration_ms: duration },
                }).where(eq(SyncRun.id, syncRunId));
            } catch {
                // SyncRun update must never break the error response
            }
        }

        captureSafe(Sentry, code, { requestId, phase: 'diagnostic', durationMs: duration });

        // Graceful error responses (fixed texts only: nothing from the request or from an upstream response is echoed)
        if (code === ERROR_CODES.INVALID_JSON) {
            return res.status(400).json({ error: 'invalid_json', message: 'Le corps de la requête n\'est pas un JSON valide.', requestId });
        }
        // @ts-ignore
        if (err && err.fallback === true) {
            return res.status(503).json({
                error: SAFE_MESSAGES.ENGINE_FALLBACK,
                fallback: true,
                requestId,
            });
        }

        // @ts-ignore
        if (err.code === 'OPENFISCA_TIMEOUT' || err.code === 'OPENFISCA_NETWORK_ERROR') {
            return res.status(503).json({
                error: 'OPENFISCA_UNAVAILABLE',
                message: 'Le service de calcul est temporairement indisponible. Veuillez réessayer dans quelques instants.',
                requestId,
            });
        }

        // @ts-ignore
        if (err.status >= 400 && err.status < 500) {
            return res.status(422).json({
                error: 'OPENFISCA_INVALID_INPUT',
                message: 'Les données fournies ne sont pas compatibles avec le moteur de calcul.',
                requestId,
            });
        }

        return res.status(503).json({
            error: 'DIAGNOSTIC_ERROR',
            message: 'Une erreur est survenue lors du calcul. Veuillez réessayer.',
            requestId,
        });
    }
}

// @ts-ignore
async function handleTrace(/** @type {{ body: string | number | boolean | null | undefined, method: string | number | boolean | null | undefined, proId: string | number | boolean | null | undefined }} */ req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed', allowed: ['POST'] });
    }

    // Pro/admin authentication check using canonical auth flow
    const auth = await resolveAuthContext(req);
    const isAdmin = auth && (auth.authType === 'admin_token' || auth.authType === 'admin_jwt');

    // Also check for pro session (cookie-based auth)
    const proId = req.proId; // Set by auth middleware if pro is logged in

    if (!isAdmin && !proId) {
        return res.status(403).json({
            error: 'access_denied',
            message: 'L\'accès au détail du calcul est réservé aux professionnels.',
        });
    }

    const requestId = generateRequestId();

    try {
        let body;
        if (typeof req.body === 'object' && req.body !== null) {
            body = req.body;
        } else if (typeof req.body === 'string') {
            body = parseJsonBody(req.body);
        } else {
            return res.status(400).json({ error: 'invalid_body', requestId });
        }

        const { answers } = body;
        const errors = validateAnswers(answers);
        if (errors.length > 0) {
            return res.status(400).json({ error: 'validation_error', details: errors, requestId });
        }

        const period = getCurrentPeriod();
        const situation = buildTestCase(answers, period);

        const result = await (await openfisca()).trace(situation);

        // Return a summary of the trace (not the full graph)
        const traceSummary = {
            requestedCalculations: result.requestedCalculations || [],
            entitiesDescription: result.entitiesDescription || {},
            nodesCount: result.trace ? Object.keys(result.trace).length : 0,
        };

        return res.status(200).json({
            period,
            ...traceQualification(answers, { period, engineVersion: process.env.OPENFISCA_FRANCE_VERSION || null }),   // R15: a technical trace, never an estimate
            traceSummary,
            fullTrace: result.trace || null,
            meta: { requestId, source: 'openfisca-trace' },
        });
    } catch (err) {
        const code = classifyError(err);
        logger.error('[Diagnostic/Trace] ERROR', { requestId, code });
        captureSafe(Sentry, code, { requestId, phase: 'diagnostic-trace' });

        if (code === ERROR_CODES.INVALID_JSON) {
            return res.status(400).json({ error: 'invalid_json', requestId });
        }

        if (code === ERROR_CODES.TRACE_DISABLED) {
            return res.status(503).json({
                error: 'TRACE_DISABLED',
                message: 'Le mode trace est désactivé dans cet environnement.',
                requestId,
            });
        }

        // @ts-ignore
        if (err && err.fallback === true) {
            return res.status(503).json({
                error: SAFE_MESSAGES.ENGINE_FALLBACK,
                fallback: true,
                requestId,
            });
        }

        return res.status(503).json({
            error: 'OPENFISCA_UNAVAILABLE',
            message: 'Le service de calcul est temporairement indisponible.',
            requestId,
        });
    }
}
