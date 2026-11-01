import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { Trans } from 'react-i18next';
import i18n, { formatDate, useLanguage, useT } from '@/i18n';

const linkClass =
  'font-medium text-blue-700 underline decoration-2 underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2';

// the date of the statement (shown in the interface language: « 19 septembre 2026 », « 19 September 2026 »…)
const STATEMENT_DATE = '2026-09-19';

/**
 * The accessibility statement (a legal text). R32: it is translated word for word and stays as true as the French: not compliant, no audit carried
 * out. When the interface is not in French, it says that the French version is the reference.
 */
export default function Accessibilite() {
  const { t } = useT('accessibility');
  const { isSource } = useLanguage();
  return (
    <>
      {/* R7: the shared SEO component (canonical, social tags) like every other page; it set only a title and a description */}
      <SEO title={t('accessibility:seo_title', 'Accessibilité')} description={t('accessibility:seo_description', 'Déclaration d’accessibilité d’AccesDirectAide, état de conformité, contact et voies de recours.')} path="/accessibilite" />

      <PageHeader width="reading" titleId="accessibilite-title" eyebrow={t('accessibility:eyebrow', 'Accessibilité numérique')} title={t('accessibility:title', 'Déclaration d’accessibilité')} description={t('accessibility:description', 'État de conformité d’AccesDirectAide, contact et voies de recours.')} />
      <article
        className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8"
        aria-labelledby="accessibilite-title"
      >
        <header className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* R26 (owner directive 31/10/2026): only automated and technical checks exist — no formal RGAA audit is under way or scheduled, so none is announced */}
          <p id="accessibilite-status" className="text-lg font-semibold text-slate-900">
            {t('accessibility:status', 'Accessibilité : non conforme — aucun audit de conformité n’a encore été réalisé.')}
          </p>
          <p className="mt-3 leading-7 text-slate-700">
            {t('accessibility:status_detail', 'Aucun audit complet de conformité au RGAA n’a été réalisé ni programmé à ce jour : seuls des contrôles automatisés et des vérifications techniques sont faits pendant le développement. Aucun taux de conformité n’est donc publié. Cette page décrit l’état connu du service sans revendiquer une conformité qui n’a pas été auditée.')}
          </p>
          {!isSource && (
            <p className="mt-3 text-sm leading-6 text-slate-600" data-testid="accessibility-french-reference">
              {t('accessibility:french_reference', 'Cette déclaration est traduite pour vous aider à la lire. Seule la version en français fait foi.')}
            </p>
          )}
        </header>

        <div className="space-y-10 text-slate-800">
          <section aria-labelledby="engagement-title">
            <h2 id="engagement-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:commitment.title', 'Engagement d’AccesDirectAide')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:commitment.aim', 'AccesDirectAide vise un service utilisable par le plus grand nombre, notamment avec un clavier, un lecteur d’écran, un fort niveau de zoom et des contenus simplifiés lorsque cela est nécessaire.')}
            </p>
            <p className="mt-3 leading-7">
              {t('accessibility:commitment.standard', 'Le référentiel de travail retenu est le RGAA 4.1.2, en cohérence avec les critères WCAG 2.1 de niveau A et AA couverts par ce référentiel.')}
            </p>
          </section>

          <section aria-labelledby="conformite-title">
            <h2 id="conformite-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:compliance.title', 'État de conformité')}
            </h2>
            <p className="mt-3 leading-7">
              <Trans i18n={i18n} i18nKey="accessibility:compliance.text" defaults="AccesDirectAide est déclaré <0>non conforme</0> tant qu’un audit d’accessibilité complet et en cours de validité n’a pas permis de mesurer la conformité du service." components={[<strong key="status" />]} />
            </p>
          </section>

          <section aria-labelledby="tests-title">
            <h2 id="tests-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:checks.title', 'Contrôles faits pendant le développement')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:checks.text', 'Des contrôles automatisés et des vérifications techniques sont intégrés au développement. Ils ne remplacent pas un audit RGAA complet ni les vérifications humaines nécessaires, notamment au clavier et avec les technologies d’assistance.')}
            </p>
            <p className="mt-3 leading-7">
              {t('accessibility:checks.later', 'Les résultats détaillés, les éventuelles non-conformités, les dérogations et l’échantillon audité seront publiés après réalisation d’un audit formel.')}
            </p>
          </section>

          <section aria-labelledby="technologies-title">
            <h2 id="technologies-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:technologies.title', 'Technologies utilisées')}
            </h2>
            <ul className="mt-3 list-disc space-y-2 ps-6">
              <li>{t('accessibility:technologies.html', 'HTML sémantique')}</li>
              <li>CSS</li>
              <li>JavaScript</li>
              <li>React</li>
            </ul>
          </section>

          <section aria-labelledby="falc-title">
            <h2 id="falc-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:falc.title', 'Facile à lire et à comprendre (FALC)')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:falc.text', 'Les aides destinées au lancement disposent de contenus simplifiés dédiés. Le FALC complète les informations de référence : il ne remplace ni la source officielle ni les conditions juridiques applicables.')}
            </p>
          </section>

          <section aria-labelledby="contact-title">
            <h2 id="contact-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:contact.title', 'Retour d’information et contact')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:contact.text', 'Si vous ne parvenez pas à accéder à un contenu ou à utiliser une fonctionnalité, vous pouvez signaler le problème afin qu’une solution accessible ou une information équivalente puisse être recherchée.')}
            </p>
            <p className="mt-3">
              {t('accessibility:contact.email', 'Courriel :')}{' '}
              <a className={linkClass} href="mailto:contact@accesdirectaide.fr">
                contact@accesdirectaide.fr
              </a>
            </p>
          </section>

          <section aria-labelledby="recours-title">
            <h2 id="recours-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:recourse.title', 'Voies de recours')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:recourse.text', 'Si vous constatez un défaut d’accessibilité qui vous empêche d’accéder à un contenu ou à une fonctionnalité, que vous nous le signalez et que vous n’obtenez pas de réponse satisfaisante, vous pouvez saisir le Défenseur des droits.')}
            </p>
            <p className="mt-3">
              <a
                className={linkClass}
                href="https://formulaire.defenseurdesdroits.fr/"
              >
                {t('accessibility:recourse.link', 'Saisir le Défenseur des droits')}
              </a>
            </p>
          </section>

          <section aria-labelledby="amelioration-title">
            <h2 id="amelioration-title" className="text-2xl font-bold text-slate-950">
              {t('accessibility:improvement.title', 'Amélioration continue')}
            </h2>
            <p className="mt-3 leading-7">
              {t('accessibility:improvement.text', 'Le schéma pluriannuel et le plan d’actions d’accessibilité seront publiés avec des engagements vérifiables dès que leur périmètre aura été formalisé. Cette page sera mise à jour après l’audit et à chaque évolution significative.')}
            </p>
          </section>

          <p className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            {t('accessibility:updated', 'Déclaration mise à jour le {{date}}.', { date: formatDate(STATEMENT_DATE) })}
          </p>
        </div>
      </article>
    </>
  );
}
