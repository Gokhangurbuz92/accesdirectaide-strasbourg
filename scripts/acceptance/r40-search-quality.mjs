#!/usr/bin/env node
/**
 * R40 — search quality evaluation: relevance AND crisis signal, six languages, read-only and paced (the search allows 30 requests a minute per IP).
 *   node scripts/acceptance/r40-search-quality.mjs [base] [--out result.json] [--only <id-prefix>]
 * Each case is a query a person types, with the interface language they use, and what an honest answer contains:
 *   g  official Service-Public sheet ids (guides) — one of them among the first 3 guides
 *   a  aide slugs — one of them among the first 3 aides;  d  démarche slugs among the first 3;  s  place types among the first 3 places
 *   notA / notG  aides / sheets that must NOT be in the first 3 (unrelated results that used to come up)
 *   safety  the expected crisis kind (search-safety.js), an array of acceptable kinds, or null (the default: NO crisis signal — every case is a
 *           false-positive check unless it says otherwise)
 *   empty   true when the honest answer is no aide and no guide at all
 * Expectations were picked from the PUBLISHED Production catalogue (GET /api/guides, /api/aides, /api/demarches, 03/11/2026: 75 sheets, 17 aides,
 * 13 démarches). A sheet that is not published cannot be expected. The LAB catalogue differs: read LAB numbers with that in mind.
 */
import fs from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'https://www.accesdirectaide.fr').replace(/\/$/, '');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const PACE_MS = 2500;   // ≥ 2.2 s between calls: the search allows 30 requests a minute per IP

