// @ts-nocheck
/**
 * P27 (R31) — « Dossiers de financement »: the publisher's workspace to prepare AccesDirectAide's subsidy and funding applications (administrators only).
 *
 * Product decision (owner delegation R31; no earlier definition exists: the inventory row only named a page, and no SubventionDossier page remains in the
 * repository): an operator-facing workspace, not a public page. A dossier holds the sections a funder asks for (Cerfa n° 12156*06 « Association : demande de
 * subvention » is the common model; each funder's own list prevails), a budget, a financing plan, milestones and a supporting-document checklist.
 *
 * Honesty rules, enforced here (not only in the screen):
 *   - nothing is assumed: a confirmed budget line needs its supporting document, an awarded financing line or an awarded / refused dossier needs the funder's
 *     decision reference and date; a measured line names its measurement;
 *   - the prefill uses only validated project facts (brand-config legal wording, the measured costs of docs/operating-model-and-costs.md, live counts of
 *     verified public content) and says when it was read; the association's identifiers stay missing until it is registered;
 *   - warnings are computed on every read (missing sections, unbalanced or provisional budget, missing documents, deadline);
 *   - every save keeps the previous content (FundingDossierVersion); exports say « document de travail » and mark provisional amounts.
 */
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { FundingDossier, FundingDossierVersion } from '../../src/db/schema.js';
import brand from '../../src/lib/brand-config.js';
import { visibleSql } from '../lib/publicVisibility.js';

export const STATUSES = { EN_PREPARATION: 'En préparation', PRET_POUR_VALIDATION: 'Prêt pour la validation du porteur', DEPOSE: 'Déposé', ACCORDE: 'Accordé', REFUSE: 'Refusé', ABANDONNE: 'Abandonné' };
export const SECTIONS = [
  ['presentation', 'Présentation du projet', true], ['objectifs', 'Objectifs', true], ['publics', 'Publics visés', true], ['activites', 'Activités et services', true],
  ['territoire', 'Territoire', true], ['besoins', 'Besoins de financement', true], ['moyens', 'Moyens humains et matériels', false], ['evaluation', 'Évaluation et indicateurs', false],
];
export const BUDGET_STATUSES = { MESURE: 'Mesuré', PROVISOIRE: 'Provisoire', CONFIRME: 'Confirmé par un justificatif' };
export const FINANCING_STATUSES = { ENVISAGE: 'Envisagé', DEMANDE: 'Demandé', ACCORDE: 'Accordé', REFUSE: 'Refusé' };
export const PIECE_STATUSES = { MANQUANTE: 'Manquante', DISPONIBLE: 'Disponible', NON_APPLICABLE: 'Sans objet' };
/** the usual supporting documents of an association's request (Cerfa 12156*06); each funder's own list prevails — the checklist is editable */
export const DEFAULT_PIECES = [
  ['STATUTS', 'Statuts de l’association, signés et à jour'],
  ['INSCRIPTION', 'Extrait d’inscription au registre des associations du tribunal judiciaire (association de droit local d’Alsace-Moselle)'],
  ['SIRET', 'Numéro SIRET de l’association'],
  ['DIRIGEANTS', 'Liste des personnes chargées de l’administration (bureau, conseil)'],
  ['RIB', 'Relevé d’identité bancaire au nom de l’association'],
  ['BUDGET_ASSO', 'Budget prévisionnel de l’association'],
  ['BUDGET_PROJET', 'Budget prévisionnel du projet'],
  ['COMPTES', 'Derniers comptes approuvés'],
  ['RAPPORT', 'Dernier rapport d’activité'],
  ['AG', 'Procès-verbal de la dernière assemblée générale'],
  ['ATTESTATION', 'Attestation sur l’honneur signée par le représentant légal'],
  ['COMPTE_RENDU', 'Compte rendu financier (Cerfa 15059) d’une subvention déjà reçue, s’il y en a une'],
];
const MAX_TEXT = 6000;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const txt = (s, max = MAX_TEXT) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const short = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const rid = () => crypto.randomUUID().slice(0, 8);
const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : NaN;
};
const isoDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'invalid'; };
const httpUrl = (v) => { const s = short(v, 500); if (!s) return null; try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : 'invalid'; } catch { return 'invalid'; } };

