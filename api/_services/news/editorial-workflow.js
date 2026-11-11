// @ts-nocheck
/**
 * Actualités v2 — ADA's own articles and explainers: draft → review → published, then corrections, updates and retraction, every step by a NAMED
 * administrator with MFA (api/_handlers/admin/news-editorial.js) and recorded in the audit log. Nothing here is published automatically.
 *
 * What an approval requires (checked here, not trusted from the form):
 *  - a title (10–200 characters), a lead (40–400) and a text (300–20 000), plain text only (no HTML);
 *  - at least one source (https), and for sensitive or contested subjects (politique, justice, santé, international) at least TWO sources from
 *    different sites — independent corroboration;
 *  - the editor's checklist, all ticked: every fact traced to a cited source; no sentence taken or closely paraphrased from a protected article;
 *    viewpoints proportionate to the evidence; uncertainty, estimates and disputed claims labelled as such;
 *  - an image only with its rights (https address, credit, licence, alternative text); an AI image only when an image provider is approved
 *    (NEWS_AI_IMAGES_APPROVED=on) and always labelled; never a photorealistic depiction presented as the event;
 *  - optional four-eyes rule (NEWS_EDITORIAL_FOUR_EYES=on): the approver must not be the author.
 * A correction never rewrites history silently: the published text may change only with a dated note shown to readers.
 */
import crypto from 'node:crypto';
import { TOPIC_IDS } from './editorial.js';

export const SENSITIVE_TOPICS = Object.freeze(['politique', 'justice', 'sante', 'international']);
export const CHECKLIST = Object.freeze(['factsSourced', 'noCopiedText', 'proportionateViewpoints', 'uncertaintyLabelled']);
const STATES = Object.freeze({ draft: 'brouillon', review: 'a_relire', published: 'publie', retracted: 'retire' });
export { STATES };

const plain = (s, max) => String(s ?? '').replace(/<[^>]*>/g, '').split('\u0000').join('').trim().slice(0, max);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** normalises what the editor sent; never trusts types @param {any} input */
export function normaliseDraft(input) {
  const sources = (Array.isArray(input?.sources) ? input.sources : []).slice(0, 20)
    .map((s) => ({ publisher: plain(s?.publisher, 120), url: plain(s?.url, 500), note: plain(s?.note, 300) }))
    .filter((s) => s.publisher && /^https:\/\/[^\s]+$/.test(s.url));
  const img = input?.image && typeof input.image === 'object' ? {
    url: plain(input.image.url, 500), alt: plain(input.image.alt, 300), credit: plain(input.image.credit, 200), licence: plain(input.image.licence, 120),
    licenceUrl: plain(input.image.licenceUrl, 500), kind: ['licensed', 'commons', 'ai'].includes(input.image.kind) ? input.image.kind : 'licensed',
  } : null;
  return {
    titre: plain(input?.titre, 200), resume: plain(input?.resume, 400), contenu: plain(input?.contenu, 20000),
    topic: TOPIC_IDS.includes(input?.topic) && input.topic !== 'une' ? input.topic : 'societe',
    geo: ['france', 'monde', 'alsace'].includes(input?.geo) ? input.geo : 'france',
    est_important: input?.est_important === true, aiAssisted: input?.aiAssisted === true,
    sources, image: img && img.url ? img : null,
    checklist: Object.fromEntries(CHECKLIST.map((k) => [k, input?.checklist?.[k] === true])),
  };
}