/** @typedef {{ id: string, lang: string, cat: string, q: string, g?: string[], a?: string[], d?: string[], s?: string[], notA?: string[], notG?: string[], safety?: string | string[] | null, empty?: boolean, note?: string }} Case */
/** @type {Case[]} */
export const CASES = [
  // ---------------------------------------------------------------- the R40 defect and end of life
  { id: 'eol-1', lang: 'fr', cat: 'end-of-life', q: 'aide active à mourir loi', g: ['F32010', 'F39676', 'F706'], notA: ['apl', 'rsa', 'als'], note: 'the bill itself is not in the catalogue; the official end-of-life sheets are' },
  { id: 'eol-2', lang: 'fr', cat: 'end-of-life', q: 'fin de vie', g: ['F32010', 'F39676', 'F706'] },
  { id: 'eol-3', lang: 'fr', cat: 'end-of-life', q: 'directives anticipées', g: ['F32010'] },
  { id: 'eol-4', lang: 'fr', cat: 'end-of-life', q: 'soins palliatifs pour mon père', g: ['F39676'] },
  { id: 'eol-5', lang: 'fr', cat: 'end-of-life', q: 'congé pour accompagner un proche en fin de vie', g: ['F706', 'F16920'] },
  { id: 'eol-6', lang: 'fr', cat: 'end-of-life', q: 'euthanasie', g: ['F32010', 'F39676'], notA: ['apl', 'rsa', 'als'] },
  // ---------------------------------------------------------------- crisis: false negatives (a signal is REQUIRED)
  { id: 'fn-1', lang: 'fr', cat: 'crisis-fn', q: 'je veux mourir', safety: 'suicide' },
  { id: 'fn-2', lang: 'fr', cat: 'crisis-fn', q: "j'ai envie de me suicider", safety: 'suicide' },
  { id: 'fn-3', lang: 'fr', cat: 'crisis-fn', q: 'mon ami veut se suicider', safety: 'suicide' },
  { id: 'fn-4', lang: 'fr', cat: 'crisis-fn', q: 'ma fille parle de se tuer', safety: 'suicide' },
  { id: 'fn-5', lang: 'fr', cat: 'crisis-fn', q: "je n'ai plus envie de vivre", safety: 'suicide' },
  { id: 'fn-6', lang: 'fr', cat: 'crisis-fn', q: "je veux qu'on m'aide à mourir", safety: 'suicide', note: 'first person: the end-of-life wording must not silence it' },
  { id: 'fn-7', lang: 'fr', cat: 'crisis-fn', q: 'aidez-moi à mourir', safety: 'suicide' },
  { id: 'fn-8', lang: 'fr', cat: 'crisis-fn', q: 'je pense au suicide', safety: 'suicide' },
  { id: 'fn-9', lang: 'fr', cat: 'crisis-fn', q: 'suicide', safety: 'suicide', note: 'ambiguous: safety wins' },
  { id: 'fn-10', lang: 'fr', cat: 'crisis-fn', q: 'tentative de suicide de mon fils', safety: ['suicide', 'enfant'] },
  { id: 'fn-11', lang: 'fr', cat: 'crisis-fn', q: 'prévention du suicide', safety: 'suicide', g: ['F33954'] },
  { id: 'fn-12', lang: 'fr', cat: 'crisis-fn', q: "j'en peux plus je veux en finir avec la vie", safety: 'suicide' },
  { id: 'fn-13', lang: 'en', cat: 'crisis-fn', q: 'my friend wants to kill himself', safety: 'suicide' },
  { id: 'fn-14', lang: 'en', cat: 'crisis-fn', q: "I don't want to live anymore", safety: 'suicide' },
  { id: 'fn-15', lang: 'tr', cat: 'crisis-fn', q: 'intihar etmek istiyorum', safety: 'suicide' },
  { id: 'fn-16', lang: 'ar', cat: 'crisis-fn', q: 'أريد أن أنتحر', safety: 'suicide' },
  { id: 'fn-17', lang: 'de', cat: 'crisis-fn', q: 'ich will nicht mehr leben', safety: 'suicide' },
  { id: 'fn-18', lang: 'uk', cat: 'crisis-fn', q: 'хочу покінчити з собою', safety: 'suicide' },
  { id: 'fn-19', lang: 'fr', cat: 'crisis-fn', q: 'mon copain me frappe', safety: 'violence', g: ['F12544'] },
  { id: 'fn-20', lang: 'en', cat: 'crisis-fn', q: 'my partner beats me', safety: 'violence' },
  { id: 'fn-21', lang: 'fr', cat: 'crisis-fn', q: 'mon beau-père frappe mon petit frère', safety: ['enfant', 'violence'] },
  { id: 'fn-22', lang: 'fr', cat: 'crisis-fn', q: "je suis à la rue ce soir avec mes enfants", safety: 'sans-abri' },
  { id: 'fn-23', lang: 'de', cat: 'crisis-fn', q: 'ich bin heute Nacht obdachlos', safety: 'sans-abri' },
  // ---------------------------------------------------------------- crisis: false positives (NO signal)
  { id: 'fp-1', lang: 'fr', cat: 'crisis-fp', q: 'suicide assisté loi', g: ['F32010', 'F39676'] },
  { id: 'fp-2', lang: 'fr', cat: 'crisis-fp', q: 'loi fin de vie 2026', g: ['F32010', 'F39676', 'F706'] },
  { id: 'fp-3', lang: 'fr', cat: 'crisis-fp', q: 'statistiques suicide France' },
  { id: 'fp-4', lang: 'fr', cat: 'crisis-fp', q: 'taux de suicide chez les jeunes' },
  { id: 'fp-5', lang: 'fr', cat: 'crisis-fp', q: 'histoire du suicide Durkheim' },
  { id: 'fp-6', lang: 'fr', cat: 'crisis-fp', q: 'loi sur les violences conjugales', g: ['F12544'] },
  { id: 'fp-7', lang: 'fr', cat: 'crisis-fp', q: 'statistiques violences conjugales 2025' },
  { id: 'fp-8', lang: 'fr', cat: 'crisis-fp', q: 'film sur le suicide' },
  { id: 'fp-9', lang: 'fr', cat: 'crisis-fp', q: 'actualité suicide assisté Sénat' },
  { id: 'fp-10', lang: 'en', cat: 'crisis-fp', q: 'assisted suicide law' },
  { id: 'fp-11', lang: 'de', cat: 'crisis-fp', q: 'Sterbehilfe Gesetz' },
  { id: 'fp-12', lang: 'fr', cat: 'crisis-fp', q: 'euthanasie Belgique loi' },
  { id: 'fp-13', lang: 'fr', cat: 'crisis-fp', q: 'aide à mourir', g: ['F32010', 'F39676', 'F706'] },
  { id: 'fp-14', lang: 'fr', cat: 'crisis-fp', q: 'le viol est puni article 222-23' },
  { id: 'fp-15', lang: 'fr', cat: 'crisis-fp', q: 'coup de pouce chauffage' },
  { id: 'fp-16', lang: 'en', cat: 'crisis-fp', q: 'suicide statistics in France' },
  // ---------------------------------------------------------------- housing / eviction
  { id: 'ho-1', lang: 'fr', cat: 'housing-eviction', q: 'mon propriétaire veut m’expulser', g: ['F31272', 'F34736'] },
  { id: 'ho-2', lang: 'fr', cat: 'housing-eviction', q: 'trêve hivernale expulsion', g: ['F34736', 'F31272'] },
  { id: 'ho-3', lang: 'fr', cat: 'housing-eviction', q: 'loyers impayés', g: ['F31272', 'F32037'] },
  { id: 'ho-4', lang: 'fr', cat: 'housing-eviction', q: 'logement insalubre moisissures', g: ['F16158'] },
  { id: 'ho-5', lang: 'fr', cat: 'housing-eviction', q: 'recours DALO', g: ['F18005'] },
  { id: 'ho-6', lang: 'fr', cat: 'housing-eviction', q: 'pas de domicile adresse pour recevoir le courrier', g: ['F17317'] },
  { id: 'ho-7', lang: 'en', cat: 'housing-eviction', q: 'eviction for unpaid rent', g: ['F31272'] },
  { id: 'ho-8', lang: 'tr', cat: 'housing-eviction', q: 'kiramı ödeyemiyorum', g: ['F31272', 'F32037', 'F12006', 'F1334'] },
  { id: 'ho-9', lang: 'de', cat: 'housing-eviction', q: 'Zwangsräumung Wohnung', g: ['F31272', 'F34736'] },
  { id: 'ho-10', lang: 'uk', cat: 'housing-eviction', q: 'виселення з квартири', g: ['F31272', 'F34736'] },
  { id: 'ho-11', lang: 'fr', cat: 'housing-eviction', q: 'demande de logement social', d: ['demande-hlm-67-68'] },
  { id: 'ho-12', lang: 'fr', cat: 'housing-eviction', q: 'hébergement d’urgence', g: ['F2003', 'F20343'] },
  // ---------------------------------------------------------------- housing benefit
  { id: 'hb-1', lang: 'fr', cat: 'housing-benefit', q: 'aide pour payer mon loyer', a: ['apl', 'als'], g: ['F12006', 'F1280', 'F32037', 'F1334'] },
  { id: 'hb-2', lang: 'fr', cat: 'housing-benefit', q: 'APL', a: ['apl'], g: ['F12006'] },
  { id: 'hb-3', lang: 'fr', cat: 'housing-benefit', q: 'ALS étudiant', a: ['als'], g: ['F1280'] },
  { id: 'hb-4', lang: 'fr', cat: 'housing-benefit', q: 'FSL dépôt de garantie', g: ['F1334'] },
  { id: 'hb-5', lang: 'en', cat: 'housing-benefit', q: 'housing benefit', g: ['F12006', 'F1280'] },
  { id: 'hb-6', lang: 'ar', cat: 'housing-benefit', q: 'مساعده السكن', g: ['F12006', 'F1280'], note: 'ه written for ة' },
  { id: 'hb-7', lang: 'ar', cat: 'housing-benefit', q: 'الايجار', g: ['F12006', 'F1280', 'F32037', 'F31272'], note: 'no hamza' },
  { id: 'hb-8', lang: 'de', cat: 'housing-benefit', q: 'Mietzuschuss', g: ['F12006', 'F1280', 'F32037'] },
  { id: 'hb-9', lang: 'de', cat: 'housing-benefit', q: 'Wohngeldantrag', g: ['F12006', 'F1280'] },
  { id: 'hb-10', lang: 'tr', cat: 'housing-benefit', q: 'konut yardımı başvurusu', g: ['F12006', 'F1280'] },
  { id: 'hb-11', lang: 'uk', cat: 'housing-benefit', q: 'допомога на житло', g: ['F12006', 'F1280'] },
  // ---------------------------------------------------------------- family
  { id: 'fa-1', lang: 'fr', cat: 'family', q: 'maman solo aides', g: ['F38245', 'F815'] },
  { id: 'fa-2', lang: 'fr', cat: 'family', q: 'pension alimentaire non payée', g: ['F815'] },
  { id: 'fa-3', lang: 'fr', cat: 'family', q: 'aide pour payer la nounou', g: ['F38243'] },
  { id: 'fa-4', lang: 'fr', cat: 'family', q: 'vacances enfants CAF', a: ['ave-avf'] },
  { id: 'fa-5', lang: 'en', cat: 'family', q: 'single parent benefits', g: ['F38245', 'F815'] },
  { id: 'fa-6', lang: 'tr', cat: 'family', q: 'tek ebeveyn yardımı', g: ['F38245', 'F815'] },
  { id: 'fa-7', lang: 'de', cat: 'family', q: 'alleinerziehend Unterstützung', g: ['F38245', 'F815'] },
  { id: 'fa-8', lang: 'fr', cat: 'family', q: 'signaler une séparation à la CAF', g: ['F827'] },
  // ---------------------------------------------------------------- disability
  { id: 'di-1', lang: 'fr', cat: 'disability', q: 'AAH', a: ['aah'] },
  { id: 'di-2', lang: 'fr', cat: 'disability', q: 'carte de stationnement handicapé', g: ['F34049'] },
  { id: 'di-3', lang: 'fr', cat: 'disability', q: 'enfant handicapé allocation', a: ['aeeh'] },
  { id: 'di-4', lang: 'fr', cat: 'disability', q: 'MDPH Strasbourg', s: ['MDPH (maison des personnes handicapées)'] },
  { id: 'di-5', lang: 'en', cat: 'disability', q: 'disability allowance', a: ['aah', 'pch', 'aeeh'] },
  { id: 'di-6', lang: 'de', cat: 'disability', q: 'Schwerbehindertenausweis', g: ['F34049'] },
  { id: 'di-7', lang: 'tr', cat: 'disability', q: 'engelli maaşı', a: ['aah', 'pch', 'aeeh'] },
  { id: 'di-8', lang: 'ar', cat: 'disability', q: 'بطاقة الإعاقة', g: ['F34049'] },
  // ---------------------------------------------------------------- money / debt
  { id: 'mo-1', lang: 'fr', cat: 'money-debt', q: 'dossier de surendettement', g: ['F134'] },
  { id: 'mo-2', lang: 'fr', cat: 'money-debt', q: 'la banque refuse de m’ouvrir un compte', g: ['F2417'] },
  { id: 'mo-3', lang: 'fr', cat: 'money-debt', q: 'microcrédit', a: ['microcredit-personnel'] },
  { id: 'mo-4', lang: 'fr', cat: 'money-debt', q: "je n'arrive plus à payer mes factures", g: ['F38589', 'F20055'] },
  { id: 'mo-5', lang: 'en', cat: 'money-debt', q: 'too much debt', g: ['F134'] },
  { id: 'mo-6', lang: 'tr', cat: 'money-debt', q: 'borçlarımı ödeyemiyorum', g: ['F134'] },
  { id: 'mo-7', lang: 'de', cat: 'money-debt', q: 'Schuldnerberatung', g: ['F134'] },
  { id: 'mo-8', lang: 'uk', cat: 'money-debt', q: 'відкрити банківський рахунок', g: ['F2417'] },
  { id: 'mo-9', lang: 'uk', cat: 'money-debt', q: 'банк відмовив відкрити рахунок', g: ['F2417'], note: 'рахунок = account here' },
  // ---------------------------------------------------------------- employment
  { id: 'em-1', lang: 'fr', cat: 'employment', q: 'allocation chômage', a: ['allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-salarie-du-sec-50a72e', 'allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-agent-public-d-c02687'] },
  { id: 'em-2', lang: 'fr', cat: 'employment', q: 'créer mon entreprise en étant au chômage', a: ['aide-a-la-reprise-ou-a-la-creation-d-entreprise-arce-083c97'] },
  { id: 'em-3', lang: 'fr', cat: 'employment', q: "prime d'activité", a: ['prime-activite'], d: ['prime-activite-caf'] },
  { id: 'em-4', lang: 'fr', cat: 'employment', q: 'actualisation France Travail', d: ['actualisation-france-travail'] },
  { id: 'em-5', lang: 'fr', cat: 'employment', q: 'insertion par l’activité économique', g: ['F2284'] },
  { id: 'em-6', lang: 'en', cat: 'employment', q: 'unemployment benefit', a: ['allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-salarie-du-sec-50a72e', 'allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-agent-public-d-c02687'] },
  { id: 'em-7', lang: 'de', cat: 'employment', q: 'Arbeitslosengeld', a: ['allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-salarie-du-sec-50a72e', 'allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-agent-public-d-c02687'] },
  { id: 'em-8', lang: 'tr', cat: 'employment', q: 'işsizlik maaşı', a: ['allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-salarie-du-sec-50a72e', 'allocation-chomage-d-aide-au-retour-a-l-emploi-are-d-un-agent-public-d-c02687'] },
  { id: 'em-9', lang: 'fr', cat: 'employment', q: 'aide permis de conduire pour travailler', a: ['permis'] },
  // ---------------------------------------------------------------- social assistance
  { id: 'sa-1', lang: 'fr', cat: 'social-assistance', q: 'RSA', a: ['rsa'], g: ['F19778'] },
  { id: 'sa-2', lang: 'fr', cat: 'social-assistance', q: 'revenu de solidarité active', a: ['rsa'] },
  { id: 'sa-3', lang: 'fr', cat: 'social-assistance', q: "je n'ai aucun revenu", a: ['rsa'] },
  { id: 'sa-4', lang: 'en', cat: 'social-assistance', q: 'minimum income', a: ['rsa'] },
  { id: 'sa-5', lang: 'de', cat: 'social-assistance', q: 'Bürgergeld', a: ['rsa'] },
  { id: 'sa-6', lang: 'ar', cat: 'social-assistance', q: 'الحد الأدنى للدخل', a: ['rsa'] },
  { id: 'sa-7', lang: 'fr', cat: 'social-assistance', q: 'accueil CCAS Strasbourg', s: ["CCAS (centre communal d'action sociale)"] },
  // ---------------------------------------------------------------- procedures
  { id: 'pr-1', lang: 'fr', cat: 'procedures', q: 'contester une décision de la CAF', g: ['F2474', 'F13158'] },
  { id: 'pr-2', lang: 'fr', cat: 'procedures', q: 'Défenseur des droits', g: ['F13158'] },
  { id: 'pr-3', lang: 'fr', cat: 'procedures', q: "j'ai perdu tous mes papiers", g: ['F31421'] },
  { id: 'pr-4', lang: 'fr', cat: 'procedures', q: 'on m’a volé mes papiers', g: ['F10774'] },
  { id: 'pr-5', lang: 'fr', cat: 'procedures', q: 'combien de temps garder ses papiers', g: ['F19134'] },
  { id: 'pr-6', lang: 'fr', cat: 'procedures', q: 'déclaration de revenus', g: ['F358'] },
  { id: 'pr-7', lang: 'fr', cat: 'procedures', q: 'démarches après un décès', g: ['F16507'] },
  { id: 'pr-8', lang: 'fr', cat: 'procedures', q: 'aide pour faire mes démarches en ligne', s: ['Espace France Services'] },
  { id: 'pr-9', lang: 'en', cat: 'procedures', q: 'my relative died what to do', g: ['F16507'] },
  { id: 'pr-10', lang: 'de', cat: 'procedures', q: 'Steuererklärung', g: ['F358'] },
  { id: 'pr-11', lang: 'fr', cat: 'procedures', q: 'médiateur assurance maladie', g: ['F20849'] },
  // ---------------------------------------------------------------- residence permits
  { id: 'rp-1', lang: 'fr', cat: 'residence-permit', q: 'titre de séjour', d: ['rdv-titre-sejour-67', 'etudiant-etranger-en-france-visa-de-long-sejour-ou-titre-de-sejour-c8b8e5'] },
  { id: 'rp-2', lang: 'fr', cat: 'residence-permit', q: 'mineur isolé 18 ans titre de séjour', g: ['F31037'] },
  { id: 'rp-3', lang: 'fr', cat: 'residence-permit', q: 'contrat d’intégration républicaine', g: ['F17048'] },
  { id: 'rp-4', lang: 'fr', cat: 'residence-permit', q: 'protection subsidiaire', g: ['F299'] },
  { id: 'rp-5', lang: 'en', cat: 'residence-permit', q: 'residence permit', d: ['rdv-titre-sejour-67', 'etudiant-etranger-en-france-visa-de-long-sejour-ou-titre-de-sejour-c8b8e5'] },
  { id: 'rp-6', lang: 'tr', cat: 'residence-permit', q: 'oturma izni', d: ['rdv-titre-sejour-67', 'etudiant-etranger-en-france-visa-de-long-sejour-ou-titre-de-sejour-c8b8e5'] },
  { id: 'rp-7', lang: 'ar', cat: 'residence-permit', q: 'بطاقة الإقامة', d: ['rdv-titre-sejour-67', 'etudiant-etranger-en-france-visa-de-long-sejour-ou-titre-de-sejour-c8b8e5'] },
  { id: 'rp-8', lang: 'de', cat: 'residence-permit', q: 'Aufenthaltstitel verlängern', d: ['rdv-titre-sejour-67', 'etudiant-etranger-en-france-visa-de-long-sejour-ou-titre-de-sejour-c8b8e5'] },
  { id: 'rp-9', lang: 'uk', cat: 'residence-permit', q: 'тимчасовий захист', g: ['F299'] },
  // ---------------------------------------------------------------- health access
  { id: 'he-1', lang: 'fr', cat: 'health-access', q: 'se soigner sans papiers', g: ['F3079'] },
  { id: 'he-2', lang: 'fr', cat: 'health-access', q: 'complémentaire santé gratuite', a: ['c2s'] },
  { id: 'he-3', lang: 'fr', cat: 'health-access', q: 'AME', g: ['F3079'] },
  { id: 'he-4', lang: 'fr', cat: 'health-access', q: 'pilule contraceptive gratuite', g: ['F707'] },
  { id: 'he-5', lang: 'en', cat: 'health-access', q: 'health insurance without documents', g: ['F3079'] },
  { id: 'he-6', lang: 'de', cat: 'health-access', q: 'Krankenversicherung ohne Papiere', g: ['F3079'] },
  { id: 'he-7', lang: 'ar', cat: 'health-access', q: 'اجهاض', g: ['F1551'], note: 'no article, no hamza' },
  { id: 'he-8', lang: 'fr', cat: 'health-access', q: 'sortir de la drogue', g: ['F740'] },
  { id: 'he-9', lang: 'fr', cat: 'health-access', q: 'interdiction de casino', g: ['F15814'] },
  // ---------------------------------------------------------------- mental health
  { id: 'mh-1', lang: 'fr', cat: 'mental-health', q: 'consulter un psychologue remboursé', g: ['F34917'] },
  { id: 'mh-2', lang: 'fr', cat: 'mental-health', q: 'numéro d’écoute', g: ['F33954'] },
  { id: 'mh-3', lang: 'en', cat: 'mental-health', q: 'see a psychologist', g: ['F34917'] },
  { id: 'mh-4', lang: 'tr', cat: 'mental-health', q: 'psikolog', g: ['F34917'] },
  { id: 'mh-5', lang: 'uk', cat: 'mental-health', q: 'психолог безкоштовно', g: ['F34917'] },
  { id: 'mh-6', lang: 'fr', cat: 'mental-health', q: 'dépression qui consulter', g: ['F34917'] },
  // ---------------------------------------------------------------- domestic violence
  { id: 'dv-1', lang: 'fr', cat: 'domestic-violence', q: 'violences conjugales', g: ['F12544'], safety: 'violence' },
  { id: 'dv-2', lang: 'fr', cat: 'domestic-violence', q: 'porter plainte victime', g: ['F20789'] },
  { id: 'dv-3', lang: 'fr', cat: 'domestic-violence', q: 'harcèlement au travail', g: ['F2354'] },
  { id: 'dv-4', lang: 'fr', cat: 'domestic-violence', q: 'harcèlement sexuel', g: ['F1043'] },
  { id: 'dv-5', lang: 'fr', cat: 'domestic-violence', q: 'indemnisation victime agression', g: ['F2313', 'F20789'], note: 'a past offence and its compensation: no emergency signal' },
  { id: 'dv-6', lang: 'tr', cat: 'domestic-violence', q: 'eşim beni dövüyor', g: ['F12544'], safety: 'violence' },
  { id: 'dv-7', lang: 'ar', cat: 'domestic-violence', q: 'العنف الاسري', g: ['F12544'], safety: 'violence', note: 'no hamza' },
  { id: 'dv-8', lang: 'uk', cat: 'domestic-violence', q: 'чоловік мене б’є', g: ['F12544'], safety: 'violence' },
  // ---------------------------------------------------------------- child protection
  { id: 'cp-1', lang: 'fr', cat: 'child-protection', q: 'enfant maltraité que faire', g: ['F952'], safety: 'enfant' },
  { id: 'cp-2', lang: 'fr', cat: 'child-protection', q: 'confier mon enfant à l’ASE', g: ['F959'] },
  { id: 'cp-3', lang: 'fr', cat: 'child-protection', q: 'placement par le juge des enfants', g: ['F3140'] },
  { id: 'cp-4', lang: 'fr', cat: 'child-protection', q: 'AEMO', g: ['F39128'] },
  { id: 'cp-5', lang: 'fr', cat: 'child-protection', q: 'aide éducative à domicile', g: ['F970'] },
  { id: 'cp-6', lang: 'en', cat: 'child-protection', q: 'child abuse', g: ['F952'], safety: 'enfant' },
  { id: 'cp-7', lang: 'de', cat: 'child-protection', q: 'Jugendamt Kinderschutz', g: ['F952', 'F959', 'F3140', 'F970', 'F39128'] },
  // ---------------------------------------------------------------- older people
  { id: 'op-1', lang: 'fr', cat: 'older-people', q: 'payer la maison de retraite', g: ['F2444'] },
  { id: 'op-2', lang: 'fr', cat: 'older-people', q: 'APA', a: ['apa-alsace'] },
  { id: 'op-3', lang: 'fr', cat: 'older-people', q: 'aide à domicile pour ma mère', g: ['F245', 'F246'] },
  { id: 'op-4', lang: 'fr', cat: 'older-people', q: 'adapter la salle de bain personne âgée', g: ['F37501'] },
  { id: 'op-5', lang: 'fr', cat: 'older-people', q: 'ma grand-mère est maltraitée en ehpad', g: ['F861'], safety: 'personne-agee' },
  { id: 'op-6', lang: 'fr', cat: 'older-people', q: 'petite retraite aides', g: ['F32057'] },
  { id: 'op-7', lang: 'en', cat: 'older-people', q: 'care home', g: ['F763', 'F255', 'F2444'] },
  { id: 'op-8', lang: 'tr', cat: 'older-people', q: 'yaşlı bakım evi', g: ['F763', 'F255', 'F2444'] },
  // ---------------------------------------------------------------- legal protection of adults
  { id: 'lp-1', lang: 'fr', cat: 'adult-protection', q: 'curatelle', g: ['F2094', 'F10424'] },
  { id: 'lp-2', lang: 'fr', cat: 'adult-protection', q: 'mettre mon père sous tutelle', g: ['F2120', 'F10424'] },
  { id: 'lp-3', lang: 'fr', cat: 'adult-protection', q: 'MJPM coût', g: ['F3165'] },
  { id: 'lp-4', lang: 'fr', cat: 'adult-protection', q: 'habilitation familiale', g: ['F33367'] },
  { id: 'lp-5', lang: 'fr', cat: 'adult-protection', q: 'mandat de protection future', g: ['F16670'] },
  { id: 'lp-6', lang: 'fr', cat: 'adult-protection', q: 'MASP accompagnement budget', g: ['F1336'] },
  { id: 'lp-7', lang: 'de', cat: 'adult-protection', q: 'rechtliche Betreuung für meine Mutter', g: ['F2120', 'F2094', 'F10424'] },
  { id: 'lp-8', lang: 'tr', cat: 'adult-protection', q: 'vasilik', g: ['F2120', 'F10424', 'F2094'] },
  // ---------------------------------------------------------------- energy
  { id: 'en-1', lang: 'fr', cat: 'energy', q: 'coupure d’électricité facture impayée', g: ['F20055', 'F38589'] },
  { id: 'en-2', lang: 'en', cat: 'energy', q: 'unpaid electricity bill', g: ['F20055'] },
  { id: 'en-3', lang: 'de', cat: 'energy', q: 'Stromschulden', g: ['F20055', 'F38589'] },
  { id: 'en-4', lang: 'tr', cat: 'energy', q: 'faturalarımı ödeyemiyorum', g: ['F20055', 'F38589'] },
  { id: 'en-5', lang: 'uk', cat: 'energy', q: 'рахунок за газ', g: ['F20055', 'F38589'], note: 'рахунок = bill here' },
  { id: 'en-6', lang: 'uk', cat: 'energy', q: 'не можу оплатити рахунок за світло', g: ['F20055', 'F38589'] },
  { id: 'en-7', lang: 'ar', cat: 'energy', q: 'فاتوره الكهرباء', g: ['F20055'], note: 'ه written for ة' },
  // ---------------------------------------------------------------- Strasbourg local services
  { id: 'st-1', lang: 'fr', cat: 'strasbourg-local', q: 'France Services Strasbourg', s: ['Espace France Services'] },
  { id: 'st-2', lang: 'fr', cat: 'strasbourg-local', q: 'maison des solidarités', s: ['Maison des solidarités (Espace Solidarités)'] },
  { id: 'st-3', lang: 'fr', cat: 'strasbourg-local', q: 'mission locale jeunes Strasbourg', s: ['Mission locale (jeunes de 16 à 25 ans)'] },
  { id: 'st-4', lang: 'fr', cat: 'strasbourg-local', q: 'point justice avocat gratuit', s: ['Point-justice (accès au droit)', 'Maison de justice et du droit'] },
  { id: 'st-5', lang: 'en', cat: 'strasbourg-local', q: 'CCAS Strasbourg', s: ["CCAS (centre communal d'action sociale)"] },
  { id: 'st-6', lang: 'de', cat: 'strasbourg-local', q: 'Sozialamt Straßburg', s: ["CCAS (centre communal d'action sociale)", 'Maison des solidarités (Espace Solidarités)'] },
  // ---------------------------------------------------------------- official benefit names
  { id: 'ob-1', lang: 'fr', cat: 'official-names', q: 'PCH', a: ['pch'] },
  { id: 'ob-2', lang: 'fr', cat: 'official-names', q: 'C2S', a: ['c2s'], d: ['demande-c2s'] },
  { id: 'ob-3', lang: 'fr', cat: 'official-names', q: 'ASF', g: ['F815'] },
  { id: 'ob-4', lang: 'fr', cat: 'official-names', q: 'AEEH', a: ['aeeh'] },
  { id: 'ob-5', lang: 'fr', cat: 'official-names', q: 'aide juridictionnelle', a: ['aide-juridictionnelle'] },
  { id: 'ob-6', lang: 'fr', cat: 'official-names', q: 'ARCE', a: ['aide-a-la-reprise-ou-a-la-creation-d-entreprise-arce-083c97'] },
  { id: 'ob-7', lang: 'fr', cat: 'official-names', q: 'DAHO', g: ['F20343'] },
  { id: 'ob-8', lang: 'fr', cat: 'official-names', q: "MaPrimeAdapt'", g: ['F37501'] },
  // R42 DEC-R42-05: the faj-strasbourg record is on a publication hold (copied text); until a verified rewrite is published the query must
  // never show it and must still lead to a real local pathway for young people (the Mission locale place).
  { id: 'ob-9', lang: 'fr', cat: 'official-names', q: 'FAJ jeunes Strasbourg', s: ['Mission locale (jeunes de 16 à 25 ans)'], notA: ['faj-strasbourg'] },
  // ---------------------------------------------------------------- everyday phrasing and controls
  { id: 'ev-1', lang: 'fr', cat: 'everyday', q: 'avocat gratuit', a: ['aide-juridictionnelle'] },
  { id: 'ev-2', lang: 'fr', cat: 'everyday', q: 'j’ai plus de sous pour manger', note: 'food aid: no aide in the catalogue — no crisis signal' },
  { id: 'ev-3', lang: 'fr', cat: 'everyday', q: 'mutuelle pas chère', a: ['c2s'], d: ['couverture-maladie-complementaire-mutuelle-f60fb1', 'demande-c2s'] },
  { id: 'ev-4', lang: 'fr', cat: 'everyday', q: 'acheter une voiture de luxe', empty: true },
  { id: 'ev-5', lang: 'fr', cat: 'everyday', q: 'loi', notA: ['apl', 'als'], note: 'a bare legal word is not « loyer »' },
  { id: 'ev-6', lang: 'fr', cat: 'everyday', q: 'loi DALO', g: ['F18005'], notA: ['rsa'] },
  { id: 'ev-7', lang: 'en', cat: 'everyday', q: 'renew my passport', notG: ['F1551', 'F12544'] },
  { id: 'ev-8', lang: 'fr', cat: 'everyday', q: 'retraite anticipée carrière longue', d: ['retraite-anticipee-pour-carriere-longue-du-salarie-4c374c'] },
  { id: 'ev-9', lang: 'fr', cat: 'everyday', q: 'pass culture', d: ['pass-culture-jeunes'] },
  { id: 'ev-10', lang: 'fr', cat: 'everyday', q: 'proche aidant épuisé', g: ['F16920'] },
];

