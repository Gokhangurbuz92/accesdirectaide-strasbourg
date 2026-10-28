// @ts-nocheck
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';

/**
 * Agent Orchestrator
 *
 * Pipeline : Discovery → Enrichissement → Validation
 *
 * Phase 7 migration: Classification and FALC steps now route through
 * the canonical Phase 7 bridge adapters instead of direct legacy agents.
 * Alerter remains unchanged (no AI calls).
 *
 * The external contract (constructor options, run() output shape,
 * step names, summary fields) is fully preserved.
 */

export class AgentOrchestrator {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.categories = options.categories || [
            'EMPLOI', 'LOGEMENT', 'SANTE', 'FAMILLE',
            'HANDICAP', 'ETUDES', 'MOBILITE', 'ENERGIE',
            'ALIMENTATION', 'NUMERIQUE', 'JUSTICE', 'SENIORS',
        ];
        this.results = {
            started: new Date().toISOString(),
            steps: [],
            errors: [],
            summary: {},
        };
    }

    async run() {
        logger.info({
            msg: 'orchestrator.start',
            categories: this.categories.length,
            dryRun: this.dryRun,
        });

        // Step 1 — Discovery
        const discovered = await this.step('discovery', () => this.runDiscovery());

        // Step 2 — Enrichment
        const enriched = await this.step('enrichment', () => this.runEnrichment(discovered));

        // Step 3 — Validation
        const validated = await this.step('validation', () => this.runValidation(enriched));

        // Step 4 — Classification (via Phase 7 ClassifierBridge)
        const classified = await this.step('classification', () => this.runClassification(discovered));

        // Step 5 — FALC (via Phase 7 FalcBridge)
        const falcified = await this.step('falc', () => this.runFalc(discovered));

        // Step 6 — Alerting (unchanged — deterministic, no AI)
        const alerted = await this.step('alerting', () => this.runAlerting(discovered));

        this.results.finished = new Date().toISOString();
        this.results.summary = {
            discovered: discovered?.length || 0,
            enriched: enriched?.length || 0,
            validated: validated?.length || 0,
            classified: classified?.length || 0,
            falcified: falcified?.length || 0,
            alerted: alerted?.length || 0,
            errors: this.results.errors.length,
        };

        logger.info({ msg: 'orchestrator.complete', summary: this.results.summary });
        return this.results;
    }

    // @ts-ignore
    async step(name, fn) {
        const start = Date.now();
        try {
            const result = await fn();
            this.results.steps.push({
                name,
                status: 'ok',
                durationMs: Date.now() - start,
                count: Array.isArray(result) ? result.length : 1,
            });
            return result;
        } catch (error) {
            this.results.steps.push({
                name,
                status: 'error',
                durationMs: Date.now() - start,
                // @ts-ignore
                error: error.message,
            });
            // @ts-ignore
            this.results.errors.push({ step: name, error: error.message });
            // @ts-ignore
            logger.error({ msg: `orchestrator.${name}.error`, error: error.message });
            return [];
        }
    }

    async runDiscovery() {
        // Find aids not verified in the last 30 days
        const unverified = await db.select({
            id: schema.Aide.id,
            titre: schema.Aide.titre,
            description: schema.Aide.description,
        })
            .from(schema.Aide)
            .where(sql`"verifiedAt" IS NULL OR "verifiedAt" < NOW() - INTERVAL '30 days'`)
            .limit(20);

        logger.info({ msg: 'orchestrator.discovery', found: unverified.length });
        return unverified;
    }

    /**
* @param {any[]} items
*/
    async runEnrichment(items) {
        if (!items || items.length === 0) return [];

        // Identify aids that need FALC description
        // @ts-ignore
        const needsFalc = items.filter(item =>
            !item.description_falc || item.description_falc.length < 10
        );

        logger.info({ msg: 'orchestrator.enrichment', needsFalc: needsFalc.length });
        if (this.dryRun) return needsFalc;
        return needsFalc;
    }

    /**
* @param {string | any[]} items
*/
    async runValidation(items) {
        if (!items || items.length === 0) return [];

        const created = [];
        for (const item of items) {
            if (this.dryRun) {
                created.push({ id: item.id, status: 'dry-run' });
                continue;
            }

            try {
                await db.insert(schema.ReviewQueueItem).values({
                    entityType: 'AIDE',
                    entityId: String(item.id),
                    title: String(item.titre || 'Sans titre').slice(0, 255),
                    reason: 'AI_ENRICHMENT_PENDING',
                    severity: 'LOW',
                    status: 'OPEN',
                    details: { source: 'orchestrator' },
                }).onConflictDoNothing();

                created.push({ id: item.id, status: 'queued' });
            } catch {
                // Ignore duplicates silently
            }
        }

        logger.info({ msg: 'orchestrator.validation', queued: created.length });
        return created;
    }

    /**
* @param {any[]} items
*/
    async runClassification(items) {
        if (!items?.length) return [];
        // @ts-ignore
        if (this.dryRun) return items.map(i => ({ id: i.id, status: 'dry-run' }));

        // Phase 7 migration: use ClassifierBridge (deterministic, no Gemini)
        const { Classifier } = await import('./agents/classifier-bridge.js');
        const classifier = new Classifier();

        const results = [];
        for (const item of items) {
            try {
                const result = await classifier.classify(item);
                results.push(result);
            } catch (e) {
                // @ts-ignore
                logger.error({ msg: 'orchestrator.classification.item_error', id: item.id, error: e.message });
                // @ts-ignore
                results.push({ id: item.id, ok: false, error: e.message });
            }
        }
        logger.info({ msg: 'orchestrator.classification', count: results.length });
        return results;
    }

    /**
* @param {any[]} items
*/
    async runFalc(items) {
        if (!items?.length) return [];
        // @ts-ignore
        if (this.dryRun) return items.map(i => ({ id: i.id, status: 'dry-run' }));

        // Phase 7 migration: use FalcBridge (via BaseSpecialist → AI Foundation)
        const { FalcWriter } = await import('./agents/falc-bridge.js');
        const writer = new FalcWriter();

        const results = [];
        for (const item of items) {
            if (item.description_falc && item.description_falc.length > 10) continue;
            try {
                const result = await writer.simplify(item);
                results.push(result);
            } catch (e) {
                // @ts-ignore
                logger.error({ msg: 'orchestrator.falc.item_error', id: item.id, error: e.message });
                // @ts-ignore
                results.push({ id: item.id, ok: false, error: e.message });
            }
        }
        logger.info({ msg: 'orchestrator.falc', count: results.length });
        return results;
    }

    // @ts-ignore
    async runAlerting(items) {
        if (!items?.length) return [];
        if (this.dryRun) return [];

        const { Alerter } = await import('./agents/alerter.js');
        const alerter = new Alerter();

        try {
            const result = await alerter.notify(items);
            logger.info({ msg: 'orchestrator.alerting', notified: result.notified });
            return [result];
        } catch (e) {
            // @ts-ignore
            logger.error({ msg: 'orchestrator.alerting.error', error: e.message });
            // @ts-ignore
            return [{ ok: false, error: e.message }];
        }
    }
}

/**
 * @param {{} | undefined} options
 */
export async function runOrchestrator(options) {
    const orchestrator = new AgentOrchestrator(options);
    return orchestrator.run();
}