/** Validate and normalize the editable content. Returns { content } or a refusal naming the first problem in French. */
export function normalizeContent(input = {}) {
  const c = { sections: {}, budget: [], financement: [], jalons: [], pieces: [] };
  for (const [key] of SECTIONS) c.sections[key] = txt(input.sections?.[key]);
  for (const l of (Array.isArray(input.budget) ? input.budget : []).slice(0, 80)) {
    const montant = money(l.montant);
    if (Number.isNaN(montant)) return bad('INVALID_AMOUNT', `Montant invalide pour « ${short(l.poste, 60) || 'une ligne du budget'} ».`);
    const statut = BUDGET_STATUSES[l.statut] ? l.statut : 'PROVISOIRE';
    const justification = short(l.justification, 300);
    if (statut !== 'PROVISOIRE' && !justification) return bad('JUSTIFICATION_REQUIRED', `« ${short(l.poste, 60) || 'Ligne'} » : un montant mesuré ou confirmé doit dire d’où il vient (relevé, devis, facture).`);
    c.budget.push({ id: short(l.id, 12) || rid(), poste: short(l.poste, 160), nature: l.nature === 'PRODUIT' ? 'PRODUIT' : 'CHARGE', montant, statut, justification });
  }
  for (const f of (Array.isArray(input.financement) ? input.financement : []).slice(0, 40)) {
    const montant = money(f.montant);
    if (Number.isNaN(montant)) return bad('INVALID_AMOUNT', `Montant invalide pour « ${short(f.financeur, 60) || 'un financeur'} ».`);
    const statut = FINANCING_STATUSES[f.statut] ? f.statut : 'ENVISAGE';
    const reference = short(f.reference, 200);
    if ((statut === 'ACCORDE' || statut === 'REFUSE') && !reference) return bad('DECISION_REQUIRED', `« ${short(f.financeur, 60) || 'Financeur'} » : un financement accordé ou refusé doit citer la décision du financeur (référence, date).`);
    c.financement.push({ id: short(f.id, 12) || rid(), financeur: short(f.financeur, 160), montant, statut, reference });
  }
  for (const j of (Array.isArray(input.jalons) ? input.jalons : []).slice(0, 40)) {
    const date = isoDate(j.date);
    if (date === 'invalid') return bad('INVALID_DATE', `Date invalide pour le jalon « ${short(j.libelle, 60)} ».`);
    c.jalons.push({ id: short(j.id, 12) || rid(), libelle: short(j.libelle, 200), date, statut: j.statut === 'FAIT' ? 'FAIT' : 'PREVU' });
  }
  for (const p of (Array.isArray(input.pieces) ? input.pieces : []).slice(0, 40)) {
    c.pieces.push({ code: short(p.code, 40) || rid(), libelle: short(p.libelle, 240), statut: PIECE_STATUSES[p.statut] ? p.statut : 'MANQUANTE', reference: short(p.reference, 200) });
  }
  return { ok: true, content: c };
}