const sheet = (slug) => String(slug || '').split('-').pop().toUpperCase();
const anyIn = (want, got) => !want || want.some((x) => got.includes(x));
const noneIn = (bad, got) => !bad || !bad.some((x) => got.includes(x));
const kindOk = (want, got) => (Array.isArray(want) ? want.includes(got) : (want ?? null) === (got ?? null));

/** judge one response against its case (exported for the unit test of the harness) */
export function judge(c, body, http = 200) {
  const guides = (body.guides || []).map((g) => sheet(g.slug));
  const aides = (body.items || []).map((x) => x.slug);
  const dem = (body.demarches || []).map((x) => x.slug);
  const str = (body.structures || []).map((x) => x.category);
  const kind = body.safety?.kind || null;
  const fails = [];
  if (http !== 200) fails.push(`http ${http}`);
  if (!anyIn(c.g, guides.slice(0, 3))) fails.push(`guides ${c.g} not in top3`);
  if (!anyIn(c.a, aides.slice(0, 3))) fails.push(`aides ${c.a} not in top3`);
  if (!anyIn(c.d, dem.slice(0, 3))) fails.push(`démarches ${c.d} not in top3`);
  if (!anyIn(c.s, str.slice(0, 3))) fails.push(`places ${c.s} not in top3`);
  if (!noneIn(c.notA, aides.slice(0, 3))) fails.push(`unrelated aides ${c.notA.filter((x) => aides.slice(0, 3).includes(x))}`);
  if (!noneIn(c.notG, guides.slice(0, 3))) fails.push(`unrelated sheets ${c.notG.filter((x) => guides.slice(0, 3).includes(x))}`);
  if (c.empty && (aides.length || guides.length)) fails.push('expected no aide and no guide');
  if (!kindOk(c.safety, kind)) fails.push(`safety ${kind} ≠ ${JSON.stringify(c.safety ?? null)}`);
  return { pass: fails.length === 0, fails, got: { guides: guides.slice(0, 3), aides: aides.slice(0, 3), dem: dem.slice(0, 3), str: str.slice(0, 3), safety: kind, fr: body.crossLanguage?.query || null } };
}

