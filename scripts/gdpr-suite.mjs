import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

/**
 * SUITE RGPD — AccesDirectAide
 *
 * Génère REGISTRE_RGPD.json, une vue synthétique (générée) du registre des activités de traitement.
 * Référence : STRASBOURG_FULL_PRODUCT_PLAN/LEGAL_FR/06_REGISTRE_TRAITEMENTS.md (projet, relecture juridique requise).
 *
 * Les durées de conservation ne sont PAS écrites à la main : elles sont lues dans le code
 * (`RETENTION` de api/_handlers/cron/gdpr-purge.js et `RETENTION_POLICY_REGISTRY` de api/_services/privacy.js),
 * par lecture statique des sources (aucune base de données, aucune variable d'environnement, aucun import du runtime API).
 * Le statut de l'entité est lu dans src/config/legal-entity.ts.
 *
 * Usage :
 *   node scripts/gdpr-suite.mjs           → régénère REGISTRE_RGPD.json
 *   node scripts/gdpr-suite.mjs export …  → désactivé : l'export de portabilité se fait dans l'application (GET /api/auth/export-data)
 */

// Date de révision du contenu (fixe). À changer uniquement quand le contenu du registre est révisé — jamais la date d'exécution.
export const REGISTRE_VERSION = '0.9';   // G14-R4 (24/11/2026, PROPOSED): T35 testimonials (X02), T36 community stories (X01), T37 inclusive job board (X05) and the Release-4 notes (statut_r4) of T03 / T04 / T05 (shared dossiers, attachments and Mon Coffre recovery at the HDS service) — drafts until the owner approves notice v15 / cgu-citoyen v14. 0.8 = Release 3 owner legal approval (24/11/2026, OWNER_VALIDATED; CONTROL/master/completion/R3_OWNER_APPROVAL_2026-11-24.md): T04 (P29), T05 (P28), T11 / T15 (notice § 14), T29–T34 bases and the release-3 durations decided, AIPD lines R1–R9 signed by the owner (not a lawyer's or an expert's review). 0.7 = G14-R3 (24/11/2026, PROPOSED): release-3 follow-up (same 0.7): T04 appointment messaging (capability, HDS waiver, E9, in-thread report), T05 Mon Coffre at Scalingo HDS (E2E, art. 9.2.a), T10 content reports, T11 / T15 institution space and conventions (durations proposed), T34 partner referral bridge (FA-D7), Scalingo SAS (HDS) as a planned processor; T29 household, T30 guardian link (restricted form), T31 trusted persons, T32 events (X04); G14-R3G (same package): T33 representative of a protected adult. 0.6 = G14 owner legal approval (23/11/2026, OWNER_VALIDATED): P18 (T02), P19 (T08) and P20 (T25) bases decided, social referrals (T24) 12 months after closure decided, Cloudflare DPA v6.4 accepted online. 0.5 = G14 consolidation (23/11/2026): T02 OpenFisca at Scaleway, T08 Cloudflare Workers AI (branch g14-ai), T23 assisted mode, T24 social referrals, T25 Observatoire, T26 browser notifications and calendar files. Earlier:   // FA-D5 (18/11/2026): T22 backups + erasure traces, Scaleway and Cloudflare (R2) as processors, durations read from the code. 0.3 =   // Legal v5 (15/11/2026): provider contracts, transfer mechanisms and own-controller roles as read in CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md; Mailjet retained for service e-mails, contact deleted on erasure. 0.2 = R42-LEGAL: natural-person operator, account-required appointments, guest booking retired, statuses of the beta
export const REGISTRE_DATE_REVISION = '2026-11-24';

export const CONTACT_PROTECTION_DONNEES = '[À COMPLÉTER : contact protection des données]';
const DPA_INCONNU = 'inconnu / non signé';
const NON_VERIFIE = 'NON VÉRIFIÉ';
// Legal v5: an agreement incorporated by the provider's terms is NOT a signed agreement — the register says which one it is, and when it was read
const DPA_INTEGRE = 'intégré aux conditions de service (non signé) — pages publiques lues le 15/11/2026';
// FA-D5: Cloudflare — DPA v6.4 incorporated by the Self-Serve Subscription Agreement § 6.1, first read 09/11/2026 (CONTROL/v2/PRESTATAIRES_CONTRATS_PREUVES_FR.md); superseded by DPA_CLOUDFLARE_V64 below
// FA-D5: Scaleway — the owner's statement « Scaleway DPA : kabul » (13/11/2026, AIPD V2 annex § 8); the PDF is not archived yet
const DPA_CLOUDFLARE_V64 = 'intégré aux conditions de service (non signé) — DPA Cloudflare v6.4 (3 avril 2026) lu le 23/11/2026, accepté en ligne (décision du fondateur du 23/11/2026)';
// Cloudflare (R2) shares the same Cloudflare account and DPA: v6.4 accepted online by the same 23/11 decision (first read 09/11/2026)
const DPA_CLOUDFLARE_R2 = 'intégré aux conditions de service (non signé) — DPA Cloudflare lu le 09/11/2026 ; version 6.4 (3 avril 2026) accepté en ligne (décision du fondateur du 23/11/2026)';
// 24/11 fact-check: 8x8 (JaaS) — Global DPA 2025-02 accepted by the owner's decision of 23/11/2026, neither signed nor confirmed by the vendor
const DPA_8X8 = '8x8 Global DPA (version 2025-02) approuvé en principe par le fondateur (décision du 23/11/2026) — acceptation contractuelle non confirmée par le fournisseur, non signé';
// Microsoft Products and Services DPA: incorporated by Microsoft's terms; no evidence archived — never « signé »
const DPA_MICROSOFT = 'DPA Microsoft (Products and Services Data Protection Addendum) — NON VÉRIFIÉ (aucune preuve archivée), non signé';
const DPA_SCALEWAY = 'accepté dans la console par le responsable de traitement (déclaration du 13/11/2026) — PDF non archivé, non signé séparément';

/**
 * Founder clarification (24/11/2026): the register distinguishes how far each provider contract went —
 *   « accepté »                              the contract (or its DPA) was actually accepted (console / online acceptance recorded);
 *   « accepté en ligne (décision du fondateur du 23/11/2026) » Cloudflare DPA v6.4: the owner's 23/11 approval states it is deemed accepted online (both Cloudflare entries);
 *   « examiné »                              its public terms and DPA were read, no recorded acceptance is archived;
 *   « approuvé en principe par le fondateur » the founder decided to use it, the contractual acceptance is not confirmed;
 *   « non vérifié »                          nothing read or recorded; « sans objet » not chosen / not in use.
 */
export const CLOUDFLARE_CONTRACT_STATUS = 'accepté en ligne (décision du fondateur du 23/11/2026)';
export const CONTRACT_STATUSES = Object.freeze(['accepté', CLOUDFLARE_CONTRACT_STATUS, 'examiné', 'approuvé en principe par le fondateur', 'non vérifié', 'sans objet']);
const CONTRACT_STATUS_BY_NAME = Object.freeze({
    'Vercel': 'examiné', 'Vercel Analytics + Speed Insights': 'sans objet', 'Neon': 'examiné', 'Upstash': 'examiné', 'Scaleway SAS': 'accepté',
    'Cloudflare (R2)': CLOUDFLARE_CONTRACT_STATUS, 'Stockage objet S3/R2 (fournisseur à confirmer)': 'sans objet', 'Sentry (Functional Software Inc.)': 'non vérifié',
    'Microsoft (Outlook, boîte contact@accesdirectaide.fr)': 'non vérifié', 'Autres expéditeurs codés (Microsoft Graph sendMail, Resend)': 'sans objet',
    'Mailjet (Sinch)': 'examiné', 'Cloudflare, Inc. (Workers AI)': CLOUDFLARE_CONTRACT_STATUS, 'Scalingo SAS (HDS)': 'accepté', 'Scaleway SAS (OpenFisca)': 'accepté',
    'Twilio': 'sans objet', 'Microsoft (Outlook / Graph)': 'non vérifié', '8x8, Inc. (Jitsi as a Service)': 'approuvé en principe par le fondateur',
});
/** @param {Array<Record<string, any>>} list */
function withContractStatus(list) {
    return list.map((x) => {
        const statut_contrat = CONTRACT_STATUS_BY_NAME[x.nom];
        if (!CONTRACT_STATUSES.includes(statut_contrat)) throw new Error(`statut du contrat manquant pour ${x.nom}`);
        return { ...x, statut_contrat };
    });
}

export const SOURCE_FILES = Object.freeze({
    retention: 'api/_handlers/cron/gdpr-purge.js',
    registry: 'api/_services/privacy.js',
    legalEntity: 'src/config/legal-entity.ts',
    tombstones: 'api/_services/erasure-tombstones.js',
    tombstoneCopy: 'api/_services/erasure-tombstone-copy.js',
    retentionPolicy: 'api/_services/retention-policy.js',
});

// ─── Lecture statique des sources ─────────────────────

function extractObjectLiteral(source, declaration, file) {
    const start = source.indexOf(declaration);
    if (start === -1) throw new Error(`${declaration} introuvable dans ${file}`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`Objet ${declaration} non terminé dans ${file}`);
}

/** Retire les commentaires de fin de ligne (`// …`) sans toucher aux chaînes entre apostrophes. */
function stripLineComments(text) {
    return text
        .split('\n')
        .map((line) => {
            let inString = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '\\') { i++; continue; }
                if (ch === "'") inString = !inString;
                else if (!inString && ch === '/' && line[i + 1] === '/') return line.slice(0, i);
            }
            return line;
        })
        .join('\n');
}

export function parseRetention(source, file = SOURCE_FILES.retention) {
    const body = stripLineComments(extractObjectLiteral(source, 'export const RETENTION =', file));
    const out = {};
    for (const m of body.matchAll(/([A-Z0-9_]+)\s*:\s*(\d+)\s*,?/g)) out[m[1]] = Number(m[2]);
    if (Object.keys(out).length === 0) throw new Error(`RETENTION vide dans ${file}`);
    return out;
}

export function parseRetentionPolicyRegistry(source, file = SOURCE_FILES.registry) {
    const body = stripLineComments(extractObjectLiteral(source, 'export const RETENTION_POLICY_REGISTRY =', file));
    const out = {};
    for (const m of body.matchAll(/([A-Z0-9_]+)\s*:\s*\{([^}]*)\}/g)) {
        const fields = m[2];
        const duration = /durationDays\s*:\s*(\d+|null)/.exec(fields);
        const action = /action\s*:\s*'([^']*)'/.exec(fields);
        const impl = /implementedBy\s*:\s*(null|'([^']*)')/.exec(fields);
        out[m[1]] = {
            durationDays: duration && duration[1] !== 'null' ? Number(duration[1]) : null,
            action: action ? action[1] : null,
            implementedBy: impl && impl[1] !== 'null' ? impl[2] : null,
        };
    }
    if (Object.keys(out).length === 0) throw new Error(`RETENTION_POLICY_REGISTRY vide dans ${file}`);
    return out;
}

export function parseLegalEntity(source, file = SOURCE_FILES.legalEntity) {
    const body = extractObjectLiteral(source, 'export const CURRENT_LEGAL_ENTITY', file);
    const read = (key) => {
        const m = new RegExp(`${key}\\s*:\\s*(null|'([^']*)')`).exec(body);
        if (!m) throw new Error(`${key} introuvable dans ${file}`);
        return m[1] === 'null' ? null : m[2];
    };
    return { status: read('status'), operatorKind: read('operatorKind'), operatorRole: read('operatorRole'), plannedLegalForm: read('plannedLegalForm'),
        legalName: read('legalName'), tradeName: read('tradeName'), siren: read('siren'), registeredOffice: read('registeredOffice'), dpoContact: read('dpoContact') };
}