const sum = (lines) => Math.round(lines.reduce((s, l) => s + (l.montant || 0), 0) * 100) / 100;
/** What is missing or not yet true, recomputed on every read. `blocking` warnings keep a dossier out of « prêt pour validation ». */
export function warningsOf(d, now = new Date()) {
  const c = d.content || {};
  const w = [];
  for (const [key, label, required] of SECTIONS) if (required && !String(c.sections?.[key] || '').trim()) w.push({ code: 'SECTION_EMPTY', blocking: true, message: `Section « ${label} » à rédiger.` });
  const charges = (c.budget || []).filter((l) => l.nature === 'CHARGE'); const produits = (c.budget || []).filter((l) => l.nature === 'PRODUIT');
  if (!charges.length) w.push({ code: 'BUDGET_EMPTY', blocking: true, message: 'Le budget ne compte aucune charge.' });
  const noAmount = (c.budget || []).filter((l) => l.montant === null);
  if (noAmount.length) w.push({ code: 'AMOUNT_MISSING', blocking: true, message: `${noAmount.length} ligne(s) du budget sans montant.` });
  if (charges.length && Math.abs(sum(charges) - sum(produits)) > 0.009) w.push({ code: 'BUDGET_UNBALANCED', blocking: true, message: `Budget non équilibré : charges ${sum(charges).toFixed(2)} €, produits ${sum(produits).toFixed(2)} €.` });
  const provisional = (c.budget || []).filter((l) => l.statut === 'PROVISOIRE');
  if (provisional.length) w.push({ code: 'BUDGET_PROVISIONAL', blocking: false, message: `${provisional.length} montant(s) provisoire(s) : à confirmer par un devis ou une facture avant dépôt.` });
  const missing = (c.pieces || []).filter((p) => p.statut === 'MANQUANTE');
  if (missing.length) w.push({ code: 'PIECES_MISSING', blocking: false, message: `${missing.length} pièce(s) manquante(s) : ${missing.slice(0, 4).map((p) => p.libelle).join(' ; ')}${missing.length > 4 ? '…' : ''}` });
  if (!brand.legal?.registration) w.push({ code: 'NOT_REGISTERED', blocking: false, message: 'L’association n’est pas encore inscrite au registre des associations : pas de numéro d’inscription, de SIRET ni de représentant légal. La plupart des financeurs les exigent.' });
  if (!d.funderName) w.push({ code: 'NO_FUNDER', blocking: false, message: 'Financeur non indiqué.' });
  if (d.deadline) {
    const days = Math.ceil((new Date(d.deadline).getTime() - now.getTime()) / 86400000);
    if (days < 0 && ['EN_PREPARATION', 'PRET_POUR_VALIDATION'].includes(d.status)) w.push({ code: 'DEADLINE_PASSED', blocking: false, message: `Date limite dépassée de ${-days} jour(s).` });
    else if (days >= 0 && days <= 14 && ['EN_PREPARATION', 'PRET_POUR_VALIDATION'].includes(d.status)) w.push({ code: 'DEADLINE_SOON', blocking: false, message: `Date limite dans ${days} jour(s).` });
  }
  return w;
}

const view = (d) => ({ ...d, statusLabel: STATUSES[d.status], warnings: warningsOf(d), totals: { charges: sum((d.content?.budget || []).filter((l) => l.nature === 'CHARGE')), produits: sum((d.content?.budget || []).filter((l) => l.nature === 'PRODUIT')),
  financementDemande: sum((d.content?.financement || []).filter((f) => f.statut === 'DEMANDE' || f.statut === 'ACCORDE')), financementAccorde: sum((d.content?.financement || []).filter((f) => f.statut === 'ACCORDE')) } });

export async function listDossiers(db = defaultDb) {
  const rows = await db.select().from(FundingDossier).orderBy(desc(FundingDossier.updatedAt)).limit(200);
  return { ok: true, status: 200, dossiers: rows.map((d) => { const v = view(d); return { id: d.id, title: d.title, funderName: d.funderName, deadline: d.deadline, status: d.status, statusLabel: v.statusLabel, version: d.version, updatedAt: d.updatedAt, blocking: v.warnings.filter((w) => w.blocking).length, warnings: v.warnings.length }; }),
    vocab: { statuses: STATUSES, sections: SECTIONS.map(([key, label, required]) => ({ key, label, required })), budgetStatuses: BUDGET_STATUSES, financingStatuses: FINANCING_STATUSES, pieceStatuses: PIECE_STATUSES } };
}

export async function getDossier(id, db = defaultDb) {
  const [d] = await db.select().from(FundingDossier).where(eq(FundingDossier.id, String(id || ''))).limit(1);
  if (!d) return bad('not_found', 'Dossier introuvable.', 404);
  const versions = await db.select({ version: FundingDossierVersion.version, status: FundingDossierVersion.status, savedBy: FundingDossierVersion.savedBy, savedAt: FundingDossierVersion.savedAt, note: FundingDossierVersion.note })
    .from(FundingDossierVersion).where(eq(FundingDossierVersion.dossierId, d.id)).orderBy(desc(FundingDossierVersion.version)).limit(100);
  return { ok: true, status: 200, dossier: view(d), versions };
}

