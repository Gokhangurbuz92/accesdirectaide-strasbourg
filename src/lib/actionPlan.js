// @ts-nocheck
/**
 * DTA S2A (A5) — account-free "Plan d'action" (PURE: no I/O, no clock, no randomness, no storage, no network).
 * Contract: docs/release/PRODUCT_FLOW_CONTRACT.md A5 + N11/N13/N16, NORMATIVE_RECONCILIATION C2/C3 (V1-minimum continuity = plan d'action + RC5 sharing + link-out to RDV; persistent "Mon Parcours" is a later roadmap item).
 *  - built ONLY from the assessment items that pass `readAssessment` (never creates or changes a state; a forged/authoritative item is dropped upstream);
 *  - steps are "compléter / faire vérifier / préparer / demander conseil / partager (facultatif) / urgence", in a fixed order;
 *  - documents are never invented: the list is empty and the plan says it is to be confirmed with the organization (ADA has no verified list);
 *  - no deadline, no reminder (always null), no persistence, no account;
 *  - no URL, e-mail, phone number or address: links are internal ADA routes (the catalogue information page, the structure directory, the emergency resources) or in-page anchors only.
 */
import { missingFactLabel, readAssessment } from './assessmentLabels.js';

export const PLAN_CONTRACT = 'ADA_ACTION_PLAN_V1';
const uniq = (a) => [...new Set(a)];
const list = (a) => a.join(', ');

export function buildActionPlan(results) {
  const { items, usable, dataStatusBanner } = readAssessment(results);
  const plan = { contract: PLAN_CONTRACT, authoritative: false, persisted: false, dataStatusBanner, steps: [] };
  if (!usable) return plan;
  const push = (s) => plan.steps.push({ deadline: null, reminder: null, links: [], itemCodes: [], ...s, order: plan.steps.length + 1 });

  const missing = items.filter((i) => i.state === 'MISSING_INFORMATION');
  if (missing.length) {
    const facts = uniq(missing.flatMap((i) => (i.missingFacts || []).map(missingFactLabel)));
    push({
      kind: 'complete', itemCodes: missing.map((i) => i.code),
      title: `Compléter les informations manquantes (${list(missing.map((i) => i.label))})`,
      titleFalc: 'Ajoutez les informations qui manquent.',
      detail: `Pour orienter votre demande, il faut préciser : ${list(facts)}. Vous pouvez répondre « je ne sais pas » ; un professionnel pourra vous aider.`,
      detailFalc: 'Vous pouvez dire « je ne sais pas ».',
      links: [{ to: '#diag-birthdate', label: 'Revenir au formulaire' }],
    });
  }

  const checks = items.filter((i) => i.state === 'CHECK_REQUIRED' || i.state === 'POSSIBLE');
  const whoOrder = uniq(checks.map((i) => i.whoToAsk || 'un organisme compétent'));
  for (const who of whoOrder) {
    const group = checks.filter((i) => (i.whoToAsk || 'un organisme compétent') === who);
    push({
      kind: 'verify', who, itemCodes: group.map((i) => i.code),
      title: `Faire vérifier votre situation pour ${list(group.map((i) => i.label))} auprès de ${who}`,
      titleFalc: `Demandez à ${who} de regarder : ${list(group.map((i) => i.label))}.`,
      detail: 'Ce plan n\'est pas une décision : seul l\'organisme compétent peut examiner votre situation.',
      detailFalc: 'Ce plan ne décide rien.',
      links: [
        ...group.map((i) => ({ to: `/aides/${encodeURIComponent(i.code)}`, label: `Fiche d'information : ${i.label}` })),
        { to: '/structures', label: 'Trouver une structure pour faire vérifier (données en cours de vérification)' },
      ],
    });
  }
  if (checks.length) {
    push({
      kind: 'prepare', documents: [], itemCodes: checks.map((i) => i.code),
      title: 'Préparer vos justificatifs',
      titleFalc: 'Préparez vos papiers.',
      detail: 'Rassemblez vos papiers personnels. La liste exacte des documents à fournir est à confirmer auprès de l\'organisme : ADA n\'a pas encore de liste de documents à vous donner.',
      detailFalc: 'Demandez à l\'organisme la liste des papiers.',
    });
  }

  const unsupported = items.filter((i) => i.state === 'UNSUPPORTED');
  if (unsupported.length) {
    push({
      kind: 'accompany', itemCodes: unsupported.map((i) => i.code),
      title: `Demander conseil pour : ${list(unsupported.map((i) => i.label))}`,
      titleFalc: `Demandez conseil à un professionnel pour : ${list(unsupported.map((i) => i.label))}.`,
      detail: `ADA ne sait pas encore évaluer ces aides (${list(unsupported.map((i) => i.label))}). Un professionnel (travailleur social, structure d'accompagnement, France Services) peut vous aider à voir ce qui existe.`,
      detailFalc: 'ADA ne sait pas encore répondre pour ces aides. Un professionnel peut vous aider.',
      links: [{ to: '/structures', label: 'Trouver une structure d\'accompagnement (données en cours de vérification)' }],
    });
  }

  push({
    kind: 'share',
    title: 'Partager votre diagnostic avec une structure (facultatif)',
    titleFalc: 'Vous pouvez partager vos résultats avec une structure.',
    detail: 'C\'est facultatif : le partage se fait avec la structure que vous choisissez, selon les autorisations que vous accordez, et vous pouvez le retirer.',
    detailFalc: 'C\'est votre choix. Vous pouvez arrêter le partage.',
    links: [{ to: '#share-actions', label: 'Aller aux boutons de partage' }],
  });
  push({
    kind: 'urgent',
    title: 'En cas d\'urgence',
    titleFalc: 'Si c\'est urgent, voyez les ressources d\'urgence.',
    detail: 'Des ressources d\'urgence sont réunies sur une page dédiée.',
    detailFalc: 'Une page réunit les aides d\'urgence.',
    links: [{ to: '/ressources?emergency=1', label: 'Voir les ressources d\'urgence' }],
  });
  return plan;
}

/** Plain lines for the PDF (no links, no markup). */
export function planTextLines(results) {
  const plan = buildActionPlan(results);
  return plan.steps.flatMap((s) => [`${s.order}. ${s.title}`, `   ${s.detail}`]);
}
