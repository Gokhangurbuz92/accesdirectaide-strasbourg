// @ts-nocheck
/**
 * DTA S1 stage 2b-2 — text content of the "Passeport Social" PDF (PURE, testable without jsPDF).
 * Built only from the assessment contract: no eligibility claim, no amount, no total, no "règles officielles".
 */
import { STATE_LABELS, missingFactLabel, readAssessment } from './assessmentLabels.js';

export const PASSPORT_TEXT = Object.freeze({
  subtitle: "Accès Direct Aide — Pistes d'orientation (non officielles)",
  banner: 'Simulation locale non officielle — aucune décision',
  sectionTitle: "PISTES D'ORIENTATION",
  none: 'Aucune piste détaillée disponible dans ce document.',
  dataStatus: 'Données en cours de vérification.',
  steps: [
    '1. Apportez ce document à un professionnel (CCAS, CAF, MSA...).',
    '2. Demandez-lui de vérifier votre situation : seul l\'organisme compétent décide.',
    '3. Les justificatifs à fournir sont à confirmer auprès de l\'organisme.',
    '4. Conservez ce document comme repère pour vos démarches.',
  ],
  disclaimer: 'Ce document est une pré-orientation indicative issue d\'une simulation locale non officielle. ' +
    'Il ne constitue ni une décision, ni une promesse de versement, ni un refus. Les données sont en cours de vérification. ' +
    'Pour toute demande, adressez-vous aux organismes compétents (CAF, MSA, CPAM, Département).',
});

/** @returns {Array<{ title: string, status: string, detail: string }>} */
export function passportAssessmentLines(results) {
  return readAssessment(results).items.map((it) => ({
    title: it.label,
    status: STATE_LABELS[it.state],
    detail: it.state === 'MISSING_INFORMATION'
      ? `À préciser : ${(it.missingFacts || []).map(missingFactLabel).join(', ')}`
      : (it.explanationFalc || it.explanation),
  }));
}

/** Letter lines that list the items to check (no entitlement wording, never an amount). */
export function letterAssessmentLines(results) {
  const toCheck = readAssessment(results).items.filter((i) => i.state === 'CHECK_REQUIRED' || i.state === 'POSSIBLE');
  if (!toCheck.length) return [];
  return ['D\'après une simulation indicative non officielle, je souhaite faire vérifier ma situation pour :', ...toCheck.map((i) => `  • ${i.label}`), ''];
}