async function main() {
  const h = await fetch(`${base}/api/health`);
  const cookie = (h.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const token = /__csrf=([^;]+)/.exec(cookie)?.[1];
  // a browser on the public origin sends Origin; a loopback LAB server (http) is reached like a server-side client, without one
  const originHeader = base.startsWith('https://') ? { origin: base } : {};
  const rows = [];
  const cases = only ? CASES.filter((c) => c.id.startsWith(only)) : CASES;
  for (const [i, c] of cases.entries()) {
    if (i) await new Promise((r) => setTimeout(r, PACE_MS));
    let r; let body = {};
    for (let attempt = 0; attempt < 3; attempt += 1) {
      r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie, ...originHeader }, body: JSON.stringify({ query: c.q, lang: c.lang }) });
      body = await r.json().catch(() => ({}));
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, 61000));   // rate limited: wait the window out, never hammer
    }
    const j = judge(c, body, r.status);
    rows.push({ ...c, ...j });
    console.log(`${j.pass ? 'PASS' : 'FAIL'} ${c.id} ${c.lang} « ${c.q} »${j.pass ? '' : ` — ${j.fails.join('; ')}`} | g[${j.got.guides.join(' ')}] a[${j.got.aides.join(' ')}] s=${j.got.safety}${j.got.fr ? ` fr=« ${j.got.fr} »` : ''}`);
  }
  const count = (key) => Object.fromEntries([...new Set(rows.map((x) => x[key]))].map((k) => [k, `${rows.filter((x) => x[key] === k && x.pass).length}/${rows.filter((x) => x[key] === k).length}`]));
  const crisis = (cat) => rows.filter((x) => x.cat === cat);
  const summary = {
    base, at: new Date().toISOString(), cases: rows.length, pass: rows.filter((x) => x.pass).length, fail: rows.filter((x) => !x.pass).length,
    byLang: count('lang'), byCat: count('cat'),
    // crisis errors over EVERY case: a missing signal where one is expected (FN), a signal where none is expected (FP)
    crisisFalseNegatives: rows.filter((x) => x.safety && !kindOk(x.safety, x.got.safety)).map((x) => x.id),
    crisisFalsePositives: rows.filter((x) => !x.safety && x.got.safety).map((x) => x.id),
    crisisFnSet: `${crisis('crisis-fn').filter((x) => kindOk(x.safety, x.got.safety)).length}/${crisis('crisis-fn').length}`,
    crisisFpSet: `${crisis('crisis-fp').filter((x) => !x.got.safety).length}/${crisis('crisis-fp').length}`,
  };
  console.log(`R40_SEARCH_QUALITY ${JSON.stringify(summary)}`);
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
}

if (isMainModule(import.meta.url)) await main();
