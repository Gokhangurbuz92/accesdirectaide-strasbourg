import { Link, useLocation } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { publicContactEmail } from '@/lib/contactEmail';
import i18n, { useT } from '@/i18n';
import { Clock } from 'lucide-react';
import { accountsOpened, personalSurfacesOpened } from '@/lib/publicBeta';

const BETA_ACTION = 'inline-flex min-h-11 items-center rounded-xl border border-ada-line-strong bg-ada-surface px-4 py-2 text-sm font-semibold text-ada-ink hover:bg-ada-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent focus-visible:ring-offset-2';
const BETA_ACTION_PRIMARY = 'inline-flex min-h-11 items-center rounded-xl bg-ada-action px-4 py-2 text-sm font-semibold text-white hover:bg-ada-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent focus-visible:ring-offset-2';

/** Discreet, always-visible notice of the restricted public beta (owner directive 29/10/2026). */
export function PublicBetaBanner() {
  useT('layout');   // re-renders the notice when the interface language changes
  return (
    <div role="note" data-testid="public-beta-banner" className="w-full bg-amber-50 border-b border-amber-200 text-amber-950 text-xs sm:text-sm">
      {/* R26: one short line — what works, what is not open yet, who decides (it used to fill three lines on a phone) */}
      <p className="max-w-7xl mx-auto px-4 py-1.5 sm:px-6 lg:px-8">
        {/* R47: a build that opens accounts, appointments or documents (VITE_PUBLIC_BETA_OPEN_SURFACES) no longer says they are « not open yet » */}
        {personalSurfacesOpened() ? <PartialBetaBannerText /> : <Trans i18n={i18n} i18nKey="layout:beta.banner" defaults="<strong>Bêta publique</strong> · Aides, démarches et lieux vérifiés sur sources officielles. Comptes, rendez-vous et documents : pas encore ouverts. Seul l’organisme concerné décide de vos droits." />}
      </p>
    </div>
  );
}

/** R47: the banner line once some personal-data surfaces are opened by the build (same length and tone as the default line) */
function PartialBetaBannerText() {
  return <Trans i18n={i18n} i18nKey="layout:beta.banner_partial" defaults="<strong>Bêta publique</strong> · Aides, démarches et lieux vérifiés sur sources officielles. Certaines fonctions ouvrent progressivement. Seul l’organisme concerné décide de vos droits." />;
}

/** Shown instead of a screen that needs an account, a booking, a document or a form while the beta is restricted. */
export function PublicBetaUnavailable() {
  const { t } = useT('layout');
  const { pathname } = useLocation();
  // the contact form is closed, not the contact: the published address (mentions légales) is given instead of a dead end
  const email = publicContactEmail();
  const contact = /^\/contact(\/|$)/.test(pathname || '');
  return (
    <section data-testid="public-beta-unavailable" aria-labelledby="beta-unavailable-title" className="mx-auto w-full max-w-3xl px-[var(--ada-gutter)] py-12 sm:py-16">
      {/* UI modernisation: one calm card (icon, title, explanation, three ways forward) instead of bare text on the page background */}
      <div className="rounded-2xl border border-ada-line bg-ada-surface p-6 text-ada-ink-2 shadow-sm sm:p-10">
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800" aria-hidden="true"><Clock className="h-6 w-6" /></span>
      <h1 id="beta-unavailable-title" className="text-2xl font-bold tracking-tight text-ada-ink sm:text-3xl mb-4">{t('layout:beta.closed.title', 'Cette fonction n’est pas encore ouverte')}</h1>
      <p className="mb-3">
        <Trans i18n={i18n} i18nKey="layout:beta.closed.intro" defaults="Accès Direct Aide est en <strong>bêta publique</strong>. Pendant cette phase, vous pouvez consulter les aides, les démarches et les structures vérifiées, avec leurs sources officielles." />
      </p>
      <p className="mb-6" data-testid="public-beta-later">
        {/* 6B (18/11): once this build opens the personal accounts, the closed screens no longer say that creating an account « will open later » */}
        {accountsOpened() ? (
          <Trans
            i18n={i18n}
            i18nKey="layout:beta.closed.later_accounts"
            defaults="Vous pouvez déjà créer un compte personnel et vous y connecter. La prise de rendez-vous, la messagerie, le partage de dossier, l’envoi de documents et les formulaires de contact ouvriront plus tard, quand les garanties de protection des données seront en place. Cette page ne vous demande aucune information ; le traitement de vos données est expliqué sur la page <0>Confidentialité</0>."
            components={[<Link key="privacy" to="/confidentialite" className="underline font-medium" />]}
          />
        ) : (
        <Trans
          i18n={i18n}
          i18nKey="layout:beta.closed.later"
          defaults="La création de compte, l’espace personnel, la prise de rendez-vous, le partage de dossier, l’envoi de documents et les formulaires de contact ouvriront plus tard, quand les garanties de protection des données seront en place. Rien ne vous est demandé ici : seules des données techniques sont traitées (adresse IP dans les journaux de l’hébergeur, cookie de sécurité), comme l’explique la page <0>Confidentialité</0>."
          components={[<Link key="privacy" to="/confidentialite" className="underline font-medium" />]}
        />
        )}
      </p>
      {contact && email && (
        <p className="mb-6" data-testid="public-beta-contact">
          <Trans
            i18n={i18n}
            i18nKey="layout:beta.closed.contact"
            defaults="Pour une question ou pour signaler une erreur, écrivez-nous à <0>{{email}}</0>. N’écrivez pas d’informations personnelles sensibles (santé, numéro de sécurité sociale, documents)."
            values={{ email }}
            components={[<a key="email" href={`mailto:${email}`} className="underline font-medium">{email}</a>]}
          />
        </p>
      )}
      <p className="flex flex-wrap gap-3 border-t border-ada-line pt-6">
        <Link to="/aides" className={BETA_ACTION_PRIMARY}>{t('layout:beta.closed.aides', 'Rechercher une aide')}</Link>
        <Link to="/demarches" className={BETA_ACTION}>{t('layout:beta.closed.demarches', 'Voir les démarches')}</Link>
        <Link to="/structures" className={BETA_ACTION}>{t('layout:beta.closed.structures', 'Trouver une structure')}</Link>
      </p>
      </div>
    </section>
  );
}