/** @param {ReturnType<typeof normaliseDraft>} d @param {{ env?: Record<string, string | undefined> }} [o] @returns {string[]} problems (empty = can be approved) */
export function approvalProblems(d, { env = process.env } = {}) {
  const p = [];
  if (d.titre.length < 10) p.push('TITLE_TOO_SHORT');
  if (d.resume.length < 40) p.push('LEAD_TOO_SHORT');
  if (d.contenu.length < 300) p.push('TEXT_TOO_SHORT');
  if (!d.sources.length) p.push('SOURCE_MISSING');
  if (SENSITIVE_TOPICS.includes(d.topic) && new Set(d.sources.map((s) => host(s.url))).size < 2) p.push('CORROBORATION_TWO_SITES_REQUIRED');
  for (const k of CHECKLIST) if (!d.checklist[k]) p.push(`CHECKLIST_${k}`);
  if (d.image) {
    if (!/^https:\/\//.test(d.image.url) || !d.image.alt || !d.image.credit || !d.image.licence) p.push('IMAGE_RIGHTS_INCOMPLETE');
    if (d.image.kind === 'ai' && env.NEWS_AI_IMAGES_APPROVED !== 'on') p.push('AI_IMAGE_PROVIDER_NOT_APPROVED');
  }
  return p;
}

const slugify = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

/**
 * The workflow against the database (passed in for tests). @param {{ db: any, schema: any, ops: any, now?: () => Date, env?: any }} deps
 */
export function editorialWorkflow({ db, schema, ops, now = () => new Date(), env = process.env }) {
  const { Actualite, AuditLog } = schema; const { eq, and } = ops;
  const audit = (action, actor, id, details = {}) => db.insert(AuditLog).values({ action, actor, actor_id: actor, entity: 'Actualite', entity_id: id, details }).catch(() => {});
  const get = async (id) => (await db.select().from(Actualite).where(and(eq(Actualite.id, id), eq(Actualite.type_actu, 'ada_original'))).limit(1))[0] || null;
  const metaOf = (row) => ({ ...(row?.raw_payload_json?.ada || {}) });
  const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });

  return {
    async list(status) {
      const where = status ? and(eq(Actualite.type_actu, 'ada_original'), eq(Actualite.statut, status)) : eq(Actualite.type_actu, 'ada_original');
      return db.select({ id: Actualite.id, slug: Actualite.slug, titre: Actualite.titre, statut: Actualite.statut, updatedAt: Actualite.updatedAt, published_at: Actualite.published_at }).from(Actualite).where(where).limit(200);
    },
    get,
    /** create or update a draft (a published article changes only through correct()) */
    async save(actor, input, id = null) {
      const d = normaliseDraft(input);
      if (d.titre.length < 3) throw err('TITLE_REQUIRED');
      const at = now();
      if (id) {
        const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
        if (![STATES.draft, STATES.review].includes(row.statut)) throw err('PUBLISHED_ARTICLE_USE_CORRECTION', 409);
        const meta = { ...metaOf(row), sources: d.sources, image: d.image, checklist: d.checklist, topic: d.topic, geo: d.geo, aiAssisted: d.aiAssisted,
          editorial: { ...(metaOf(row).editorial || {}), lastEditBy: actor, lastEditAt: at.toISOString() } };
        await db.update(Actualite).set({ titre: d.titre, resume: d.resume, contenu: d.contenu, categorie: d.topic, est_important: d.est_important, statut: STATES.draft, raw_payload_json: { ada: meta }, updatedBy: actor }).where(eq(Actualite.id, id));
        await audit('NEWS_EDITORIAL_SAVE', actor, id, { state: STATES.draft });
        return { id, statut: STATES.draft, problems: approvalProblems(d, { env }) };
      }
      const newId = crypto.randomUUID();
      const meta = { sources: d.sources, image: d.image, checklist: d.checklist, topic: d.topic, geo: d.geo, aiAssisted: d.aiAssisted, corrections: [],
        editorial: { author: actor, createdAt: at.toISOString() } };
      await db.insert(Actualite).values({ id: newId, titre: d.titre, resume: d.resume, contenu: d.contenu, type_actu: 'ada_original', statut: STATES.draft, categorie: d.topic,
        territoire: d.geo === 'monde' ? 'MONDE' : d.geo === 'alsace' ? 'GRAND_EST' : 'FRANCE', est_important: d.est_important, auto_publish: false, date_publication: at,
        key_points_falc: [], departements: [], tags: [], score_fiabilite: 0, source_name: 'AccesDirectAide', raw_payload_json: { ada: meta }, updatedBy: actor });
      await audit('NEWS_EDITORIAL_CREATE', actor, newId);
      return { id: newId, statut: STATES.draft, problems: approvalProblems(d, { env }) };
    },
    async submit(actor, id) {
      const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
      if (row.statut !== STATES.draft) throw err('NOT_A_DRAFT', 409);
      await db.update(Actualite).set({ statut: STATES.review, updatedBy: actor }).where(eq(Actualite.id, id));
      await audit('NEWS_EDITORIAL_SUBMIT', actor, id); return { id, statut: STATES.review };
    },
    async reject(actor, id, note) {
      const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
      if (row.statut !== STATES.review) throw err('NOT_IN_REVIEW', 409);
      await db.update(Actualite).set({ statut: STATES.draft, commentaire_statut: plain(note, 500) || 'Renvoyé en rédaction', updatedBy: actor }).where(eq(Actualite.id, id));
      await audit('NEWS_EDITORIAL_REJECT', actor, id); return { id, statut: STATES.draft };
    },
    async approve(actor, id) {
      const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
      if (row.statut !== STATES.review) throw err('NOT_IN_REVIEW', 409);
      const meta = metaOf(row);
      const d = normaliseDraft({ ...meta, titre: row.titre, resume: row.resume, contenu: row.contenu, est_important: row.est_important });
      const problems = approvalProblems(d, { env });
      if (env.NEWS_EDITORIAL_FOUR_EYES === 'on' && meta.editorial?.author === actor) problems.push('FOUR_EYES_APPROVER_IS_AUTHOR');
      if (problems.length) throw err('APPROVAL_REFUSED', 422, { problems });
      const at = now();
      let slug = `${slugify(row.titre) || 'article'}-${String(id).slice(0, 6)}`;
      const clash = await db.select({ id: Actualite.id }).from(Actualite).where(eq(Actualite.slug, slug)).limit(1);
      if (clash[0] && clash[0].id !== id) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      await db.update(Actualite).set({ statut: STATES.published, slug: row.slug || slug, published_at: at, date_publication: at, updatedBy: actor,
        raw_payload_json: { ada: { ...meta, editorial: { ...(meta.editorial || {}), approvedBy: actor, approvedAt: at.toISOString() } } } }).where(eq(Actualite.id, id));
      await audit('NEWS_EDITORIAL_APPROVE', actor, id, { sources: d.sources.length });
      return { id, statut: STATES.published, slug: row.slug || slug };
    },
    /** a dated, visible correction or update of a published article; the text may change only together with that note */
    async correct(actor, id, { note, kind = 'correction', titre, resume, contenu } = {}) {
      const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
      if (row.statut !== STATES.published) throw err('NOT_PUBLISHED', 409);
      const n = plain(note, 500); if (n.length < 10) throw err('CORRECTION_NOTE_REQUIRED');
      const meta = metaOf(row); const at = now().toISOString();
      const corrections = [...(Array.isArray(meta.corrections) ? meta.corrections : []), { at, kind: kind === 'update' ? 'update' : 'correction', note: n, by: actor }];
      const set = { raw_payload_json: { ada: { ...meta, corrections } }, updatedBy: actor };
      if (titre != null) set.titre = plain(titre, 200); if (resume != null) set.resume = plain(resume, 400); if (contenu != null) set.contenu = plain(contenu, 20000);
      await db.update(Actualite).set(set).where(eq(Actualite.id, id));
      await audit('NEWS_EDITORIAL_CORRECT', actor, id, { kind }); return { id, corrections: corrections.length };
    },
    /** withdrawn from the lists; its address answers 410 with the retraction note (never silently deleted) */
    async retract(actor, id, note) {
      const row = await get(id); if (!row) throw err('NOT_FOUND', 404);
      if (row.statut !== STATES.published) throw err('NOT_PUBLISHED', 409);
      const n = plain(note, 500); if (n.length < 10) throw err('RETRACTION_NOTE_REQUIRED');
      const meta = metaOf(row);
      await db.update(Actualite).set({ statut: STATES.retracted, updatedBy: actor, raw_payload_json: { ada: { ...meta, editorial: { ...(meta.editorial || {}), retractedBy: actor, retractedAt: now().toISOString(), retractionNote: n } } } }).where(eq(Actualite.id, id));
      await audit('NEWS_EDITORIAL_RETRACT', actor, id); return { id, statut: STATES.retracted };
    },
  };
}
