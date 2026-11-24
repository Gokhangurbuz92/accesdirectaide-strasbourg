import { Trans } from 'react-i18next';
import { errorTrackingActive, frontendEnv } from '@/config/env';
import i18n, { useT } from '@/i18n';
import { publicContactEmail } from '@/lib/contactEmail';
import { Link } from 'react-router-dom';
import { accountsOpened, assistantOpened, bookingOpened } from '@/lib/publicBeta';

/**
 * R26: on the privacy, security, cookie and terms pages, what is actually processed TODAY during the restricted public beta — the rest of each page also
 * describes functions that are built but not open yet (accounts, dossiers, messages, documents, appointments, assistant), which must not read as current.
 * R32: translated (namespace « legal »); the French text stays the reference.
 */
export default function BetaProcessingNotice() {
  const { t } = useT('legal');
  if (!frontendEnv.flags.publicBeta) return null;
  const email = publicContactEmail();
  const accounts = accountsOpened();   // V2: personal accounts open in this build
  // R3H (live audit 24/11/2026): with appointments and the citizen assistant opened, this notice still listed both as « not open »
  const rdv = accounts && bookingOpened(true);
  const assistant = assistantOpened(true);
  const errors = errorTrackingActive();   // R5-S1: Sentry EU (errors only) active in this build — no longer listed as « not open »
  const notice = <Link key="notice" to="/confidentialite/notice" className="underline underline-offset-2" />;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm" aria-labelledby="beta-processing-title" data-testid="beta-processing-notice">
      <h2 id="beta-processing-title" className="text-lg font-semibold">{t('legal:beta.title', 'Ce qui est traité aujourd’hui, pendant la bêta publique')}</h2>
      <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm leading-relaxed">
        <li>{t('legal:beta.reading', 'Vous lisez les fiches sans compte : aucune donnée personnelle ne vous est demandée.')}</li>
        {accounts
          ? <li>{t('legal:beta.logs_accounts', "L’hébergeur (Vercel) garde des journaux techniques, dont l’adresse IP, pendant un jour ; la limitation de débit (Upstash) garde des compteurs par adresse IP et, pour la connexion, la création de compte et l’envoi de liens, par empreinte de l’adresse électronique (jamais l’adresse elle-même), pendant une heure au plus.")}</li>
          : <li>{t('legal:beta.logs', 'L’hébergeur (Vercel) garde des journaux techniques, dont l’adresse IP, pendant un jour ; la limitation de débit (Upstash) garde un compteur par adresse IP pendant quelques minutes.')}</li>}
        {accounts && (
          <li data-testid="beta-accounts-open">
            <Trans i18n={i18n} i18nKey="legal:beta.accounts" defaults="Si vous créez un compte personnel, ce qui est traité, pourquoi et combien de temps est décrit dans la <0>notice des comptes</0>. Les e-mails du compte (confirmation de l’adresse, mot de passe) sont envoyés par Mailjet (groupe Sinch), avec des données hébergées dans l’Union européenne."
              components={[<Link key="notice" to="/confidentialite/notice" className="underline underline-offset-2" />]} />
          </li>
        )}
        <li>
          <Trans i18n={i18n} i18nKey="legal:beta.browser" defaults="Votre navigateur garde un cookie de sécurité (<0>__csrf</0>) et, si vous les changez, vos réglages d’affichage."
            components={[<code key="csrf" />]} />
        </li>
        {rdv && (
          <li data-testid="beta-rdv-open">
            <Trans i18n={i18n} i18nKey="legal:beta.open_rdv" defaults="Les demandes de rendez-vous sont ouvertes (avec un compte personnel) : ce qui est transmis à la structure et combien de temps c’est gardé est décrit dans la <0>notice des comptes</0>."
              components={[notice]} />
          </li>
        )}
        {assistant && (
          <li data-testid="beta-assistant-open">
            <Trans i18n={i18n} i18nKey="legal:beta.open_assistant" defaults="L’assistant citoyen est ouvert : aucune conversation n’est enregistrée ; le prestataire qui produit les réponses est indiqué dans la <0>notice des comptes</0>."
              components={[notice]} />
          </li>
        )}
        {errors && (
          <li data-testid="beta-errors-on">
            <Trans i18n={i18n} i18nKey="legal:beta.errors_on" defaults="Le suivi des erreurs techniques (Sentry, données stockées dans l’Union européenne) est actif : quand une erreur se produit, sa description est envoyée sans votre e-mail, votre adresse IP ni ce que vous tapez ; détails dans la <0>politique de confidentialité</0>."
              components={[<Link key="privacy" to="/politique-confidentialite" className="underline underline-offset-2" />]} />
          </li>
        )}
        {email && <li>{t('legal:beta.email', 'Si vous nous écrivez à {{email}}, votre message est reçu dans notre messagerie (Microsoft Outlook) et sert seulement à vous répondre.', { email })}</li>}
      </ul>
      <p className="mt-3 text-sm leading-relaxed">
        {accounts && rdv && assistant
          ? (errors
                    ? <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_rdv_assistant_errorsOn" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents et mesure d’audience. Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />
                    : <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_rdv_assistant" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, mesure d’audience et suivi des erreurs (Sentry). Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />)
          : accounts && rdv
          ? (errors
                    ? <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_rdv_errorsOn" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, assistant et mesure d’audience. Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />
                    : <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_rdv" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, assistant, mesure d’audience et suivi des erreurs (Sentry). Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />)
          : accounts && assistant
          ? (errors
                    ? <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_assistant_errorsOn" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, rendez-vous et mesure d’audience. Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />
                    : <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_assistant" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, rendez-vous, mesure d’audience et suivi des erreurs (Sentry). Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />)
          : accounts
          ? (errors
                    ? <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts_errorsOn" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, rendez-vous, assistant et mesure d’audience. Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />
                    : <Trans i18n={i18n} i18nKey="legal:beta.closed_accounts" defaults="Ne sont <strong>pas</strong> ouverts : dossiers, messages, documents, rendez-vous, assistant, mesure d’audience et suivi des erreurs (Sentry). Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />)
          : (errors
                    ? <Trans i18n={i18n} i18nKey="legal:beta.closed_errorsOn" defaults="Ne sont <strong>pas</strong> ouverts : comptes, dossiers, messages, documents, rendez-vous, assistant et mesure d’audience. Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />
                    : <Trans i18n={i18n} i18nKey="legal:beta.closed" defaults="Ne sont <strong>pas</strong> ouverts : comptes, dossiers, messages, documents, rendez-vous, assistant, mesure d’audience et suivi des erreurs (Sentry). Les passages de cette page qui les décrivent s’appliqueront à leur ouverture." />)}
      </p>
    </section>
  );
}