/** FA-D5: the backup and erasure-trace durations, read from the code (never typed into the register) */
export function parseBackupDurations({ tombstones, tombstoneCopy, retentionPolicy }) {
    const ttl = /export const TOMBSTONE_TTL_SECONDS\s*=\s*(\d+)\s*\*\s*86400\s*;/.exec(tombstones);
    const copy = /export const COPY_RETENTION_DAYS\s*=\s*(\d+)\s*;/.exec(tombstoneCopy);
    const backup = /BACKUP_KEEP_DAYS\s*:\s*\{\s*days\s*:\s*(\d+)/.exec(retentionPolicy);
    if (!ttl || !copy || !backup) throw new Error('durées des sauvegardes / traces d\'effacement introuvables dans le code');
    return { tombstoneDays: Number(ttl[1]), copyDays: Number(copy[1]), backupDays: Number(backup[1]) };
}

export function readCodeSources(rootDir = ROOT_DIR) {
    const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');
    return {
        retention: parseRetention(read(SOURCE_FILES.retention)),
        registry: parseRetentionPolicyRegistry(read(SOURCE_FILES.registry)),
        legalEntity: parseLegalEntity(read(SOURCE_FILES.legalEntity)),
        backups: parseBackupDurations({ tombstones: read(SOURCE_FILES.tombstones), tombstoneCopy: read(SOURCE_FILES.tombstoneCopy), retentionPolicy: read(SOURCE_FILES.retentionPolicy) }),
    };
}

// ─── Construction du registre (fonction pure) ─────────

/**
 * @param {{ retention: Record<string, number>, registry: Record<string, {durationDays: number|null, action: string|null, implementedBy: string|null}>, legalEntity: Record<string, string|null> }} sources
 */
export function buildRegistre({ retention, registry, legalEntity, backups }) {
    if (!backups) throw new Error('durées des sauvegardes absentes (readCodeSources)');
    const days = (key) => {
        const v = retention[key];
        if (!Number.isInteger(v)) throw new Error(`RETENTION.${key} absent du code`);
        return v;
    };
    const policy = (key) => {
        const r = registry[key];
        if (!r) throw new Error(`RETENTION_POLICY_REGISTRY.${key} absent du code`);
        return r;
    };

    // Durée appliquée par le cron gdpr-purge (hebdomadaire, dimanche 03:00 UTC).
    const cron = (donnee, key, regle) => ({
        donnee,
        duree_jours: days(key),
        source: `RETENTION.${key}`,
        statut: 'appliqué',
        description: `${regle.replace('{j}', String(days(key)))} (cron gdpr-purge, hebdomadaire)`,
    });
    // Règle déclarée dans le registre interne ; appliquée seulement si un job la met en œuvre.
    const policyRule = (donnee, key, regle) => {
        const r = policy(key);
        const applied = r.implementedBy !== null;
        return {
            donnee,
            duree_jours: r.durationDays,
            source: `RETENTION_POLICY_REGISTRY.${key}`,
            statut: applied ? 'appliqué' : 'non appliqué',
            mis_en_oeuvre_par: r.implementedBy,
            description: applied
                ? `${regle.replace('{j}', String(r.durationDays))} (${r.implementedBy})`
                : `non appliqué — règle prévue : ${regle.replace('{j}', String(r.durationDays))} ; aucun job ne l'applique (implementedBy: null)`,
        };
    };
    const texte = (donnee, statut, description) => ({ donnee, duree_jours: null, source: null, statut, description });

    const sharedDiag = policy('SHARED_DIAGNOSTIC');
    const sharedDays = days('ENTITY_VERSION_DAYS'); // le cron purge SharedDiagnostic avec ENTITY_VERSION_DAYS
    const sharedRule = {
        donnee: 'Dossier partagé (SharedDiagnostic, dont la copie du questionnaire dans situation) et, en cascade, autorisations, invitations, messages, suivi et orientations',
        duree_jours: sharedDays,
        source: 'RETENTION.ENTITY_VERSION_DAYS',
        source_registre: 'RETENTION_POLICY_REGISTRY.SHARED_DIAGNOSTIC',
        duree_jours_registre: sharedDiag.durationDays,
        statut: 'appliqué',
        description: `à l'expiration du lien (expiresAt) ou au plus tard ${sharedDays} jours après la création, sauf conservation légale (LegalHold) active (cron gdpr-purge)`,
    };

    // R42-LEGAL: Vercel, Neon and Upstash are in service for the restricted public beta (public consultation only; /mentions-legales lists them)
    const vercel = 'Vercel (hébergement ; en service pour la bêta publique restreinte)';
    const neon = 'Neon (PostgreSQL ; en service pour la bêta publique restreinte)';

    return {
        _avertissement: 'Fichier GÉNÉRÉ par scripts/gdpr-suite.mjs — ne pas modifier à la main. Vue synthétique, PROJET non validé par un juriste. Référence : LEGAL_FR/06_REGISTRE_TRAITEMENTS.md.',
        version: REGISTRE_VERSION,
        date_mise_a_jour: REGISTRE_DATE_REVISION,
        statut_document: 'PROJET — RELECTURE JURIDIQUE REQUISE',
        sources_code: { ...SOURCE_FILES },
        organisme: {
            nom_usage: legalEntity.tradeName,
            statut: legalEntity.status,
            // R42-A01 (owner addendum, 04/11/2026): no association has been created; the project carrier, a natural person, edits the service
            exploitant: legalEntity.operatorKind,
            role_exploitant: legalEntity.operatorRole,
            forme_juridique_envisagee: legalEntity.plannedLegalForm,
            raison_sociale: legalEntity.legalName,
            siren: legalEntity.siren,
            adresse: legalEntity.registeredOffice,
            responsable_traitement: 'Personne physique porteuse du projet (identité publiée sur /mentions-legales par la variable VITE_LEGAL_PUBLISHER_IDENTITY) — qualification à confirmer par le responsable de traitement ; l\'association envisagée n\'est pas créée et n\'est pas présentée comme responsable',
        },
        dpo: null,
        dpo_statut: 'non désigné',
        contact_protection_donnees: CONTACT_PROTECTION_DONNEES,
        traitements: [
            {
                id: 'T01',
                nom: 'Comptes citoyens (création, connexion, profil, foyer, préférences, délégations)',
                finalite: 'Créer et gérer un compte, garder préférences et parcours, déléguer une consultation en lecture seule',
                base_legale_proposee: 'Exécution des conditions d\'utilisation (art. 6.1.b) ; options désactivées par défaut : consentement (art. 6.1.a) — à valider',
                categories_donnees: ['E-mail', 'Empreinte du mot de passe (scrypt)', 'Téléphone (facultatif)', 'Profil (tranche d\'âge, département, préférences d\'accessibilité — art. 9 possible)', 'Foyer', 'Parcours, favoris, historique', 'Délégations'],
                categories_personnes: ['Citoyens usagers', 'Délégataires invités', 'Membres du foyer décrits'],
                destinataires: ['La personne', 'Ses délégataires (lecture seule)', 'Administrateurs AccesDirectAide pour la seule récupération de compte'],
                sous_traitants: [vercel, neon, 'Upstash (limitation de débit, prévu)', 'Sentry (R5-S1 : erreurs, stockage UE Francfort, sans Session Replay ; actif si SENTRY_DSN en Production)'],
                conservation: [
                    policyRule('Compte citoyen inactif', 'INACTIVE_ACCOUNT', 'suppression ou anonymisation après {j} jours d\'inactivité'),
                    texte('Jetons AuthToken', 'appliqué', 'supprimés à expiration (cron gdpr-purge)'),
                    texte('Compte (sur demande)', 'appliqué', 'effacement sur demande approuvée après revue humaine'),
                ],
                mesures_securite: 'Cookie HttpOnly SameSite=Strict, anti-CSRF double cookie, limitation de débit, verrouillage après échecs, mots de passe hachés (scrypt), jetons stockés en empreinte SHA-256',
            },
            {
                id: 'T02',
                nom: 'Questionnaire / diagnostic et simulation des droits',
                finalite: 'Estimer de façon indicative les aides possibles',
                base_legale_proposee: 'Intérêt légitime de l\'exploitant à informer le public (art. 6.1.f) — notice v12 / v13, P18, décidé par le responsable le 23/11/2026',
                point_ouvert: 'Art. 9.2.a si des réponses révèlent santé ou handicap : non tranché par la décision du 23/11/2026 (le calcul n\'enregistre rien)',
                categories_donnees: ['Revenus', 'Loyer', 'Composition du foyer', 'Situation professionnelle et familiale', 'Réponses pouvant révéler santé ou handicap (art. 9 possible)'],
                categories_personnes: ['Citoyens (avec ou sans compte)', 'Membres du foyer décrits'],
                destinataires: ['La personne', 'Les structures qu\'elle choisit, uniquement après partage (T03)'],
                lieux_traitement: [
                    'Calcul : réponses envoyées à /api/diagnostic, non stockées par /api/diagnostic',
                    'Appareil : localStorage ada_diagnostic_state (lisible 24 heures, effacé à la visite suivante ou par « Réinitialiser tout »)',
                    'Partage : copie conservée chiffrée au repos (enveloppe, clé détenue par le serveur) dans SharedDiagnostic.situation quand la personne partage son dossier',
                ],
                sous_traitants: [vercel, 'Neon pour la copie partagée (prévu)', 'Scaleway SAS (hébergement de notre propre moteur OpenFisca, Paris fr-par ; branche g14-of fusionnée dans la version a628f7b) — les réponses n\'y sont pas enregistrées'],
                base_legale_g14: 'Notice v12 / v13, P18 : intérêt légitime de l\'exploitant à informer le public (art. 6.1.f) — décidé par le responsable le 23/11/2026',
                services_refuses: ['OpenFisca (API publique) : refusé en production, prototype de développement uniquement'],
                conservation: [
                    texte('Calcul /api/diagnostic', 'appliqué', 'aucune conservation serveur pour le calcul seul'),
                    texte('Réponses sur l\'appareil', 'appliqué', '24 heures, puis effacées à la visite suivante ; « Réinitialiser tout » les efface tout de suite'),
                    sharedRule,
                ],
                mesures_securite: 'Pas de conservation serveur hors partage ; la copie partagée (situation) est chiffrée au repos par enveloppe (le serveur détient les clés : pas de chiffrement de bout en bout)',
            },
            {
                id: 'T03',
                nom: 'Partage de dossier avec des structures',
                finalite: 'À l\'initiative de la personne, permettre à une structure vérifiée de consulter son dossier',
                statut_r4: "G14-R4 (24/11/2026, LAB) : portage chez l'hébergeur HDS (Scalingo, osc-fr1) prêt — chiffrement de bout en bout (clé du dossier, clés des structures), consentement explicite par structure (texte à approuver, HDS_SHARE_CONSENT_VERSION), date de fin, retrait = re-chiffrement, journal sans contenu ; capacité citizen.shared_dossier fermée ; notice v15 / cgu v14 proposées",
                base_legale_proposee: 'Consentement spécifique par structure et par finalité (art. 6.1.a), révocable ; art. 9.2.a si données de santé — à valider',
                categories_donnees: ['Copie du questionnaire (situation, chiffrée au repos) et résultats (non chiffrés)', 'Documents joints (chiffrés)', 'Autorisations, invitations, nombre de consultations'],
                categories_personnes: ['Citoyens', 'Professionnels des structures'],
                destinataires: ['Structures choisies par la personne (membres actifs)'],
                sous_traitants: [vercel, neon, 'Stockage objet S3/R2 (fournisseur à confirmer, prévu)'],
                conservation: [sharedRule],
                mesures_securite: 'Invitation liée à une structure, à usage unique, stockée en empreinte ; révocation ; aucun accès administrateur au contenu ; chiffrement par enveloppe des fichiers',
            },
            {
                id: 'T04',
                nom: 'Messagerie et pièces jointes',
                finalite: 'Échanges entre la personne et une structure (dossier partagé ou rendez-vous)',
                statut_r4: "G14-R4 : pièces jointes chiffrées de bout en bout chez l'hébergeur HDS (messaging.attachments fermée ; Vercel refuse les octets en production)",
                base_legale_proposee: 'Service demandé (art. 6.1.b) ; art. 9.2.a si données de santé confiées — à valider',
                categories_donnees: ['Messages du dossier (chiffrés par enveloppe)', 'Messages de rendez-vous (chiffrés à l\'enregistrement, clé serveur)', 'Pièces jointes (chiffrées)'],
                categories_personnes: ['Citoyens', 'Professionnels'],
                destinataires: ['La personne et les membres actifs de la structure concernée'],
                sous_traitants: [vercel, neon, 'Stockage objet S3/R2 (prévu)'],
                // R3 (24/11/2026, approved by the owner with notice v14): capability messaging.conversations (outside the HDS unless the structure is NOT_ESSMS and the
                // service reviewed « ordinary »), messaging.attachments (HDS in every case), purge step E9 rdvConversationsDeleted, in-thread « Signaler »
                statut_r3: 'messagerie de rendez-vous : capacité messaging.conversations fermée par défaut ; ouverture décidée par le responsable le 24/11/2026 (release 3) pour les structures non ESSMS (sans FINESS, vérifiées) et les services relus « ordinaires » ; pièces jointes (messaging.attachments) fermées tant qu\'aucun hébergement HDS n\'est attesté — notice v14, ligne AIPD R6 signée par le responsable le 24/11/2026',
                base_legale_r3: 'Messagerie de rendez-vous : exécution des conditions d\'utilisation (art. 6.1.b) — notice v14, P29, décidé par le responsable le 24/11/2026',
                conservation: [
                    { ...sharedRule, donnee: 'Messages du dossier partagé (cascade avec le dossier)' },
                    texte('Messagerie de rendez-vous', 'non appliqué', '730 jours après le dernier message, ou avec l\'anonymisation du rendez-vous — durée décidée par le responsable le 24/11/2026 (RDV_CONVERSATION_DAYS, étape E9 rdvConversationsDeleted — exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée) ; avec le compte'),
                    texte('Signalement d\'un message (« Signaler » dans la conversation)', 'non appliqué', 'une ligne ContentReport sans le texte du message ; 365 jours après son traitement — durée décidée par le responsable le 24/11/2026 (CONTENT_REPORT_CLOSED_DAYS ; étape contentReportsClosedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                ],
                destinataires_r3: ['La personne', 'Les membres actifs de la structure du rendez-vous (comptes ADA Pro)', 'L\'exploitant pour un signalement : catégorie et références seulement, jamais le texte'],
                mesures_securite: 'Chiffrement à l\'enregistrement avec une clé du serveur (le serveur peut déchiffrer : pas de chiffrement de bout en bout), contrôle d\'accès par structure et par rendez-vous, 2 000 caractères, HTML retiré, limitation de débit, aucun contenu dans les e-mails d\'avis, consigne « pas d\'information de santé » sous le champ, pas de pièce jointe sans HDS, pas d\'antivirus',
            },
            {
                id: 'T05',
                nom: 'Coffre (documents personnels)',
                finalite: 'Conserver et retrouver ses justificatifs',
                statut_r4: "G14-R4 : code de secours à usage unique créé dans le navigateur (jamais envoyé), changement de phrase secrète ; l'hébergeur garde une empreinte à sens unique (authHash)",
                base_legale_proposee: 'Art. 6.1.b ; art. 9.2.a pour les documents médicaux déposés volontairement — à valider',
                categories_donnees: ['Fichiers (art. 9 possible)', 'Nom de fichier chiffré', 'Catégorie, type, taille, empreinte'],
                categories_personnes: ['Citoyens', 'Tiers figurant sur les documents'],
                destinataires: ['La personne ; une structure seulement si le document est joint à un dossier partagé'],
                sous_traitants: ['Stockage objet S3/R2 (prévu)', neon, vercel],
                // G14-R3F (24/11/2026, approved by the owner on 24/11/2026): Mon Coffre moves to a separate service at Scalingo (osc-fr1, HDS option), end-to-end encrypted in the browser;
                // AIPD line R9 = CONTROL/master/completion/R3_HDS_AIPD_CONSENTEMENT_PROJET_FR.md § 1 (signed by the owner 24/11/2026); notice v14 P28 (approved)
                evolution_r3: 'Service HDS distinct (branche g14-r3f) : Scalingo SAS, région osc-fr1 (France), option HDS, certificat HDS n° 38436 (valable jusqu\'au 11/09/2028) ; documents et métadonnées chiffrés de bout en bout dans le navigateur (AES-256-GCM, clé dérivée d\'une phrase secrète par PBKDF2-SHA256, jamais transmise) puis chiffrés une seconde fois côté serveur ; tickets d\'accès signés à usage unique (60 s) ; aucune donnée de ce traitement chez Vercel, Neon, Upstash ou Sentry. Documents de santé : consentement explicite (art. 9.2.a), case jamais pré-cochée, retirable. Annexe HDS v2.5.0 acceptée en ligne le 22/11/2026 et service HDS déployé le 24/11/2026 ; fermé tant que HDS_PRODUCTION_APPROVED est absent (ligne AIPD R9 signée par le responsable le 24/11/2026)',
                base_legale_r3: 'Art. 6.1.b ; documents de santé : consentement explicite art. 9.2.a, case jamais pré-cochée — notice v14, P28, décidé par le responsable le 24/11/2026',
                conservation: [
                    texte('Documents du coffre', 'appliqué', 'jusqu\'à suppression par la personne ou effacement du compte ; expiresAt non purgé par le cron (non appliqué)'),
                    texte('Mon Coffre au service HDS (release 3)', NON_VERIFIE, 'jusqu\'à suppression par la personne ou du compte (effacement HDS en premier) ; sauvegardes : durée de rotation de Scalingo, à confirmer par écrit, puis liste anti-résurrection'),
                ],
                mesures_securite: 'Chiffrement par enveloppe du contenu et du nom ; pas d\'antivirus (NOT_SCANNED) ; release 3 : chiffrement de bout en bout dans le navigateur, phrase secrète perdue = documents perdus (dit à l\'écran)',
            },
            {
                id: 'T06',
                nom: 'Rendez-vous',
                statut: 'fermé en Production (bêta publique restreinte) ; R42 (DEC-R42-01) : un compte est exigé pour tout rendez-vous — la réservation publique sans compte est retirée (refusée par le serveur)',
                finalite: 'Demande, prise, modification, annulation de rendez-vous avec une structure, par une personne connectée à son compte (personnes majeures seulement, R42-A07) ou par la structure elle-même ; confirmation directe ou après accord de la structure (R42-A03) ; choix facultatif d\'un professionnel (R42-A04) ; motif court facultatif (R42-A06)',
                base_legale_proposee: 'À VALIDER PAR LE RESPONSABLE DE TRAITEMENT — options : CONTROL/r42/R42_BASES_ET_DUREES_OPTIONS_FR.md ; le rappel facultatif (s\'il est conservé) est une finalité distincte, jamais confondue avec la base du rendez-vous',
                categories_donnees: ['Nom', 'Téléphone', 'E-mail', 'Notes et motif facultatif (texte libre : art. 9 possible, saisi volontairement)', 'Créneau, mode, professionnel choisi', 'Ancien flux sans compte (retiré) : date de l\'accord au rappel'],
                categories_personnes: ['Citoyens majeurs titulaires d\'un compte', 'Bénéficiaires inscrits par une structure', 'Professionnels', 'Ancien flux sans compte (R38–R41, retiré en R42 ; colonnes conservées, migrations 0043/0044 non appliquées en Production)'],
                destinataires: ['La structure et la personne'],
                sous_traitants: [vercel, neon],
                conservation: [
                    cron('Rendez-vous (nom, téléphone, e-mail, notes ; sans compte : e-mail et téléphone chiffrés, empreintes du code et du lien de gestion)', 'APPOINTMENT_ANON_DAYS', 'anonymisation après {j} jours'),
                    cron('Ancienne demande sans compte jamais confirmée (R38, flux retiré en R42 — reste purgée là où elle existerait)', 'GUEST_HOLD_DAYS', 'identité effacée {j} jour après l\'expiration de la réservation de 20 minutes'),
                    cron('Leurre de réservation sans compte (R41-B : ligne ProAppointment dans PostgreSQL, sans aucune donnée personnelle, jamais confirmable ; plus aucun stockage KV — flux retiré en R42)', 'GUEST_HOLD_DAYS', 'ligne supprimée {j} jour après son expiration, en même temps que les demandes réelles'),
                    cron('Accord au rappel facultatif la veille (ancien flux sans compte, R39 — proposition, à valider par le responsable de traitement)', 'APPOINTMENT_ANON_DAYS', 'effacé par le serveur dès que la personne retire son accord ; sinon, effacé avec les données du rendez-vous après {j} jours'),
                ],
                mesures_securite: 'Contrôle d\'accès par structure, limitation de débit, journal pro (ProAuditLog) ; nom et notes d\'un rendez-vous créé par une structure chiffrés à l\'enregistrement ; le téléphone reste en clair (il sert à reconnaître les réponses « STOP » aux SMS, désactivés)',
            },
            {
                id: 'T07',
                nom: 'Suivi des personnes par les structures et orientations',
                finalite: 'Suivi du dossier partagé par une structure et orientation vers une autre structure avec l\'accord de la personne',
                base_legale_proposee: 'À déterminer selon la qualification des structures (responsables de traitement probables ; AccesDirectAide sous-traitant) — à valider',
                categories_donnees: ['ProCase', 'ProCaseNote (chiffrées, art. 9 très probable)', 'ProCaseEvent', 'Referral (messages chiffrés)'],
                categories_personnes: ['Citoyens suivis', 'Professionnels', 'Tiers cités'],
                destinataires: ['Membres actifs de la structure ; structure destinataire d\'une orientation sur autorisation de la personne'],
                sous_traitants: [vercel, neon],
                conservation: [{ ...sharedRule, donnee: 'Suivi et orientations (cascade avec le dossier partagé)' }],
                mesures_securite: 'Notes et messages chiffrés par enveloppe ; historique en ajout seul ; contrôle par structure',
            },
            {
                id: 'T08',
                nom: 'Assistant IA local (citoyens)',
                finalite: 'Répondre aux questions générales sur les aides à partir des fiches vérifiées, avec citations',
                base_legale_proposee: 'Intérêt légitime de l\'exploitant à informer le public (art. 6.1.f), avec opposition possible — notice v12 / v13, P19, décidé par le responsable le 23/11/2026',
                categories_donnees: ['Message', 'Intention détectée', 'Mode de recherche', 'Identifiant de session', 'Note et commentaire facultatifs', 'Métriques techniques'],
                categories_personnes: ['Utilisateurs de l\'assistant'],
                destinataires: ['Aucun tiers — modèle local'],
                modele_ia: 'Ollama local (qwen3:8b, nomic-embed-text), joint uniquement en boucle locale (127.0.0.1)',
                // G14-AI (branch g14-ai 31eb23f2, merged into release a628f7b): the citizen assistant moves to Cloudflare Workers AI (notice v12 / v13 P19)
                evolution_g14: 'Branche g14-ai (fusionnée dans la version a628f7b) : Cloudflare, Inc. — Workers AI (États-Unis), sous-traitant (art. 28) ; question (adresses et téléphones masqués ; NIR, IBAN, carte refusés) et extraits de fiches publiques vérifiées envoyés depuis le serveur, sans compte ni adresse IP ; aucune conversation enregistrée, compteurs techniques anonymes 90 jours ; DPA Cloudflare v6.4 (3 avril 2026) : CCT 2021/914 module 2 et cadre UE–États-Unis ; pas d\'entraînement ni de conservation pour une inférence ordinaire (page Workers AI du 16/10/2026) ; base : intérêt légitime (art. 6.1.f) — décidé par le responsable le 23/11/2026',
                sous_traitants: [vercel, neon],
                fournisseurs_bloques: ['Google Gemini : BLOQUÉ par la politique IA du code (api/lib/ai-policy.js, BLOCKED_PENDING_PROVIDER_REVIEW) — pas un destinataire'],
                conservation: [
                    cron('Journaux de conversation (ConversationLog)', 'CONVERSATION_LOG_DAYS', 'suppression après {j} jours'),
                    cron('Métriques IA (AiMetric)', 'AI_METRIC_DAYS', 'suppression après {j} jours'),
                ],
                mesures_securite: 'Blocage NIR/IBAN/carte, tentatives d\'injection et demandes de conseil juridique ; abstention sans fiche vérifiée ; filtre de sortie ; limitation de débit',
            },
            {
                id: 'T09',
                nom: 'FALC et contenus publics',
                finalite: 'Produire des versions faciles à lire, toujours relues par une personne nommée',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) pour les données des relecteurs — à valider',
                categories_donnees: ['Texte proposé', 'Relecteur', 'Décision'],
                categories_personnes: ['Administrateurs / relecteurs'],
                destinataires: ['Public après validation'],
                sous_traitants: [vercel, neon],
                conservation: [
                    cron('Versions de contenus (EntityVersion)', 'ENTITY_VERSION_DAYS', 'suppression après {j} jours'),
                    texte('AiOutputReview', 'non appliqué', 'aucune purge'),
                ],
                mesures_securite: 'Publication impossible sans relecture humaine nominative',
            },
            {
                id: 'T10',
                nom: 'Support (demandes d\'aide)',
                finalite: 'Répondre aux demandes d\'aide et aux signalements',
                base_legale_proposee: 'Art. 6.1.f ou 6.1.b — à valider',
                categories_donnees: ['Catégorie', 'Message (chiffré, art. 9 possible)', 'Contact (chiffré)', 'Statut'],
                categories_personnes: ['Usagers', 'Visiteurs', 'Professionnels'],
                destinataires: ['Administrateurs AccesDirectAide'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('SupportRequest', 'non appliqué', 'aucune purge'),
                    texte('Signalements de contenu (ContentReport : « Signaler une erreur », « Signaler » un message)', 'non appliqué', '365 jours après leur traitement (FIXED ou REJECTED) — durée décidée par le responsable le 24/11/2026 (CONTENT_REPORT_CLOSED_DAYS ; étape contentReportsClosedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                ],
                mesures_securite: 'Chiffrement par enveloppe ; interrupteur de fermeture',
            },
            {
                id: 'T11',
                nom: 'Statistiques institutionnelles',
                finalite: 'Statistiques territoriales agrégées pour les partenaires institutionnels',
                base_legale_proposee: 'Art. 6.1.f (ou 6.1.e) — à valider',
                categories_donnees: ['Agrégats uniquement (communes ≥ 3 structures vérifiées, cellules < 5 masquées)'],
                categories_personnes: ['Indirectement : usagers et professionnels'],
                destinataires: ['Comptes institutionnels actifs sous convention signée (aucune aujourd\'hui)'],
                sous_traitants: [vercel, neon],
                // R3 (24/11/2026, approved by the owner): institution users are informed by the notice v14 § 14; AIPD line R7 signed 24/11/2026
                statut_r3: 'portail institution (capacité institution.portal) fermé jusqu\'à une convention signée avec une institution nommée — notice v14 § 14 (base des utilisateurs : intérêt légitime, art. 6.1.f, décidé par le responsable le 24/11/2026), ligne AIPD R7 signée par le responsable le 24/11/2026 ; seuls les trimestres gelés sont lus (tâche observatory-freeze)',
                conservation: [texte('Agrégats', 'sans objet', 'les données sources suivent leur propre durée')],
                mesures_securite: 'Export territorial fermé tant que la licence n\'est pas décidée',
            },
            {
                id: 'T12',
                nom: 'Administration, sécurité et journalisation',
                finalite: 'Administrer, sécuriser les accès, tracer les actions, diagnostiquer les erreurs',
                base_legale_proposee: 'Intérêt légitime de sécurité (art. 6.1.f) ou obligation légale (art. 6.1.c) — à valider',
                categories_donnees: ['AdminUser', 'AuditLog (IP en clair et empreinte)', 'ProAuditLog', 'UpdateLog', 'Erreurs techniques Sentry du site et du serveur (description nettoyée, navigateur et système, chemin de page sans paramètres ; ni traces de performance ni Session Replay)'],
                categories_personnes: ['Administrateurs', 'Professionnels', 'Usagers', 'Visiteurs'],
                destinataires: ['Administrateurs AccesDirectAide', 'Sentry (sous-traitant, région UE, si DSN)'],
                sous_traitants: [vercel, neon, 'Sentry (R5-S1 : erreurs, stockage UE Francfort, sans Session Replay ; actif si SENTRY_DSN en Production)'],
                conservation: [
                    cron('Journal d\'audit (AuditLog)', 'AUDIT_LOG_DAYS', 'suppression après {j} jours'),
                    policyRule('Journal d\'audit (registre interne)', 'AUDIT_LOG', 'suppression après {j} jours'),
                    cron('Journal d\'audit pro (ProAuditLog)', 'PRO_AUDIT_LOG_DAYS', 'suppression après {j} jours'),
                    cron('Journaux de mise à jour (UpdateLog)', 'CONVERSATION_LOG_DAYS', 'suppression après {j} jours'),
                    texte('Sentry', NON_VERIFIE, '30 jours sur l\'offre gratuite « Developer » (grille tarifaire sentry.io lue le 24/11/2026) ; offre souscrite à confirmer par le responsable'),
                    texte('AdminUser', 'non appliqué', 'aucune purge'),
                ],
                mesures_securite: 'MFA TOTP pour toute écriture administrateur ; élévation limitée ; CSRF ; limitation de débit ; rotation des clés de données testée',
            },
            {
                id: 'T13',
                nom: 'Exercice des droits',
                finalite: 'Recevoir, instruire et tracer les demandes (accès, export, effacement, limitation, opposition) et les conservations légales',
                base_legale_proposee: 'Obligation légale (art. 6.1.c, art. 12 à 22 RGPD)',
                categories_donnees: ['DSRRequest', 'LegalHold', 'Entrées AuditLog (identifiant en empreinte SHA-256)'],
                categories_personnes: ['Demandeurs', 'Relecteurs'],
                destinataires: ['Administrateurs habilités'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('DSRRequest, LegalHold', 'non appliqué', 'conservés sans durée fixée'),
                    cron('Preuve des consentements (ConsentLog)', 'CONSENT_LOG_DAYS', 'suppression {j} jours après création'),
                    policyRule('Preuve des consentements (registre interne)', 'CONSENT_LOG', 'suppression {j} jours après création'),
                ],
                mesures_securite: 'Revue à deux personnes (proposition puis confirmation) ; levée d\'une conservation légale à deux personnes',
            },
            {
                id: 'T14',
                nom: 'Comptes professionnels',
                finalite: 'Gérer les comptes des professionnels et leurs droits dans leur structure',
                base_legale_proposee: 'Art. 6.1.b ou 6.1.f — à valider',
                categories_donnees: ['E-mail', 'Empreinte du mot de passe', 'Rôle, statut, structure', 'MFA', 'Invitations d\'équipe'],
                categories_personnes: ['Professionnels', 'Personnes invitées'],
                destinataires: ['Administrateurs de la structure', 'Administrateurs AccesDirectAide'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('ProUser', 'non appliqué', 'inactif au départ, jamais supprimé'),
                    cron('Invitations d\'équipe', 'INVITATION_GRACE_DAYS', 'suppression {j} jours après expiration'),
                    cron('Jetons Outlook (non activé)', 'OUTLOOK_TOKEN_GRACE_DAYS', 'suppression {j} jours après expiration'),
                ],
                mesures_securite: 'Membre inactif ou structure suspendue : réponse 404 ; MFA disponible',
            },
            {
                id: 'T15',
                nom: 'Partenaires institutionnels et demandes de partenariat',
                finalite: 'Gérer conventions et comptes partenaires ; traiter les demandes de partenariat',
                base_legale_proposee: 'Art. 6.1.b ou 6.1.f — à valider',
                categories_donnees: ['InstitutionAccount', 'PartnerAgreement', 'PartnershipRequest'],
                categories_personnes: ['Représentants des partenaires', 'Demandeurs'],
                destinataires: ['Administrateurs AccesDirectAide'],
                sous_traitants: [vercel, neon],
                base_legale_r3: 'Utilisateurs de l\'espace des institutions : intérêt légitime (art. 6.1.f) — notice v14 § 14, décidé par le responsable le 24/11/2026',
                categories_donnees_r3: ['Compte institution : e-mail, organisation, territoire, statut, convention, empreinte du mot de passe, échecs de connexion et verrouillage, lien de réinitialisation (empreinte), date de dernière connexion', 'Journal des connexions et des lectures de statistiques (AuditLog A18)'],
                conservation: [
                    texte('InstitutionAccount suspendu', 'non appliqué', 'RAPPORT seulement, 365 jours après la dernière connexion (aucune date de suspension enregistrée) — durée décidée par le responsable le 24/11/2026 (INSTITUTION_ACCOUNT_SUSPENDED_DAYS ; étape de rapport suspendedInstitutionAccountsReport) ; la suppression reste une décision de l\'administrateur avec l\'institution'),
                    texte('PartnerAgreement terminée', 'non appliqué', 'RAPPORT seulement, 5 ans après sa fin (preuve de ce qui a été convenu) — durée décidée par le responsable le 24/11/2026 (PARTNER_AGREEMENT_ENDED_DAYS ; étape de rapport endedPartnerAgreementsReport) ; jamais supprimée par la tâche (un compte la référence)'),
                    texte('PartnershipRequest', 'non appliqué', '365 jours après la réponse (statut autre que « pending ») — durée décidée par le responsable le 24/11/2026 (PARTNERSHIP_REQUEST_CLOSED_DAYS ; étape partnershipRequestsClosedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Journal des connexions et lectures (AuditLog)', 'appliqué', 'règle du journal d\'audit (T12)'),
                ],
                mesures_securite: 'Compte actif seulement sous convention signée (aucune aujourd\'hui)',
            },
            {
                id: 'T16',
                nom: 'Transmission au SIAO',
                statut: 'non activé (SIAO_ENABLED off, aucune convention, aucune habilitation)',
                finalite: 'Envisagée : transmettre une demande d\'hébergement au SIAO à la demande de la personne',
                base_legale_proposee: 'À déterminer',
                categories_donnees: [],
                categories_personnes: [],
                destinataires: [],
                sous_traitants: [],
                conservation: [texte('Aucun flux', 'sans objet', 'non activé')],
                mesures_securite: 'Sans objet',
            },
            {
                id: 'T17',
                nom: 'Mesure d\'audience et de performance',
                statut: 'désactivé par défaut (ADR-022) : chargé seulement si VITE_AUDIENCE_MEASUREMENT=on, jamais pendant la bêta publique ni en mode mock',
                finalite: 'Mesurer l\'audience (Vercel Analytics) et la performance (Vercel Speed Insights)',
                base_legale_proposee: 'Art. 6.1.f, exemption de consentement si les conditions CNIL sont réunies (non vérifié)',
                categories_donnees: ['Pages vues', 'Métriques de performance', 'Données techniques du navigateur'],
                categories_personnes: ['Visiteurs'],
                destinataires: ['Vercel (sous-traitant)'],
                sous_traitants: ['Vercel Analytics et Speed Insights'],
                conservation: [texte('Données d\'audience', NON_VERIFIE, 'durée réglée par Vercel, non vérifiée')],
                mesures_securite: NON_VERIFIE,
            },
            {
                // G14 consolidation (23/11/2026): branch g14-aid 81e00197 (merged into release a628f7b); notice v12 / v13 P21
                id: 'T23',
                nom: 'Mode accompagnant (aide dans le compte, à côté de la personne ou à distance)',
                statut: 'branche g14-aid fusionnée dans la version a628f7b',
                finalite: 'Permettre à une personne choisie (proche, travailleur social, conseiller France Services, professionnel) d\'aider la personne dans son propre compte, à côté d\'elle, 2 heures au plus ; à distance, une personne de confiance demande des actions que la personne confirme',
                base_legale_proposee: 'Consentement (art. 6.1.a), donné après saisie du mot de passe',
                categories_donnees: ['Nom et rôle de l\'aidant (et structure pour un professionnel)', 'Domaines autorisés et durée', 'Journal des consultations, actions et refus'],
                categories_personnes: ['Citoyens majeurs titulaires d\'un compte', 'Aidants'],
                destinataires: ['La personne (journal visible)', 'L\'aidant pendant la session, dans les domaines choisis'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Journal du mode accompagnant (AuditLog)', 'appliqué', '1 an (règle des journaux d\'administration et de sécurité)'),
                    texte('Accord (ConsentLog)', 'appliqué', 'règle des décisions de consentement'),
                ],
                mesures_securite: 'Jamais la sécurité du compte, la suppression, l\'export complet ni une nouvelle délégation ; Mon Coffre seulement si coché et jamais pour un professionnel ; session de 2 heures au plus vérifiée à chaque requête ; pas pour un compte sous mesure de protection',
            },
            {
                // G14 consolidation: branch g14-ps 6e37ee65 (merged into release a628f7b); notice v13 P23
                id: 'T24',
                nom: 'Orientations sociales entre structures (hors santé)',
                statut: 'branche g14-ps fusionnée dans la version a628f7b (capacité pro.referrals_social, migration 0061 à appliquer en Production)',
                finalite: 'Orientation d\'une personne d\'une structure vers une autre, hors santé, avec son accord donné par un code à usage unique',
                base_legale_proposee: 'Consentement (art. 6.1.a) ; responsabilité conjointe exploitant / structure (art. 26) selon les conditions des structures v9',
                categories_donnees: ['Structures d\'envoi et d\'accueil', 'Motifs (liste fermée)', 'État et dates', 'Adresse électronique ou téléphone, seulement si la personne le coche'],
                categories_personnes: ['Citoyens orientés', 'Professionnels'],
                destinataires: ['La structure d\'accueil (contact seulement pendant l\'orientation)', 'La structure d\'envoi (états et motifs, jamais le contact)'],
                sous_traitants: [vercel, neon],
                conservation: [texte('Orientation sociale et son historique', 'non appliqué', '12 mois après la clôture (décision du responsable du 23/11/2026)')],
                mesures_securite: 'Aucun texte libre ni document ; code à usage unique stocké en empreinte ; chaque transition journalisée',
            },
            {
                // G14 consolidation: branch g14-obs 2fcab762 (merged into release a628f7b); notice v12 / v13 P20
                id: 'T25',
                nom: 'Observatoire des droits et des services (signaux de demande anonymes)',
                statut: 'branche g14-obs fusionnée dans la version a628f7b (migration 0062 à appliquer en Production)',
                finalite: 'Compter, par jour, les recherches et consultations par codes de listes fermées pour publier des tableaux trimestriels',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) — notice v12 / v13, P20, décidé par le responsable le 23/11/2026',
                categories_donnees: ['Codes de listes fermées', 'Jour', 'Commune, sauf sujets sensibles'],
                categories_personnes: ['Visiteurs (aucune identification)'],
                destinataires: ['Public (tableaux trimestriels, valeurs inférieures à 5 masquées, Licence Ouverte 2.0)'],
                sous_traitants: [vercel, neon],
                conservation: [texte('Comptes du jour (DemandSignalDaily)', 'non appliqué', 'supprimés au gel trimestriel ; tableaux trimestriels anonymes conservés')],
                mesures_securite: 'Ni identité, ni adresse IP, ni heure, ni texte ; envoi depuis « Ma situation » seulement sur accord explicite',
            },
            {
                // G14 consolidation: branch g14-chan-a11y aea83e30 (merged into release a628f7b); notice v13 P10c
                id: 'T26',
                nom: 'Notifications du navigateur (Web Push) et fichiers de calendrier',
                statut: 'branche g14-chan-a11y fusionnée dans la version a628f7b',
                finalite: 'Rappeler un rendez-vous par une notification courte chiffrée, si la personne l\'active ; fichier .ics pour les services non sensibles',
                base_legale_proposee: 'Consentement (art. 6.1.a), retirable à tout moment',
                categories_donnees: ['Abonnement de notification du navigateur (adresse du service de notification et clés)', 'Contenu chiffré du rappel (ni nom, ni structure, ni santé)'],
                categories_personnes: ['Citoyens titulaires d\'un compte qui activent les notifications'],
                destinataires: ['Service de notification de l\'éditeur du navigateur (Apple, Google, Mozilla, Microsoft) — peut être hors UE ; ne lit pas le rappel chiffré'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Abonnement actif', 'appliqué', 'jusqu\'à la désactivation ou l\'effacement du compte'),
                    texte('Abonnement en échec', 'non appliqué', '30 jours après le dernier échec (retention-policy PUSH_FAILING_DAYS ; étape pushSubscriptionsFailingDeleted non approuvée)'),
                ],
                mesures_securite: 'Contenu chiffré pour le navigateur ; l\'e-mail reste l\'avis qui fait foi',
            },
            // G14-R3 (24/11/2026, release-3 package, APPROVED by the owner on 24/11/2026 — OWNER_VALIDATED): household (C03), guardian link (C05), trusted
            // persons (C23), events (X04). Notice v14-2026-11-24 P24 / P25 / P26 and v12 / v13 § 3 ter; durations of C23 / C05 decided (retention-policy.js R3_DECISION).
            {
                id: 'T29',
                nom: 'Mon foyer — membres du foyer décrits par la personne (C03)',
                statut: 'capacité citizen.household fermée ; ouverture décidée par le responsable le 24/11/2026 (release 3 ; ADA_BETA_ACCOUNTS_EXTRA=household + ADA_CAPABILITIES_OPEN)',
                finalite: 'Permettre à la personne de garder, dans son profil, la composition de son foyer pour elle-même',
                base_legale_proposee: 'Exécution des conditions d\'utilisation (art. 6.1.b) pour la personne ; intérêt légitime (art. 6.1.f) pour les membres décrits, sans compte (notice v14, P24) — décidé par le responsable le 24/11/2026',
                categories_donnees: ['Lien avec la personne (liste fermée)', 'Tranche d\'âge facultative (dont « moins de 18 ans » pour un enfant)', 'Nom court facultatif (30 caractères au plus)'],
                categories_personnes: ['Citoyens titulaires d\'un compte', 'Membres du foyer décrits (dont des enfants), sans compte'],
                destinataires: ['La personne seule (profil, export)'],
                sous_traitants: [vercel, neon],
                conservation: [texte('Membres du foyer (HouseholdMember)', 'appliqué', 'tant que la personne les garde ; suppression par la personne à tout moment ; effacés avec le compte (ON DELETE CASCADE)')],
                mesures_securite: '12 personnes au plus ; aucun texte libre au-delà de 30 caractères ; lu seulement quand la capacité est ouverte ; règle d\'âge du compte (ageGate) ; information des membres décrits : art. 14.5.b (données minimales, aucun contact) — retenue avec la décision du 24/11/2026 (ligne AIPD R1)',
            },
            {
                id: 'T30',
                nom: 'Lien entre le compte d\'une personne mineure et un représentant légal (C05) — forme restreinte',
                statut: 'capacité citizen.guardians fermée ; ouverture décidée par le responsable le 24/11/2026 (release 3) SANS création de lien : les comptes de mineurs restent fermés (citizen.minor_accounts non ouvrable) et la déclaration est refusée (MINOR_ACCOUNTS_CLOSED)',
                finalite: 'Permettre à chacune des deux personnes de voir et de retirer un lien existant ; vérification renforcée par une personne habilitée, seulement si une politique d\'âge validée la prévoit (aucune à ce jour)',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) — notice v14, P26, décidé par le responsable le 24/11/2026, forme restreinte seulement ; toute création de lien exigerait une décision distincte (politique d\'âge, art. 8 RGPD, art. 45 loi Informatique et Libertés)',
                categories_donnees: ['Identifiants des deux comptes', 'État du lien', 'Preuve de chaque étape (ConsentLog GUARDIAN_LINK)'],
                categories_personnes: ['Personnes mineures (comptes existants seulement)', 'Représentants légaux'],
                destinataires: ['Les deux personnes', 'Un administrateur nommé avec MFA pour la seule vérification renforcée (aucune méthode autorisée à ce jour)'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Lien retiré (GuardianRelationship REVOKED)', 'non appliqué', '30 jours après le retrait — durée décidée par le responsable le 24/11/2026 (GUARDIAN_LINK_REVOKED_DAYS ; étape guardianLinksRevokedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Preuves des étapes (ConsentLog)', 'appliqué', 'règle des décisions de consentement'),
                ],
                mesures_securite: 'Aucun nouveau lien tant que les comptes de mineurs sont fermés ; une confirmation par e-mail n\'est jamais une preuve ; sans politique d\'âge validée, aucun effet sur le compte',
            },
            {
                id: 'T31',
                nom: 'Personnes de confiance — délégation de consultation en lecture seule (C23)',
                statut: 'capacité citizen.delegations fermée ; ouverture décidée par le responsable le 24/11/2026 (release 3 ; ADA_BETA_ACCOUNTS_EXTRA=delegations + ADA_CAPABILITIES_OPEN)',
                finalite: 'Permettre à la personne de laisser une personne qu\'elle choisit consulter, en lecture seule et pour une durée limitée, les parties ouvertes de son espace (à ce jour : rendez-vous à venir)',
                base_legale_proposee: 'Consentement de la personne (art. 6.1.a) ; intérêt légitime (art. 6.1.f) pour la personne invitée (notice v14, P25) — décidé par le responsable le 24/11/2026',
                categories_donnees: ['Adresse électronique invitée', 'Rôle indiqué', 'Parties ouvertes et durée', 'Dates', 'Journal des consultations (DelegationAccessEvent)', 'Rendez-vous à venir consultés (date, heure, structure, état)'],
                categories_personnes: ['Citoyens titulaires d\'un compte (personne)', 'Personnes de confiance invitées (avec ou sans compte au moment de l\'invitation)'],
                destinataires: ['La personne de confiance (lecture seule, parties choisies, adresse de la personne)', 'Mailjet (Sinch) pour l\'e-mail d\'invitation'],
                sous_traitants: [vercel, neon, 'Mailjet (Sinch) — e-mail d\'invitation'],
                conservation: [
                    texte('Invitation sans réponse', 'non appliqué', '30 jours après son expiration, avec l\'adresse invitée — durée décidée par le responsable le 24/11/2026 (DELEGATION_INVITATION_EXPIRED_DAYS ; étape delegationInvitationsExpiredDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Délégation terminée, refusée ou expirée et son journal', 'non appliqué', '365 jours après sa fin — durée décidée par le responsable le 24/11/2026 (DELEGATION_ENDED_DAYS ; étape delegationsEndedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Délégation en cours', 'appliqué', 'jusqu\'à son terme (30 à 365 jours) ou sa fin par l\'une des deux personnes ; effacée avec l\'un des deux comptes'),
                ],
                mesures_securite: 'Lecture seule, jamais la session de la personne ; acceptation seulement par le compte dont l\'adresse vérifiée est l\'adresse invitée ; jeton d\'invitation en empreinte SHA-256, 7 jours, usage unique ; chaque partie suit sa propre capacité (Mon Coffre fermé : HDS ; Mon Parcours : ADA_PARCOURS_DELEGATE_READ) ; rôles tuteur / curateur / représentant sans effet (PROOF_REQUIRED) ; consultation suspendue pendant une limitation (art. 18) ; 10 délégations en cours au plus',
            },
            {
                // G14-R3G (24/11/2026, release-3 package, APPROVED by the owner 24/11/2026): notice v14 P27, cgu v13 § 5; durations = retention-policy.js LEGAL_PROTECTION_* (decided)
                id: 'T33',
                nom: 'Représentant légal d\'un majeur protégé — tutelle, curatelle, habilitation familiale, mandat spécial (proche ou MJPM)',
                statut: 'capacité citizen.legal_protection fermée ; ouverture décidée par le responsable le 24/11/2026 (release 3, après application de la migration 0064 en Production ; ADA_BETA_ACCOUNTS_EXTRA=legal_protection + ADA_CAPABILITIES_OPEN) ; table de la migration 0064 (dans le journal, idx 64, depuis l\'intégration de la release 3)',
                finalite: 'Permettre à la personne désignée par le juge d\'exercer sa mission dans le service (consulter, demander ou faire une action dans les parties couvertes par la décision vérifiée), en informant la personne protégée de tout ce qui est fait ; vérification humaine de la décision',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) — notice v14, P27 ; l\'existence d\'une mesure est traitée comme une donnée concernant la santé (art. 9), condition art. 9.2.f (constatation, exercice ou défense d\'un droit en justice) — décidé par le responsable le 24/11/2026 (R3_KORUMA_TEMSIL_FR.md ; décision du responsable, pas un avis juridique)',
                categories_donnees: ['Identifiants des deux comptes', 'Qualité du représentant (proche / MJPM, forme d\'exercice L471-2, SIRET et structure facultatifs)', 'Faits tirés de la décision : mesure, représentation ou assistance, personne / biens, tribunal, date, date de fin', 'HMAC du numéro de dossier (facultatif, illisible)', 'État et enregistrement de la vérification (date, administrateur, méthode, note ≤ 500 caractères)', 'Journal des consultations, demandes et actions (AuditLog)', 'Rendez-vous à venir et étapes non sensibles de Mon Parcours consultés'],
                categories_personnes: ['Majeurs protégés titulaires d\'un compte', 'Représentants : proches, mandataires judiciaires à la protection des majeurs'],
                destinataires: ['La personne protégée (tout)', 'Le représentant (parties couvertes, après vérification, jusqu\'à la date de fin)', 'Un administrateur nommé avec MFA (vérification, signalements)'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Déclaration jamais vérifiée', 'non appliqué', '90 jours après la déclaration — durée décidée par le responsable le 24/11/2026 (LEGAL_PROTECTION_DECLARED_STALE_DAYS ; étape legalProtectionStaleDeclarationsDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Déclaration refusée', 'non appliqué', '90 jours après le refus — durée décidée par le responsable le 24/11/2026 (LEGAL_PROTECTION_REJECTED_DAYS ; étape legalProtectionRejectedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Lien terminé ou expiré', 'non appliqué', '365 jours après sa fin — durée décidée par le responsable le 24/11/2026 (LEGAL_PROTECTION_ENDED_DAYS ; étape legalProtectionEndedDeleted exécutable seulement après son approbation : essai à blanc lu, sauvegarde vérifiée)'),
                    texte('Journal (AuditLog)', 'appliqué', '365 jours (règle du journal)'),
                ],
                mesures_securite: 'La décision n\'est jamais reçue ni stockée (examen hors plateforme), aucune IA, aucun certificat médical ; aucun effet avant vérification ; pouvoirs bornés par mesure (ACT / CONFIRM), par parties (RDV, PARCOURS) et par la date de fin ; jamais Mon Coffre, la sécurité du compte, l\'export ou la suppression ; étapes sensibles masquées (G8) ; signalement de la personne = suspension immédiate ; limitation (art. 18) = tout suspendu ; mot de passe à la déclaration ; réponse neutre (pas d\'oracle d\'existence de compte)',
            },
            {
                // R3 / FA-D7 (24/11/2026, approved by the owner 24/11/2026): the partner referral bridge (branch g14-r3e) — closed (capability partner.referral_adapter, HDS, a named
                // partner with a signed convention and ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED); notice v14 § 5 (list of connected partners: none); AIPD line R8
                id: 'T34',
                nom: 'Pont d\'orientation vers l\'outil d\'un partenaire (FA-D7, ada.partner-referral/1)',
                statut: 'capacité partner.referral_adapter fermée (exige l\'hébergement HDS et pro.referrals) ; aucun partenaire connecté ; ouverture seulement après une convention signée avec un partenaire nommé et son membre délégué',
                finalite: 'Tenir informé l\'outil d\'une structure partenaire de l\'état d\'une orientation qu\'elle reçoit, et recevoir ses réponses, sans ressaisie',
                base_legale_proposee: 'Celle de l\'orientation (P8 : consentement à chaque partage, art. 6.1.a ; art. 9.2.a si nécessaire) — extension de la ligne P8 de l\'AIPD (R8, signée par le responsable le 24/11/2026) — décidé par le responsable le 24/11/2026',
                categories_donnees: ['Identifiant opaque de l\'orientation', 'État, code de motif, échéance', 'Horodatages et signatures (HMAC)', 'Aucune identité, aucun dossier, aucun document'],
                categories_personnes: ['Personnes orientées (indirectement, par un identifiant opaque)', 'Membre délégué du partenaire'],
                destinataires: ['Le partenaire connecté (liste publiée dans la notice ; aucun aujourd\'hui)', 'Administrateurs AccesDirectAide (journal sans contenu)'],
                sous_traitants: [vercel, neon],
                conservation: [texte('Événements du pont (journal)', 'appliqué', 'règle du journal d\'audit (T12) ; identifiants seulement'), texte('Orientation', 'appliqué', 'suit l\'orientation (T07)')],
                mesures_securite: 'Signature HMAC (fenêtre 300 s), rotation des clés, 16 Kio au plus, 120 appels par minute et par partenaire, idempotence, aucune donnée d\'identité ni de document, interrupteur de production distinct, contrôle de pré-déploiement partner.bridge',
            },
            {
                id: 'T32',
                nom: 'Académie et événements — inscription d\'une personne majeure (X04)',
                statut: 'capacité community.events fermée (surface « events ») ; textes approuvés le 23/11/2026 (notice v12 / v13 § 3 ter et § 4) ; ligne AIPD X04 (R4) signée par le responsable le 24/11/2026 ; ouverture décidée à la release 3',
                finalite: 'Inscrire une personne majeure à un événement publié, lui rappeler l\'événement dans Mon Espace, préparer la salle à partir de nombres',
                base_legale_proposee: 'Exécution des conditions d\'utilisation (art. 6.1.b) ; besoin d\'accessibilité : consentement explicite (art. 9.2.a) par une case distincte jamais cochée d\'avance — décidé le 22/11/2026 (formulaire G14)',
                categories_donnees: ['Compte, événement, état et dates de l\'inscription', 'Un besoin d\'accessibilité facultatif dans une liste fermée de 8 (art. 9 possible)', 'Preuve de l\'accord et de son retrait (ConsentLog EVENT_ACCESSIBILITY_NEED)'],
                categories_personnes: ['Citoyens majeurs titulaires d\'un compte'],
                destinataires: ['La personne', 'L\'organisateur : des nombres seulement (inscrits, places restantes, nombre de chaque besoin), jamais une identité'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Besoin d\'accessibilité', 'non appliqué', 'effacé à l\'annulation (appliqué) ; au plus tard 1 jour après la fin de l\'événement — durée décidée le 22/11/2026, étape eventNeedsClearedAfterEnd non approuvée (dry-run à lire)'),
                    texte('Inscription', 'non appliqué', '30 jours après la fin de l\'événement — décidée le 22/11/2026, étape eventRegistrationsDeleted non approuvée'),
                    texte('Page d\'un événement terminé', 'non appliqué', '365 jours — décidée le 22/11/2026, étape academyEventsEndedDeleted non approuvée'),
                ],
                mesures_securite: 'Compte majeur exigé (isAdultAccount) ; aucun texte libre ; le besoin n\'est gardé qu\'avec l\'accord vrai ; verrou de capacité ; rappel sans titre, lieu ni besoin ; administration éditoriale par un administrateur nommé avec MFA',
            },
            // G14-R4 (24/11/2026): the X02 / X01 / X05 opening package — closed capabilities, AIPD lines to sign (docs/rgpd-r4-aipd-lignes.md)
            {
                id: 'T35',
                nom: 'Témoignages (X02)',
                statut: 'capacité community.testimonials fermée (surface « testimonials ») ; textes approuvés le 23/11/2026 (notice v12 / v13 § 3 ter, § 4, § 13 ; cgu-citoyen v12 § 7 bis) ; ligne AIPD X02 non signée ; modérateur nommé requis (le responsable, seul) ; préparé à la Release 4',
                finalite: 'Publier, après relecture, le témoignage d\'une personne majeure ; traiter les signalements, décisions motivées et contestations (DSA)',
                base_legale_proposee: 'Consentement (art. 6.1.a) par texte, case jamais cochée d\'avance, retrait à tout moment ; signalements et modération : intérêt légitime (art. 6.1.f)',
                categories_donnees: ['Texte, prénom ou pseudonyme choisi, langue, état et dates', 'Preuve de l\'accord et de son retrait (ConsentLog TESTIMONIAL_PUBLICATION)', 'Signalements (motif d\'une liste fermée), décisions, contestations, mesures contre les abus'],
                categories_personnes: ['Citoyens majeurs titulaires d\'un compte', 'Personnes qui signalent (avec ou sans compte)'],
                destinataires: ['Public (texte publié et nom choisi)', 'Le modérateur nommé (jamais l\'adresse ni le compte de l\'auteur, ni l\'identité de qui signale)'],
                sous_traitants: [vercel, neon, 'Mailjet (e-mails de modération, lorsque la fonction est ouverte)'],
                conservation: [
                    texte('Texte non relu', 'non appliqué', 'retiré automatiquement après 60 jours — décidé le 22/11/2026, étape testimonialsPendingExpired non approuvée'),
                    texte('Ligne sans texte', 'non appliqué', '365 jours — décidé, étape testimonialSkeletonsDeleted non approuvée'),
                    texte('Signalement', 'non appliqué', 'à la décision, au plus tard 90 jours — décidé, étape testimonialReportsDeleted non approuvée'),
                    texte('Décisions, contestations, sanctions', 'non appliqué', '1 an après la clôture du dossier — décidé le 23/11/2026'),
                ],
                mesures_securite: 'Compte majeur ; relecture humaine avant publication ; aucune décision automatisée ; refus des textes parlant de santé ou d\'un tiers ; modération par administrateur nommé avec MFA ; délais 24 h (urgent) / 7 jours affichés dans la file',
            },
            {
                id: 'T36',
                nom: 'Histoires de la communauté sous pseudonyme (X01)',
                statut: 'capacité community.stories fermée (surface « stories ») ; textes approuvés le 23/11/2026 (notice v12 / v13 ; cgu-citoyen v12 § 7 bis) ; ligne AIPD X01 non signée ; modérateur nommé requis ; préparé à la Release 4',
                finalite: 'Publier, après relecture, les histoires d\'une personne majeure sous un pseudonyme jamais relié publiquement à son compte ; modération DSA',
                base_legale_proposee: 'Consentement (art. 6.1.a) par histoire ; modération : intérêt légitime (art. 6.1.f)',
                categories_donnees: ['Pseudonyme (ligne membre distincte), texte, état et dates', 'Preuve de l\'accord (ConsentLog COMMUNITY_STORY_PUBLICATION)', 'Signalements, décisions, contestations, sanctions'],
                categories_personnes: ['Citoyens majeurs titulaires d\'un compte'],
                destinataires: ['Public (histoire et pseudonyme)', 'Le modérateur nommé'],
                sous_traitants: [vercel, neon, 'Mailjet (e-mails de modération, lorsque la fonction est ouverte)'],
                conservation: [
                    texte('Texte non relu', 'non appliqué', 'retiré après 60 jours — décidé, étape storiesPendingExpired non approuvée'),
                    texte('Pseudonyme inactif', 'non appliqué', '730 jours sans histoire publiée ni en attente — décidé, étape communityMembersInactiveDeleted non approuvée'),
                    texte('Décisions, contestations, sanctions', 'non appliqué', '1 an après la clôture du dossier — décidé le 23/11/2026'),
                ],
                mesures_securite: 'Pseudonyme séparé du compte ; quitter la communauté supprime le pseudonyme et les histoires ; relecture humaine ; MFA du modérateur ; aucune décision automatisée',
            },
            {
                id: 'T37',
                nom: 'Offres d\'emploi inclusives (X05)',
                statut: 'capacité community.employment fermée (surface « employment ») ; textes proposés le 24/11/2026 (notice v15 P32, cgu-citoyen v14) ; ligne AIPD X05 non signée ; modérateur nommé requis ; préparé à la Release 4',
                finalite: 'Publier les offres d\'employeurs vérifiés (E01), relues avant publication, et les modérer ; aucune donnée sur les candidats',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) de l\'exploitant et des employeurs ; modération : intérêt légitime',
                categories_donnees: ['Contenu de l\'offre (champs fermés, aucun critère de l\'article L1132-1 du code du travail)', 'Moyen de candidature (URL ou adresse électronique professionnelle)', 'Compte ADA Pro de l\'administrateur de la structure qui l\'écrit', 'Signalements, décisions, contestations'],
                categories_personnes: ['Membres administrateurs des structures employeuses', 'Personnes qui signalent'],
                destinataires: ['Public (offres publiées)', 'Le modérateur nommé (l\'offre et l\'employeur, jamais l\'auteur)'],
                sous_traitants: [vercel, neon, 'Mailjet (e-mails de modération, lorsque la fonction est ouverte)'],
                conservation: [
                    texte('Moyen de candidature', 'non appliqué', '30 jours après la fin de l\'offre — décidé le 22/11/2026, étape jobListingApplyTargetsErased non approuvée'),
                    texte('Offre terminée', 'non appliqué', '365 jours — décidé, étape jobListingsEndedDeleted non approuvée'),
                    texte('Brouillon ou offre refusée', 'non appliqué', '180 jours — décidé, étape jobListingDraftsDeleted non approuvée'),
                ],
                mesures_securite: 'Aucun formulaire de candidature, aucun compteur de clics, aucun journal de consultation ; champs discriminatoires refusés par construction ; vérification de l\'employeur recontrôlée à chaque lecture publique ; modération MFA',
            },
            {
                // FA-D5 (18/11/2026): P17 + P15b of the V2 register (CONTROL/v2/D2_V2_BASES_LEGALES_FR.md), notice v7 § 4 and § 6
                id: 'T22',
                nom: 'Sauvegardes chiffrées, restauration et traces d\'effacement',
                statut: 'sauvegardes en service (2 par jour) ; traces d\'effacement chez Upstash dès qu\'un effacement a lieu ; seconde copie des traces chez Cloudflare éteinte tant que sa clé n\'est pas posée et que la notice v7 n\'est pas en vigueur',
                finalite: 'Rétablir la base après un incident (RPO 24 h, RTO 1 jour ouvré : objectifs) sans faire revenir une personne effacée (rejeu des effacements après toute restauration)',
                base_legale_proposee: 'Intérêt légitime à la disponibilité et à l\'intégrité (art. 6.1.f, mesure de l\'art. 32.1 b-c) ; traces : obligation d\'effacement (art. 6.1.c, art. 17) — à valider',
                categories_donnees: ['Copie intégrale de la base, chiffrée avant envoi et signée', 'Traces d\'effacement : identifiant de la demande, identifiant pseudonyme du compte, domaines effacés, date, phase — ni adresse ni nom'],
                categories_personnes: ['Toutes les personnes présentes dans la base', 'Personnes effacées (traces)'],
                destinataires: ['Responsable de traitement (clé privée de restauration, hors du producteur)'],
                sous_traitants: ['Scaleway SAS (exécution de la sauvegarde, Paris)', 'Cloudflare R2 (stockage chiffré, juridiction UE ; ne détient pas les clés)', 'Upstash (traces d\'effacement, Francfort)', neon],
                conservation: [
                    { donnee: 'Sauvegardes chiffrées (seau R2 ada-db-backups)', duree_jours: backups.backupDays, source: 'retention-policy.BACKUP_KEEP_DAYS', statut: 'appliqué', description: `${backups.backupDays} jours au plus (règle de cycle de vie du seau, verrou 30 jours)` },
                    { donnee: 'Traces d\'effacement chez Upstash', duree_jours: backups.tombstoneDays, source: 'erasure-tombstones.TOMBSTONE_TTL_SECONDS', statut: 'appliqué', description: `${backups.tombstoneDays} jours par entrée (élagage à chaque écriture et contrôle horaire)` },
                    { donnee: 'Seconde copie chiffrée des traces (Cloudflare R2)', duree_jours: backups.copyDays, source: 'erasure-tombstone-copy.COPY_RETENTION_DAYS', statut: 'non appliqué', description: `${backups.copyDays} jours par objet (suppression horaire ; règle de cycle de vie à 39 jours en filet) — copie éteinte tant qu'elle n'est pas activée` },
                    texte('Historique de la base chez Neon', 'appliqué', '6 heures (offre gratuite, fait du prestataire)'),
                ],
                mesures_securite: 'Chiffrement avant envoi (clé privée hors du producteur), sauvegardes et registre signés, vérification mensuelle de restauration dans une base jetable effacée ensuite, rejeu des effacements refusé si les traces sont incomplètes ou en désaccord ; copie des traces chiffrée et authentifiée (AES-256-GCM), noms HMAC',
            },
        ],
        sous_traitants: withContractStatus([
            { nom: 'Vercel', role: 'Hébergement front et fonctions serveur, cron', statut: 'en service (bêta publique restreinte ; crons fermés)', localisation: 'UE — région fra1 (Francfort) pour les fonctions ; pages statiques distribuées par le réseau mondial ; installations principales de Vercel aux États-Unis (DPA § 13.1)', entite_contractante: 'Vercel Inc. (USA) — équipe sur l\'offre Pro', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, module 2 (DPA § 13.3, annexe 3) ; Vercel Inc. active sur la liste officielle du Data Privacy Framework (lue le 17/11/2026)', dpa: DPA_INTEGRE, role_propre: 'Vercel est aussi responsable de traitement pour les données d\'usage de son service (DPA § 4.b)', journaux: 'journaux d\'exécution : 1 jour sur l\'offre Pro, 30 jours si l\'option Observability Plus s\'applique au projet (activée par défaut pour les équipes passées en Pro depuis le 03/04/2026) — option NON activée, vérifié en lecture seule par l\'API Vercel le 17/11/2026 ; équipe en Pro depuis le 21/01/2026' },
            { nom: 'Vercel Analytics + Speed Insights', role: 'Audience et performance', statut: 'désactivé par défaut (ADR-022 ; VITE_AUDIENCE_MEASUREMENT)', localisation: NON_VERIFIE, entite_contractante: 'Vercel Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Neon', role: 'Base de données PostgreSQL', statut: 'en service (bêta publique restreinte)', localisation: 'Francfort selon /mentions-legales — preuve console à archiver', entite_contractante: 'Databricks, Inc., société mère de Neon, LLC (neon.com/dpa) — offre gratuite', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, modules 2 et 3, réputées intégrées (DPA Databricks § 8.1, annexe B) ; Databricks, Inc. active sur la liste officielle du Data Privacy Framework (lue le 15/11/2026)', dpa: DPA_INTEGRE, journaux: 'historique de la base : 6 heures sur l\'offre gratuite (plus long sur une offre payante)' },
            { nom: 'Upstash', role: 'Limitation de débit (KV/Redis) ; traces d\'effacement (40 jours) ; plus aucun identifiant de contact Mailjet depuis la v6 (décision C6 : ancienne liste seulement vidée) ; ne contient plus l\'état des leurres de réservation (R41-B)', statut: 'en service (bêta publique restreinte)', localisation: 'Francfort (fra1) — preuve UPSTASH_REGION_EVIDENCE_2026-11-15', entite_contractante: 'Upstash, Inc. — offre gratuite', mecanisme_transfert: 'Data Privacy Framework d\'abord (Upstash, Inc. active sur la liste officielle, lue le 17/11/2026) ; clauses contractuelles types (UE) 2021/914, module 2, s\'il ne s\'applique plus (DPA § 3.2 B, annexe 2)', dpa: DPA_INTEGRE, role_propre: 'Le DPA d\'Upstash ne couvre pas ses traitements pour sa propre sécurité et l\'analyse de son service : Upstash en est responsable (DPA, « How and when this DPA applies »)' },
            { nom: 'Scaleway SAS', role: 'Exécution des sauvegardes de la base (tâche planifiée qui chiffre la copie avant tout envoi) et de la vérification de restauration', statut: 'en service (2 sauvegardes par jour)', localisation: 'Paris (UE)', entite_contractante: 'Scaleway SAS (France)', mecanisme_transfert: 'aucun transfert hors UE', dpa: DPA_SCALEWAY },
            { nom: 'Cloudflare (R2)', role: 'Stockage des sauvegardes chiffrées de la base ; seconde copie chiffrée des traces d\'effacement (éteinte jusqu\'à son activation) ; Cloudflare ne détient pas les clés', statut: 'en service pour les sauvegardes', localisation: 'seaux en juridiction UE', entite_contractante: 'Cloudflare, Inc. (USA)', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, modules 2 et 3, et Data Privacy Framework (DPA Cloudflare, lu le 09/11/2026) ; contenu illisible sans les clés', dpa: DPA_CLOUDFLARE_R2 },
            { nom: 'Stockage objet S3/R2 (fournisseur à confirmer)', role: 'Coffre, pièces jointes (fichiers chiffrés par enveloppe)', statut: 'prévu', localisation: 'non choisie', entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Sentry (Functional Software Inc.)', role: 'R5-S1 : erreurs du site (navigateur) et du serveur seulement — ni traces de performance (serveur : seulement si SENTRY_SERVER_TRACING=on et SENTRY_TRACES_SAMPLE_RATE > 0, non configurés), ni Session Replay, ni session de santé de version ; identité, e-mail, IP, paramètres d\'adresse, cookies, en-têtes (sauf User-Agent), corps de requête, jetons de chemin, saisies de formulaire et fils console retirés avant envoi (src/observability/sentryScrub.js, api/_utils/sentryServer.js)', statut: 'actif seulement depuis un déploiement Vercel Production avec SENTRY_DSN (ajouté le 24/11/2026) en région UE — à l\'approbation de R5-S1, après acceptation électronique du DPA Sentry par le responsable (opt-in, non automatique)', localisation: 'UE — région « EU » de Sentry, Francfort (Allemagne) pour les événements (docs.sentry.io/organization/data-storage-location, lu le 24/11/2026) ; métadonnées du compte et de l\'organisation aux États-Unis', entite_contractante: 'Functional Software, Inc. d/b/a Sentry, 45 Fremont Street, 8th Floor, San Francisco, CA 94105 (USA)', mecanisme_transfert: 'Clauses contractuelles types (UE), modules 2 et 3, réputées signées par l\'acceptation du DPA (sentry.io/legal/dpa, annexe 3) ; Sentry déclare adhérer au Data Privacy Framework (sentry.io/privacy) — inscription sur la liste officielle non vérifiée ; lus le 24/11/2026', dpa: DPA_INCONNU },
            { nom: 'Microsoft (Outlook, boîte contact@accesdirectaide.fr)', role: 'Réception des messages envoyés à l\'adresse de contact publiée', statut: 'en service (boîte existante, R42-A05)', localisation: NON_VERIFIE, entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Autres expéditeurs codés (Microsoft Graph sendMail, Resend)', role: 'E-mails transactionnels', statut: 'non retenus, non configurés', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Mailjet (Sinch)', role: 'E-mails de service des comptes (vérification de l\'adresse, mot de passe, avis du compte)', statut: 'en service depuis le 18/11/2026 (activation 6b, MAILER_PROVIDER=mailjet) ; sous-traitant retenu ; offre (gratuite ou payante) non enregistrée', localisation: 'Google Cloud, Francfort (Allemagne) et Saint-Ghislain (Belgique)', entite_contractante: 'Groupe Sinch AB (Suède) ; Mailjet SAS est une société française — entité signataire exacte non vérifiée', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, module 2 (DPA Sinch § 12 c–d) ; pas de Data Privacy Framework pour Mailjet (la société inscrite est Mailgun Technologies, Inc.)', dpa: DPA_INTEGRE, role_propre: 'Sinch est aussi responsable de traitement indépendant pour acheminer les messages, lutter contre le spam et la fraude et sécuriser son réseau (DPA § 3 a iv)', journaux: 'statistiques : 90 jours (offre gratuite) ou 13 mois (offre payante) ; adresse du destinataire enregistrée comme contact pour la durée du compte, suppression demandée avant l\'effacement du compte (api/_services/mail-contact-erasure.js) ; en cas d\'échec, nouvel essai 3 jours au plus dans le délai d\'un mois, puis effacement du compte et signalement sans adresse « intervention humaine requise » (api/_services/mail-contact-failures.js) ; effacement dans les 90 jours après la fin du contrat ; aucune durée publiée pour le contenu des messages' },
            { nom: 'Cloudflare, Inc. (Workers AI)', role: 'Assistant citoyen (branche g14-ai fusionnée dans la version a628f7b)', statut: 'prévu', localisation: 'États-Unis (réseau mondial)', mecanisme_transfert: 'CCT 2021/914 module 2 (DPA Cloudflare v6.4, 3 avril 2026, clause 6.2) ; cadre UE–États-Unis (clause 6.4) — page lue le 23/11/2026', dpa: DPA_CLOUDFLARE_V64 },
            { nom: 'Scalingo SAS (HDS)', role: 'Mon Coffre : service séparé qui ne conserve que des documents chiffrés de bout en bout dans le navigateur (branche g14-r3f)', statut: 'actif — service HDS déployé le 24/11/2026 (osc-fr1, 2 conteneurs S + PostgreSQL Business 512M) ; Mon Coffre fermé tant que HDS_PRODUCTION_APPROVED est absent', localisation: 'France — région osc-fr1', entite_contractante: 'Scalingo SAS (France) — certificat HDS n° 38436 (valable jusqu\'au 11/09/2028)', mecanisme_transfert: 'aucun transfert hors UE', dpa: 'accepté en ligne — Annexe HDS v2.5.0 de Scalingo, acceptée par le responsable le 22/11/2026 (non signé ; copie CONTROL/v2/scalingo-hds-fr-2_5_0.pdf, sha256 24997f6e…) ; point de contact HDS : le fondateur' },
            { nom: 'Scaleway SAS (OpenFisca)', role: 'Hébergement de notre moteur de calcul OpenFisca (branche g14-of fusionnée dans la version a628f7b)', statut: 'actif depuis la version a628f7b (24/11/2026)', localisation: 'France (Paris, fr-par)', mecanisme_transfert: 'aucun transfert hors UE', dpa: DPA_SCALEWAY },
            { nom: 'Twilio', role: 'SMS', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Microsoft (Outlook / Graph)', role: 'Agenda des professionnels (disponibilités libre/occupé quand une structure l\'a configuré, R42-A03 ; Calendars.ReadBasic, rien n\'est écrit)', statut: 'en service depuis la release 2 (OUTLOOK_ENABLED=true) pour les professionnels qui connectent leur calendrier', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_MICROSOFT },
            { nom: '8x8, Inc. (Jitsi as a Service)', role: 'Visioconférence des rendez-vous (seulement si la structure a validé la visioconférence et la personne l\'a acceptée)', statut: 'en service depuis la release 2 (surface video) — notice v13, AIPD A1', localisation: 'États-Unis (8x8, Inc.)', entite_contractante: '8x8, Inc. (États-Unis)', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, module 2 (8x8 Global DPA 2025-02)', dpa: DPA_8X8 },
        ]),
        services_non_destinataires: [
            { nom: 'Google (Gemini API)', statut: 'bloqué', motif: 'Refusé par la politique IA du code (api/lib/ai-policy.js, BLOCKED_PENDING_PROVIDER_REVIEW) ; aucune donnée transmise ; pas un destinataire ni un sous-traitant', dpa: 'aucun' },
            { nom: 'Ollama (qwen3:8b, nomic-embed-text)', statut: 'activé en local', motif: 'Modèle de l\'assistant, exécuté sur la même machine (127.0.0.1) ; aucun transfert ; pas un sous-traitant tant qu\'il n\'est pas hébergé par un tiers' },
            { nom: 'OpenFisca (API publique)', statut: 'refusé en production', motif: 'Prototype de développement uniquement' },
            { nom: 'SIAO', statut: 'désactivé', motif: 'SIAO_ENABLED off ; aucune convention' },
        ],
        transferts_hors_ue: 'Vercel, Neon (Databricks), Upstash et Mailjet (Sinch) : clauses contractuelles types (UE) 2021/914 intégrées à leurs conditions, lues sur leurs pages publiques le 15/11/2026 ; Vercel Inc., Upstash, Inc. et Databricks, Inc. actives sur la liste officielle du Data Privacy Framework à cette date (pas Mailjet). Cloudflare, Inc. (R2) : clauses contractuelles types et Data Privacy Framework (DPA lu le 09/11/2026) ; contenu chiffré, clés hors de Cloudflare. Scaleway SAS : aucun transfert (Paris). Accords art. 28 intégrés aux conditions de service, aucun signé. Autres prestataires : NON VÉRIFIÉ.',
        droits_exercables: [
            'Droit d\'accès (article 15) — export depuis le compte',
            'Droit de rectification (article 16)',
            'Droit à l\'effacement (article 17) — demande enregistrée (HTTP 202) puis revue humaine avant exécution ; le cron gdpr-purge ne traite pas les demandes',
            'Droit à la portabilité (article 20) — export JSON dans l\'application : GET /api/auth/export-data',
            'Droit à la limitation (article 18) et d\'opposition (article 21) — demande puis revue humaine',
            'Accès aux notes détenues par une structure — revue par deux personnes différentes avec MFA',
        ],
    };
}

export function serializeRegistre(registre) {
    return `${JSON.stringify(registre, null, 2)}\n`;
}

export function generateRegistreContent(rootDir = ROOT_DIR) {
    return serializeRegistre(buildRegistre(readCodeSources(rootDir)));
}

export const REGISTRE_OUTPUT_PATH = path.join(ROOT_DIR, 'REGISTRE_RGPD.json');

function writeRegistre() {
    const content = generateRegistreContent();
    fs.writeFileSync(REGISTRE_OUTPUT_PATH, content, 'utf-8');
    const registre = JSON.parse(content);
    console.log(`Registre RGPD généré : ${REGISTRE_OUTPUT_PATH}`);
    console.log(`   ${registre.traitements.length} traitements, ${registre.sous_traitants.length} sous-traitants (révision ${registre.date_mise_a_jour})`);
}

// ─── CLI ──────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
    const [, , command] = process.argv;
    if (command === 'export') {
        // Ancienne sous-commande retirée : elle lisait des colonnes absentes du schéma et écrivait un export en clair sur disque.
        console.error('La sous-commande « export » est désactivée. L\'export de portabilité (art. 20) se fait dans l\'application : GET /api/auth/export-data (depuis le compte de la personne). Aucun fichier n\'a été écrit.');
        process.exitCode = 1;
    } else {
        writeRegistre();
    }
}
