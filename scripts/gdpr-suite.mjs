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
export const REGISTRE_VERSION = '0.7';   // G14-R3 (24/11/2026, PROPOSED): T29 household, T30 guardian link (restricted form), T31 trusted persons, T32 events (X04). 0.6 = G14 owner legal approval (23/11/2026, OWNER_VALIDATED): P18 (T02), P19 (T08) and P20 (T25) bases decided, social referrals (T24) 12 months after closure decided, Cloudflare DPA v6.4 accepted online. 0.5 = G14 consolidation (23/11/2026): T02 OpenFisca at Scaleway, T08 Cloudflare Workers AI (branch g14-ai), T23 assisted mode, T24 social referrals, T25 Observatoire, T26 browser notifications and calendar files. Earlier:   // FA-D5 (18/11/2026): T22 backups + erasure traces, Scaleway and Cloudflare (R2) as processors, durations read from the code. 0.3 =   // Legal v5 (15/11/2026): provider contracts, transfer mechanisms and own-controller roles as read in CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md; Mailjet retained for service e-mails, contact deleted on erasure. 0.2 = R42-LEGAL: natural-person operator, account-required appointments, guest booking retired, statuses of the beta
export const REGISTRE_DATE_REVISION = '2026-11-24';

export const CONTACT_PROTECTION_DONNEES = '[À COMPLÉTER : contact protection des données]';
const DPA_INCONNU = 'inconnu / non signé';
const NON_VERIFIE = 'NON VÉRIFIÉ';
// Legal v5: an agreement incorporated by the provider's terms is NOT a signed agreement — the register says which one it is, and when it was read
const DPA_INTEGRE = 'intégré aux conditions de service (non signé) — pages publiques lues le 15/11/2026';
// FA-D5: Cloudflare — DPA v6.4 incorporated by the Self-Serve Subscription Agreement § 6.1, read 09/11/2026 (CONTROL/v2/PRESTATAIRES_CONTRATS_PREUVES_FR.md)
const DPA_INTEGRE_0911 = 'intégré aux conditions de service (non signé) — pages publiques lues le 09/11/2026';
// FA-D5: Scaleway — the owner's statement « Scaleway DPA : kabul » (13/11/2026, AIPD V2 annex § 8); the PDF is not archived yet
const DPA_CLOUDFLARE_V64 = 'intégré aux conditions de service (non signé) — DPA Cloudflare v6.4 (3 avril 2026) lu le 23/11/2026, accepté en ligne (décision du responsable du 23/11/2026)';
const DPA_SCALEWAY = 'accepté dans la console par le responsable de traitement (déclaration du 13/11/2026) — PDF non archivé, non signé séparément';

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
                sous_traitants: [vercel, neon, 'Upstash (limitation de débit, prévu)', 'Sentry (si DSN configuré)'],
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
                base_legale_proposee: 'Service demandé (art. 6.1.b) ; art. 9.2.a si données de santé confiées — à valider',
                categories_donnees: ['Messages du dossier (chiffrés par enveloppe)', 'Messages de rendez-vous (chiffrés à l\'enregistrement, clé serveur)', 'Pièces jointes (chiffrées)'],
                categories_personnes: ['Citoyens', 'Professionnels'],
                destinataires: ['La personne et les membres actifs de la structure concernée'],
                sous_traitants: [vercel, neon, 'Stockage objet S3/R2 (prévu)'],
                conservation: [
                    { ...sharedRule, donnee: 'Messages du dossier partagé (cascade avec le dossier)' },
                    texte('Messagerie de rendez-vous', 'non appliqué', 'aucune purge ; supprimée seulement à l\'effacement du compte'),
                ],
                mesures_securite: 'Chiffrement par enveloppe (le serveur peut déchiffrer : pas de chiffrement de bout en bout), contrôle d\'accès par structure, pas d\'antivirus',
            },
            {
                id: 'T05',
                nom: 'Coffre (documents personnels)',
                finalite: 'Conserver et retrouver ses justificatifs',
                base_legale_proposee: 'Art. 6.1.b ; art. 9.2.a pour les documents médicaux déposés volontairement — à valider',
                categories_donnees: ['Fichiers (art. 9 possible)', 'Nom de fichier chiffré', 'Catégorie, type, taille, empreinte'],
                categories_personnes: ['Citoyens', 'Tiers figurant sur les documents'],
                destinataires: ['La personne ; une structure seulement si le document est joint à un dossier partagé'],
                sous_traitants: ['Stockage objet S3/R2 (prévu)', neon, vercel],
                conservation: [texte('Documents du coffre', 'appliqué', 'jusqu\'à suppression par la personne ou effacement du compte ; expiresAt non purgé par le cron (non appliqué)')],
                mesures_securite: 'Chiffrement par enveloppe du contenu et du nom ; pas d\'antivirus (NOT_SCANNED)',
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
                conservation: [texte('SupportRequest', 'non appliqué', 'aucune purge')],
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
                conservation: [texte('Agrégats', 'sans objet', 'les données sources suivent leur propre durée')],
                mesures_securite: 'Export territorial fermé tant que la licence n\'est pas décidée',
            },
            {
                id: 'T12',
                nom: 'Administration, sécurité et journalisation',
                finalite: 'Administrer, sécuriser les accès, tracer les actions, diagnostiquer les erreurs',
                base_legale_proposee: 'Intérêt légitime de sécurité (art. 6.1.f) ou obligation légale (art. 6.1.c) — à valider',
                categories_donnees: ['AdminUser', 'AuditLog (IP en clair et empreinte)', 'ProAuditLog', 'UpdateLog', 'Erreurs et Session Replay Sentry'],
                categories_personnes: ['Administrateurs', 'Professionnels', 'Usagers', 'Visiteurs'],
                destinataires: ['Administrateurs AccesDirectAide', 'Sentry (sous-traitant, si DSN)'],
                sous_traitants: [vercel, neon, 'Sentry (si DSN configuré)'],
                conservation: [
                    cron('Journal d\'audit (AuditLog)', 'AUDIT_LOG_DAYS', 'suppression après {j} jours'),
                    policyRule('Journal d\'audit (registre interne)', 'AUDIT_LOG', 'suppression après {j} jours'),
                    cron('Journal d\'audit pro (ProAuditLog)', 'PRO_AUDIT_LOG_DAYS', 'suppression après {j} jours'),
                    cron('Journaux de mise à jour (UpdateLog)', 'CONVERSATION_LOG_DAYS', 'suppression après {j} jours'),
                    texte('Sentry', NON_VERIFIE, 'durée réglée dans la console Sentry, non vérifiée'),
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
                conservation: [texte('InstitutionAccount, PartnerAgreement, PartnershipRequest', 'non appliqué', 'aucune purge')],
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
            // G14-R3 (24/11/2026, release-3 package, PROPOSED — not approved): household (C03), guardian link (C05), trusted persons (C23), events (X04).
            // Notice v14-2026-11-24 P24 / P25 / P26 and v12 / v13 § 3 ter; durations of C23 / C05 = retention-policy.js pendingApproval (not executable).
            {
                id: 'T29',
                nom: 'Mon foyer — membres du foyer décrits par la personne (C03)',
                statut: 'capacité citizen.household fermée ; ouverture proposée à la release 3 (ADA_BETA_ACCOUNTS_EXTRA=household + ADA_CAPABILITIES_OPEN)',
                finalite: 'Permettre à la personne de garder, dans son profil, la composition de son foyer pour elle-même',
                base_legale_proposee: 'Exécution des conditions d\'utilisation (art. 6.1.b) pour la personne ; intérêt légitime (art. 6.1.f) pour les membres décrits, sans compte (notice v14, P24) — à valider par le responsable',
                categories_donnees: ['Lien avec la personne (liste fermée)', 'Tranche d\'âge facultative (dont « moins de 18 ans » pour un enfant)', 'Nom court facultatif (30 caractères au plus)'],
                categories_personnes: ['Citoyens titulaires d\'un compte', 'Membres du foyer décrits (dont des enfants), sans compte'],
                destinataires: ['La personne seule (profil, export)'],
                sous_traitants: [vercel, neon],
                conservation: [texte('Membres du foyer (HouseholdMember)', 'appliqué', 'tant que la personne les garde ; suppression par la personne à tout moment ; effacés avec le compte (ON DELETE CASCADE)')],
                mesures_securite: '12 personnes au plus ; aucun texte libre au-delà de 30 caractères ; lu seulement quand la capacité est ouverte ; règle d\'âge du compte (ageGate) ; information des membres décrits : art. 14.5.b (données minimales, aucun contact) — à valider',
            },
            {
                id: 'T30',
                nom: 'Lien entre le compte d\'une personne mineure et un représentant légal (C05) — forme restreinte',
                statut: 'capacité citizen.guardians fermée ; ouverture proposée à la release 3 SANS création de lien : les comptes de mineurs restent fermés (citizen.minor_accounts non ouvrable) et la déclaration est refusée (MINOR_ACCOUNTS_CLOSED)',
                finalite: 'Permettre à chacune des deux personnes de voir et de retirer un lien existant ; vérification renforcée par une personne habilitée, seulement si une politique d\'âge validée la prévoit (aucune à ce jour)',
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) — notice v14, P26 — à valider par le responsable ; toute création de lien exigerait une décision distincte (politique d\'âge, art. 8 RGPD, art. 45 loi Informatique et Libertés)',
                categories_donnees: ['Identifiants des deux comptes', 'État du lien', 'Preuve de chaque étape (ConsentLog GUARDIAN_LINK)'],
                categories_personnes: ['Personnes mineures (comptes existants seulement)', 'Représentants légaux'],
                destinataires: ['Les deux personnes', 'Un administrateur nommé avec MFA pour la seule vérification renforcée (aucune méthode autorisée à ce jour)'],
                sous_traitants: [vercel, neon],
                conservation: [
                    texte('Lien retiré (GuardianRelationship REVOKED)', 'non appliqué', '30 jours après le retrait — durée PROPOSÉE (GUARDIAN_LINK_REVOKED_DAYS, à approuver ; étape guardianLinksRevokedDeleted non exécutable)'),
                    texte('Preuves des étapes (ConsentLog)', 'appliqué', 'règle des décisions de consentement'),
                ],
                mesures_securite: 'Aucun nouveau lien tant que les comptes de mineurs sont fermés ; une confirmation par e-mail n\'est jamais une preuve ; sans politique d\'âge validée, aucun effet sur le compte',
            },
            {
                id: 'T31',
                nom: 'Personnes de confiance — délégation de consultation en lecture seule (C23)',
                statut: 'capacité citizen.delegations fermée ; ouverture proposée à la release 3 (ADA_BETA_ACCOUNTS_EXTRA=delegations + ADA_CAPABILITIES_OPEN)',
                finalite: 'Permettre à la personne de laisser une personne qu\'elle choisit consulter, en lecture seule et pour une durée limitée, les parties ouvertes de son espace (à ce jour : rendez-vous à venir)',
                base_legale_proposee: 'Consentement de la personne (art. 6.1.a) ; intérêt légitime (art. 6.1.f) pour la personne invitée (notice v14, P25) — à valider par le responsable',
                categories_donnees: ['Adresse électronique invitée', 'Rôle indiqué', 'Parties ouvertes et durée', 'Dates', 'Journal des consultations (DelegationAccessEvent)', 'Rendez-vous à venir consultés (date, heure, structure, état)'],
                categories_personnes: ['Citoyens titulaires d\'un compte (personne)', 'Personnes de confiance invitées (avec ou sans compte au moment de l\'invitation)'],
                destinataires: ['La personne de confiance (lecture seule, parties choisies, adresse de la personne)', 'Mailjet (Sinch) pour l\'e-mail d\'invitation'],
                sous_traitants: [vercel, neon, 'Mailjet (Sinch) — e-mail d\'invitation'],
                conservation: [
                    texte('Invitation sans réponse', 'non appliqué', '30 jours après son expiration, avec l\'adresse invitée — durée PROPOSÉE (DELEGATION_INVITATION_EXPIRED_DAYS, à approuver ; étape delegationInvitationsExpiredDeleted non exécutable)'),
                    texte('Délégation terminée, refusée ou expirée et son journal', 'non appliqué', '365 jours après sa fin — durée PROPOSÉE (DELEGATION_ENDED_DAYS, à approuver ; étape delegationsEndedDeleted non exécutable)'),
                    texte('Délégation en cours', 'appliqué', 'jusqu\'à son terme (30 à 365 jours) ou sa fin par l\'une des deux personnes ; effacée avec l\'un des deux comptes'),
                ],
                mesures_securite: 'Lecture seule, jamais la session de la personne ; acceptation seulement par le compte dont l\'adresse vérifiée est l\'adresse invitée ; jeton d\'invitation en empreinte SHA-256, 7 jours, usage unique ; chaque partie suit sa propre capacité (Mon Coffre fermé : HDS ; Mon Parcours : ADA_PARCOURS_DELEGATE_READ) ; rôles tuteur / curateur / représentant sans effet (PROOF_REQUIRED) ; consultation suspendue pendant une limitation (art. 18) ; 10 délégations en cours au plus',
            },
            {
                id: 'T32',
                nom: 'Académie et événements — inscription d\'une personne majeure (X04)',
                statut: 'capacité community.events fermée (surface « events ») ; textes approuvés le 23/11/2026 (notice v12 / v13 § 3 ter et § 4) ; ligne AIPD X04 non signée ; ouverture proposée à la release 3',
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
        sous_traitants: [
            { nom: 'Vercel', role: 'Hébergement front et fonctions serveur, cron', statut: 'en service (bêta publique restreinte ; crons fermés)', localisation: 'UE — région fra1 (Francfort) pour les fonctions ; pages statiques distribuées par le réseau mondial ; installations principales de Vercel aux États-Unis (DPA § 13.1)', entite_contractante: 'Vercel Inc. (USA) — équipe sur l\'offre Pro', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, module 2 (DPA § 13.3, annexe 3) ; Vercel Inc. active sur la liste officielle du Data Privacy Framework (lue le 17/11/2026)', dpa: DPA_INTEGRE, role_propre: 'Vercel est aussi responsable de traitement pour les données d\'usage de son service (DPA § 4.b)', journaux: 'journaux d\'exécution : 1 jour sur l\'offre Pro, 30 jours si l\'option Observability Plus s\'applique au projet (activée par défaut pour les équipes passées en Pro depuis le 03/04/2026) — option NON activée, vérifié en lecture seule par l\'API Vercel le 17/11/2026 ; équipe en Pro depuis le 21/01/2026' },
            { nom: 'Vercel Analytics + Speed Insights', role: 'Audience et performance', statut: 'désactivé par défaut (ADR-022 ; VITE_AUDIENCE_MEASUREMENT)', localisation: NON_VERIFIE, entite_contractante: 'Vercel Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Neon', role: 'Base de données PostgreSQL', statut: 'en service (bêta publique restreinte)', localisation: 'Francfort selon /mentions-legales — preuve console à archiver', entite_contractante: 'Databricks, Inc., société mère de Neon, LLC (neon.com/dpa) — offre gratuite', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, modules 2 et 3, réputées intégrées (DPA Databricks § 8.1, annexe B) ; Databricks, Inc. active sur la liste officielle du Data Privacy Framework (lue le 15/11/2026)', dpa: DPA_INTEGRE, journaux: 'historique de la base : 6 heures sur l\'offre gratuite (plus long sur une offre payante)' },
            { nom: 'Upstash', role: 'Limitation de débit (KV/Redis) ; traces d\'effacement (40 jours) ; plus aucun identifiant de contact Mailjet depuis la v6 (décision C6 : ancienne liste seulement vidée) ; ne contient plus l\'état des leurres de réservation (R41-B)', statut: 'en service (bêta publique restreinte)', localisation: 'Francfort (fra1) — preuve UPSTASH_REGION_EVIDENCE_2026-11-15', entite_contractante: 'Upstash, Inc. — offre gratuite', mecanisme_transfert: 'Data Privacy Framework d\'abord (Upstash, Inc. active sur la liste officielle, lue le 17/11/2026) ; clauses contractuelles types (UE) 2021/914, module 2, s\'il ne s\'applique plus (DPA § 3.2 B, annexe 2)', dpa: DPA_INTEGRE, role_propre: 'Le DPA d\'Upstash ne couvre pas ses traitements pour sa propre sécurité et l\'analyse de son service : Upstash en est responsable (DPA, « How and when this DPA applies »)' },
            { nom: 'Scaleway SAS', role: 'Exécution des sauvegardes de la base (tâche planifiée qui chiffre la copie avant tout envoi) et de la vérification de restauration', statut: 'en service (2 sauvegardes par jour)', localisation: 'Paris (UE)', entite_contractante: 'Scaleway SAS (France)', mecanisme_transfert: 'aucun transfert hors UE', dpa: DPA_SCALEWAY },
            { nom: 'Cloudflare (R2)', role: 'Stockage des sauvegardes chiffrées de la base ; seconde copie chiffrée des traces d\'effacement (éteinte jusqu\'à son activation) ; Cloudflare ne détient pas les clés', statut: 'en service pour les sauvegardes', localisation: 'seaux en juridiction UE', entite_contractante: 'Cloudflare, Inc. (USA)', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, modules 2 et 3, et Data Privacy Framework (DPA Cloudflare, lu le 09/11/2026) ; contenu illisible sans les clés', dpa: DPA_INTEGRE_0911 },
            { nom: 'Stockage objet S3/R2 (fournisseur à confirmer)', role: 'Coffre, pièces jointes (fichiers chiffrés par enveloppe)', statut: 'prévu', localisation: 'non choisie', entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Sentry (Functional Software Inc.)', role: 'Erreurs serveur et navigateur, Session Replay (1 % / 10 % en erreur), traces 10 %', statut: 'activé si un DSN est configuré', localisation: NON_VERIFIE, entite_contractante: 'Functional Software Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Microsoft (Outlook, boîte contact@accesdirectaide.fr)', role: 'Réception des messages envoyés à l\'adresse de contact publiée', statut: 'en service (boîte existante, R42-A05)', localisation: NON_VERIFIE, entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Autres expéditeurs codés (Microsoft Graph sendMail, Resend)', role: 'E-mails transactionnels', statut: 'non retenus, non configurés', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Mailjet (Sinch)', role: 'E-mails de service des comptes (vérification de l\'adresse, mot de passe, avis du compte)', statut: 'retenu (notice de confidentialité v6, non approuvée) ; envoi réel seulement si MAILER_PROVIDER=mailjet — état de la Production non vérifié ici ; offre (gratuite ou payante) non enregistrée', localisation: 'Google Cloud, Francfort (Allemagne) et Saint-Ghislain (Belgique)', entite_contractante: 'Groupe Sinch AB (Suède) ; Mailjet SAS est une société française — entité signataire exacte non vérifiée', mecanisme_transfert: 'Clauses contractuelles types (UE) 2021/914, module 2 (DPA Sinch § 12 c–d) ; pas de Data Privacy Framework pour Mailjet (la société inscrite est Mailgun Technologies, Inc.)', dpa: DPA_INTEGRE, role_propre: 'Sinch est aussi responsable de traitement indépendant pour acheminer les messages, lutter contre le spam et la fraude et sécuriser son réseau (DPA § 3 a iv)', journaux: 'statistiques : 90 jours (offre gratuite) ou 13 mois (offre payante) ; adresse du destinataire enregistrée comme contact pour la durée du compte, suppression demandée avant l\'effacement du compte (api/_services/mail-contact-erasure.js) ; en cas d\'échec, nouvel essai 3 jours au plus dans le délai d\'un mois, puis effacement du compte et signalement sans adresse « intervention humaine requise » (api/_services/mail-contact-failures.js) ; effacement dans les 90 jours après la fin du contrat ; aucune durée publiée pour le contenu des messages' },
            { nom: 'Cloudflare, Inc. (Workers AI)', role: 'Assistant citoyen (branche g14-ai fusionnée dans la version a628f7b)', statut: 'prévu', localisation: 'États-Unis (réseau mondial)', mecanisme_transfert: 'CCT 2021/914 module 2 (DPA Cloudflare v6.4, 3 avril 2026, clause 6.2) ; cadre UE–États-Unis (clause 6.4) — page lue le 23/11/2026', dpa: DPA_CLOUDFLARE_V64 },
            { nom: 'Scaleway SAS (OpenFisca)', role: 'Hébergement de notre moteur de calcul OpenFisca (branche g14-of fusionnée dans la version a628f7b)', statut: 'prévu', localisation: 'France (Paris, fr-par)', mecanisme_transfert: 'aucun transfert hors UE', dpa: DPA_SCALEWAY },
            { nom: 'Twilio', role: 'SMS', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Microsoft (Outlook / Graph)', role: 'Agenda des professionnels (disponibilités libre/occupé quand une structure l\'a configuré, R42-A03)', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
        ],
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