/** Facts the project has validated, read now (never a guess): the legal wording, the measured costs, the live counts of verified public content. */
export async function projectFacts(db = defaultDb, now = new Date()) {
  const counts = {};
  for (const [kind, table] of [['aide', 'Aide'], ['demarche', 'Demarche'], ['structure', 'Structure']]) {
    counts[kind] = (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${table}"`)} WHERE ${visibleSql(kind)}`)).rows[0].n;
  }
  return { readAt: now.toISOString(), projectStatement: brand.legal?.projectStatement || '', legalStatus: brand.legal?.legalStatus || '', office: brand.legal?.intendedRegisteredOffice || '', counts };
}

/** A new dossier, prefilled with validated facts only; everything else is left to write (and flagged by the warnings). */
export async function createDossier(input, by, db = defaultDb) {
  const title = short(input?.title, 160);
  if (title.length < 3) return bad('INVALID_TITLE', 'Donnez un titre au dossier (3 caractères au moins).');
  const deadline = isoDate(input?.deadline); const programmeUrl = httpUrl(input?.programmeUrl);
  if (deadline === 'invalid') return bad('INVALID_DATE', 'Date limite invalide.');
  if (programmeUrl === 'invalid') return bad('INVALID_URL', 'Adresse du programme invalide (http ou https).');
  const f = await projectFacts(db);
  const day = new Date(f.readAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const content = {
    sections: {
      presentation: `${f.projectStatement}\nAccesDirectAide est un site d’information sociale pour Strasbourg et l’Eurométropole : il aide chacun à trouver les aides, les démarches et les lieux d’accueil, à partir des sources officielles, sans remplacer les organismes (CAF, Assurance maladie, France Travail…).\nÉtat mesuré le ${day} : ${f.counts.aide} aides, ${f.counts.demarche} démarches et ${f.counts.structure} lieux d’accueil vérifiés et publiés.`,
      objectifs: '', publics: '', activites: '', territoire: 'Strasbourg et l’Eurométropole de Strasbourg (Bas-Rhin).', besoins: '', moyens: '', evaluation: '',
    },
    budget: [
      { id: rid(), poste: 'Hébergement du site (Vercel, offre Pro)', nature: 'CHARGE', montant: null, statut: 'MESURE', justification: '20 $ US par mois facturés, relevé du 31/10/2026 (docs/operating-model-and-costs.md) ; montant en euros à reporter depuis la facture' },
      { id: rid(), poste: 'Base de données (Neon) et limitation de débit (Upstash)', nature: 'CHARGE', montant: 0, statut: 'MESURE', justification: 'offres gratuites utilisées au 31/10/2026 (docs/operating-model-and-costs.md)' },
    ],
    financement: [],
    jalons: [],
    pieces: DEFAULT_PIECES.map(([code, libelle]) => ({ code, libelle, statut: 'MANQUANTE', reference: '' })),
  };
  const [d] = await db.insert(FundingDossier).values({ title, funderName: short(input?.funderName, 160) || null, programmeName: short(input?.programmeName, 200) || null, programmeUrl,
    deadline: deadline ? new Date(`${deadline}T23:59:59Z`) : null, content, createdBy: by, updatedBy: by }).returning();
  await db.insert(FundingDossierVersion).values({ dossierId: d.id, version: 1, status: d.status, content, savedBy: by, note: `Création, préremplie avec les informations validées lues le ${day}` });
  return { ok: true, status: 201, dossier: view(d) };
}

/** Save the content (compare-and-set on the version: two administrators cannot overwrite each other) and keep the new version. */
export async function saveDossier(id, input, by, db = defaultDb) {
  const [d] = await db.select().from(FundingDossier).where(eq(FundingDossier.id, String(id || ''))).limit(1);
  if (!d) return bad('not_found', 'Dossier introuvable.', 404);
  if (Number(input?.version) !== d.version) return bad('CONFLICT', 'Le dossier a été modifié entre-temps : rechargez-le avant d’enregistrer.', 409);
  if (['ACCORDE', 'REFUSE', 'ABANDONNE'].includes(d.status)) return bad('CLOSED', 'Ce dossier est clos : son contenu n’est plus modifiable.', 409);
  const n = normalizeContent(input?.content || {});
  if (n.ok === false) return n;
  const deadline = input?.deadline !== undefined ? isoDate(input.deadline) : undefined;
  const programmeUrl = input?.programmeUrl !== undefined ? httpUrl(input.programmeUrl) : undefined;
  if (deadline === 'invalid') return bad('INVALID_DATE', 'Date limite invalide.');
  if (programmeUrl === 'invalid') return bad('INVALID_URL', 'Adresse du programme invalide (http ou https).');
  const patch = { content: n.content, version: d.version + 1, updatedBy: by,
    ...(input?.title !== undefined ? { title: short(input.title, 160) || d.title } : {}), ...(input?.funderName !== undefined ? { funderName: short(input.funderName, 160) || null } : {}),
    ...(input?.programmeName !== undefined ? { programmeName: short(input.programmeName, 200) || null } : {}), ...(programmeUrl !== undefined ? { programmeUrl } : {}),
    ...(deadline !== undefined ? { deadline: deadline ? new Date(`${deadline}T23:59:59Z`) : null } : {}) };
  // back to « en préparation » if a dossier said ready and no longer is
  const next = view({ ...d, ...patch });
  if (d.status === 'PRET_POUR_VALIDATION' && next.warnings.some((w) => w.blocking)) patch.status = 'EN_PREPARATION';
  const rows = await db.update(FundingDossier).set(patch).where(sql`${FundingDossier.id} = ${d.id} AND ${FundingDossier.version} = ${d.version}`).returning();
  if (!rows.length) return bad('CONFLICT', 'Le dossier a été modifié entre-temps : rechargez-le avant d’enregistrer.', 409);
  await db.insert(FundingDossierVersion).values({ dossierId: d.id, version: rows[0].version, status: rows[0].status, content: n.content, savedBy: by, note: short(input?.note, 200) || null });
  return { ok: true, status: 200, dossier: view(rows[0]) };
}

/** Status changes and what each one requires. An award or a refusal is recorded only from the funder's decision. */
export async function setStatus(id, input, by, db = defaultDb) {
  const [d] = await db.select().from(FundingDossier).where(eq(FundingDossier.id, String(id || ''))).limit(1);
  if (!d) return bad('not_found', 'Dossier introuvable.', 404);
  const to = String(input?.status || '');
  if (!STATUSES[to]) return bad('INVALID_STATUS', 'Statut inconnu.');
  const allowed = { EN_PREPARATION: ['PRET_POUR_VALIDATION', 'ABANDONNE'], PRET_POUR_VALIDATION: ['EN_PREPARATION', 'DEPOSE', 'ABANDONNE'], DEPOSE: ['ACCORDE', 'REFUSE', 'ABANDONNE'], ACCORDE: [], REFUSE: [], ABANDONNE: ['EN_PREPARATION'] };
  if (!allowed[d.status].includes(to)) return bad('INVALID_TRANSITION', `Passage impossible de « ${STATUSES[d.status]} » à « ${STATUSES[to]} ».`, 409);
  const patch = { status: to, version: d.version + 1, updatedBy: by };
  if (to === 'PRET_POUR_VALIDATION') {
    const blocking = warningsOf(d).filter((w) => w.blocking);
    if (blocking.length) return bad('NOT_READY', `Le dossier n’est pas prêt : ${blocking.map((w) => w.message).join(' ')}`, 409);
  }
  if (to === 'DEPOSE') {
    const at = isoDate(input?.date);
    if (!at || at === 'invalid') return bad('DATE_REQUIRED', 'Indiquez la date du dépôt auprès du financeur.');
    patch.submittedAt = new Date(`${at}T12:00:00Z`);
  }
  if (to === 'ACCORDE' || to === 'REFUSE') {
    const at = isoDate(input?.date); const ref = short(input?.reference, 200);
    if (!at || at === 'invalid' || !ref) return bad('DECISION_REQUIRED', 'Une décision se note à partir du courrier ou de l’arrêté du financeur : indiquez sa référence et sa date.');
    patch.decisionRef = ref; patch.decisionAt = new Date(`${at}T12:00:00Z`);
  }
  const rows = await db.update(FundingDossier).set(patch).where(sql`${FundingDossier.id} = ${d.id} AND ${FundingDossier.version} = ${d.version}`).returning();
  if (!rows.length) return bad('CONFLICT', 'Le dossier a été modifié entre-temps : rechargez-le.', 409);
  await db.insert(FundingDossierVersion).values({ dossierId: d.id, version: rows[0].version, status: to, content: d.content, savedBy: by, note: `Statut : ${STATUSES[to]}${patch.decisionRef ? ` (décision ${patch.decisionRef})` : ''}` });
  return { ok: true, status: 200, dossier: view(rows[0]) };
}

/** A working document in Markdown (any funder's form is filled from it): sections, budget with totals and provisional marks, financing, milestones, documents. */
export function exportMarkdown(d) {
  const v = view(d); const c = d.content || {};
  const eur = (n) => (n === null || n === undefined ? 'à renseigner' : `${Number(n).toFixed(2).replace('.', ',')} €`);
  const day = (x) => (x ? new Date(x).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');
  const L = [`# ${d.title}`, '', `Document de travail — version ${d.version}, statut « ${v.statusLabel} », exporté le ${day(new Date())}. Ce document n’est pas une demande déposée.`, ''];
  L.push(`- Financeur : ${d.funderName || 'à préciser'}`, `- Programme : ${d.programmeName || 'à préciser'}${d.programmeUrl ? ` (${d.programmeUrl})` : ''}`, `- Date limite : ${day(d.deadline)}`, '');
  if (v.warnings.length) { L.push('## Points à compléter', ''); for (const w of v.warnings) L.push(`- ${w.message}`); L.push(''); }
  for (const [key, label] of SECTIONS) { L.push(`## ${label}`, '', String(c.sections?.[key] || '').trim() || '_À rédiger._', ''); }
  L.push('## Budget prévisionnel', '', '| Poste | Nature | Montant | Statut | Justification |', '|---|---|---|---|---|');
  for (const l of c.budget || []) L.push(`| ${l.poste} | ${l.nature === 'CHARGE' ? 'Charge' : 'Produit'} | ${eur(l.montant)} | ${BUDGET_STATUSES[l.statut]} | ${l.justification || ''} |`);
  L.push('', `Total des charges : ${eur(v.totals.charges)} — total des produits : ${eur(v.totals.produits)}.`, '', '## Plan de financement', '');
  if ((c.financement || []).length) { L.push('| Financeur | Montant | Statut | Décision |', '|---|---|---|---|'); for (const f of c.financement) L.push(`| ${f.financeur} | ${eur(f.montant)} | ${FINANCING_STATUSES[f.statut]} | ${f.reference || ''} |`); }
  else L.push('_Aucun financement indiqué._');
  L.push('', '## Calendrier', ''); if ((c.jalons || []).length) for (const j of c.jalons) L.push(`- ${day(j.date)} — ${j.libelle} (${j.statut === 'FAIT' ? 'fait' : 'prévu'})`); else L.push('_Aucun jalon._');
  L.push('', '## Pièces justificatives', ''); for (const p of c.pieces || []) L.push(`- [${p.statut === 'DISPONIBLE' ? 'x' : ' '}] ${p.libelle} — ${PIECE_STATUSES[p.statut]}${p.reference ? ` (${p.reference})` : ''}`);
  return `${L.join('\n')}\n`;
}

export async function exportDossier(id, db = defaultDb) {
  const [d] = await db.select().from(FundingDossier).where(eq(FundingDossier.id, String(id || ''))).limit(1);
  if (!d) return bad('not_found', 'Dossier introuvable.', 404);
  return { ok: true, status: 200, markdown: exportMarkdown(d), filename: `dossier-financement-${d.id.slice(0, 8)}-v${d.version}.md` };
}
