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
export const REGISTRE_VERSION = '0.1';
export const REGISTRE_DATE_REVISION = '2026-10-25';

export const CONTACT_PROTECTION_DONNEES = '[À COMPLÉTER : contact protection des données]';
const DPA_INCONNU = 'inconnu / non signé';
const NON_VERIFIE = 'NON VÉRIFIÉ';

export const SOURCE_FILES = Object.freeze({
    retention: 'api/_handlers/cron/gdpr-purge.js',
    registry: 'api/_services/privacy.js',
    legalEntity: 'src/config/legal-entity.ts',
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
    return { status: read('status'), legalName: read('legalName'), tradeName: read('tradeName'), siren: read('siren'), registeredOffice: read('registeredOffice'), dpoContact: read('dpoContact') };
}

export function readCodeSources(rootDir = ROOT_DIR) {
    const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');
    return {
        retention: parseRetention(read(SOURCE_FILES.retention)),
        registry: parseRetentionPolicyRegistry(read(SOURCE_FILES.registry)),
        legalEntity: parseLegalEntity(read(SOURCE_FILES.legalEntity)),
    };
}

// ─── Construction du registre (fonction pure) ─────────

/**
 * @param {{ retention: Record<string, number>, registry: Record<string, {durationDays: number|null, action: string|null, implementedBy: string|null}>, legalEntity: Record<string, string|null> }} sources
 */
export function buildRegistre({ retention, registry, legalEntity }) {
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

    const vercel = 'Vercel (hébergement, prévu)';
    const neon = 'Neon (PostgreSQL, prévu)';

    return {
        _avertissement: 'Fichier GÉNÉRÉ par scripts/gdpr-suite.mjs — ne pas modifier à la main. Vue synthétique, PROJET non validé par un juriste. Référence : LEGAL_FR/06_REGISTRE_TRAITEMENTS.md.',
        version: REGISTRE_VERSION,
        date_mise_a_jour: REGISTRE_DATE_REVISION,
        statut_document: 'PROJET — RELECTURE JURIDIQUE REQUISE',
        sources_code: { ...SOURCE_FILES },
        organisme: {
            nom_usage: legalEntity.tradeName,
            statut: legalEntity.status,
            raison_sociale: legalEntity.legalName,
            siren: legalEntity.siren,
            adresse: legalEntity.registeredOffice,
            responsable_traitement: '[À COMPLÉTER : responsable de traitement — entité en formation]',
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
                base_legale_proposee: 'Service demandé (art. 6.1.b) ; art. 9.2.a si des réponses révèlent santé ou handicap — à valider',
                categories_donnees: ['Revenus', 'Loyer', 'Composition du foyer', 'Situation professionnelle et familiale', 'Réponses pouvant révéler santé ou handicap (art. 9 possible)'],
                categories_personnes: ['Citoyens (avec ou sans compte)', 'Membres du foyer décrits'],
                destinataires: ['La personne', 'Les structures qu\'elle choisit, uniquement après partage (T03)'],
                lieux_traitement: [
                    'Calcul : réponses envoyées à /api/diagnostic, non stockées par /api/diagnostic',
                    'Appareil : localStorage ada_diagnostic_state (lisible 24 heures, effacé à la visite suivante ou par « Réinitialiser tout »)',
                    'Partage : copie conservée chiffrée au repos (enveloppe, clé détenue par le serveur) dans SharedDiagnostic.situation quand la personne partage son dossier',
                ],
                sous_traitants: [vercel, 'Neon pour la copie partagée (prévu)'],
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
                finalite: 'Prise, modification, annulation de rendez-vous avec une structure',
                base_legale_proposee: 'Art. 6.1.b — à valider',
                categories_donnees: ['Nom', 'Téléphone', 'E-mail', 'Notes (art. 9 possible)', 'Créneau, mode'],
                categories_personnes: ['Citoyens', 'Bénéficiaires inscrits par une structure', 'Professionnels'],
                destinataires: ['La structure et la personne'],
                sous_traitants: [vercel, neon],
                conservation: [cron('Rendez-vous (nom, téléphone, e-mail, notes)', 'APPOINTMENT_ANON_DAYS', 'anonymisation après {j} jours')],
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
                base_legale_proposee: 'Intérêt légitime (art. 6.1.f) avec opposition possible — à valider',
                categories_donnees: ['Message', 'Intention détectée', 'Mode de recherche', 'Identifiant de session', 'Note et commentaire facultatifs', 'Métriques techniques'],
                categories_personnes: ['Utilisateurs de l\'assistant'],
                destinataires: ['Aucun tiers — modèle local'],
                modele_ia: 'Ollama local (qwen3:8b, nomic-embed-text), joint uniquement en boucle locale (127.0.0.1)',
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
                statut: 'actif dans le bundle (sauf mode mock)',
                finalite: 'Mesurer l\'audience (Vercel Analytics) et la performance (Vercel Speed Insights)',
                base_legale_proposee: 'Art. 6.1.f, exemption de consentement si les conditions CNIL sont réunies (non vérifié)',
                categories_donnees: ['Pages vues', 'Métriques de performance', 'Données techniques du navigateur'],
                categories_personnes: ['Visiteurs'],
                destinataires: ['Vercel (sous-traitant)'],
                sous_traitants: ['Vercel Analytics et Speed Insights'],
                conservation: [texte('Données d\'audience', NON_VERIFIE, 'durée réglée par Vercel, non vérifiée')],
                mesures_securite: NON_VERIFIE,
            },
        ],
        sous_traitants: [
            { nom: 'Vercel', role: 'Hébergement front et fonctions serveur, cron', statut: 'prévu', localisation: 'UE — région fra1 (Francfort) pour les fonctions', entite_contractante: 'Vercel Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Vercel Analytics + Speed Insights', role: 'Audience et performance', statut: 'activé (bundle, sauf mode mock)', localisation: NON_VERIFIE, entite_contractante: 'Vercel Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Neon', role: 'Base de données PostgreSQL', statut: 'prévu', localisation: NON_VERIFIE, entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Upstash', role: 'Limitation de débit (KV/Redis)', statut: 'prévu', localisation: NON_VERIFIE, entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Stockage objet S3/R2 (fournisseur à confirmer)', role: 'Coffre, pièces jointes (fichiers chiffrés par enveloppe)', statut: 'prévu', localisation: 'non choisie', entite_contractante: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Sentry (Functional Software Inc.)', role: 'Erreurs serveur et navigateur, Session Replay (1 % / 10 % en erreur), traces 10 %', statut: 'activé si un DSN est configuré', localisation: NON_VERIFIE, entite_contractante: 'Functional Software Inc. (USA)', mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Mailjet (Sinch)', role: 'E-mails transactionnels', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Twilio', role: 'SMS', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
            { nom: 'Microsoft (Outlook / Graph)', role: 'Agenda des professionnels', statut: 'non activé', localisation: NON_VERIFIE, mecanisme_transfert: NON_VERIFIE, dpa: DPA_INCONNU },
        ],
        services_non_destinataires: [
            { nom: 'Google (Gemini API)', statut: 'bloqué', motif: 'Refusé par la politique IA du code (api/lib/ai-policy.js, BLOCKED_PENDING_PROVIDER_REVIEW) ; aucune donnée transmise ; pas un destinataire ni un sous-traitant', dpa: 'aucun' },
            { nom: 'Ollama (qwen3:8b, nomic-embed-text)', statut: 'activé en local', motif: 'Modèle de l\'assistant, exécuté sur la même machine (127.0.0.1) ; aucun transfert ; pas un sous-traitant tant qu\'il n\'est pas hébergé par un tiers' },
            { nom: 'OpenFisca (API publique)', statut: 'refusé en production', motif: 'Prototype de développement uniquement' },
            { nom: 'SIAO', statut: 'désactivé', motif: 'SIAO_ENABLED off ; aucune convention' },
        ],
        transferts_hors_ue: 'Aucun mécanisme de transfert vérifié (statut DPF NON VÉRIFIÉ pour tous les prestataires) ; aucun contrat art. 28 démontré',
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
