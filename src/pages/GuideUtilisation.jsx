import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { ArrowRight, BookOpen, LogIn, MapPin } from 'lucide-react';
import SEO from '@/components/SEO';
import { useT } from '@/i18n';
import { PAGE } from '@/design/layout';
import { TONES } from '@/design/categoryTone';
import { ToneBar, ToneChip, ToneIcon } from '@/components/ui/Tone';
import { buildGuide } from '@/components/help/guideContent';
import { helpLinks } from '@/components/help/helpRoutes';
import EmergencyNumbers from '@/components/help/EmergencyNumbers';

/**
 * « Guide d’utilisation » — step cards for each part of the site, with a table of contents and « Où le trouver » links to the real screens.
 * Two addresses, one component: /guide (public, no account: the steps that need an account are marked « Après connexion ») and /compte/guide (inside
 * the account area; same beta rule as the other account screens, src/lib/publicBeta.js). Content: src/components/help/guideContent.js.
 * @param {{ account?: boolean }} props
 */
export default function GuideUtilisation({ account = false }) {
  const { t } = useT('help');
  const sections = useMemo(() => buildGuide(t), [t]);
  return (
    <div className="min-h-screen bg-white" data-testid={account ? 'guide-page-account' : 'guide-page'}>
      <SEO
        title={t('help:guide.seo.title', 'Guide d’utilisation')}
        description={t('help:guide.seo.description', 'Comment utiliser AccesDirectAide pas à pas : chercher, lire une fiche, Mon Espace, rendez-vous, accessibilité, langues et urgence.')}
        path={account ? '/compte/guide' : '/guide'}
        noindex={account}
      />
      <header className="border-b border-slate-200 bg-slate-50">
        <div className={`${PAGE} py-10 sm:py-12`}>
          <div className="flex items-start gap-4">
            <ToneIcon tone={TONES.teal} icon={BookOpen} size="lg" />
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t('help:guide.title', 'Guide d’utilisation')}</h1>
              <p className="mt-3 max-w-3xl text-base text-slate-700">{t('help:guide.intro', 'Chaque partie du site expliquée pas à pas, avec le lien pour la retrouver. Le site informe et oriente : seul l’organisme concerné décide de vos droits.')}</p>
              {!account && (
                <p className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 text-sm text-slate-700" data-testid="guide-account-note">
                  <ToneChip tone={TONES.violet}>{t('help:guide.after_login', 'Après connexion')}</ToneChip>
                  <span>{t('help:guide.after_login_note', 'Ces parties demandent un compte personnel. Pendant la bêta publique, elles ouvrent progressivement.')}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className={`${PAGE} py-10`}>
        <nav aria-labelledby="guide-toc-title" className="mb-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="guide-toc-title" className="mb-3 text-lg font-bold text-slate-900">{t('help:guide.toc', 'Sommaire')}</h2>
          <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#guide-${s.id}`} className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                  <ToneIcon tone={s.tone} icon={s.icon} size="sm" className="h-7 w-7" />
                  <span><span className="sr-only">{`${i + 1}. `}</span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
          {sections.map((s) => {
            const links = helpLinks(t, s.where);
            return (
              <section key={s.id} id={`guide-${s.id}`} aria-labelledby={`guide-${s.id}-title`} className="relative flex scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="guide-section">
                <ToneBar tone={s.tone} />
                <div className="flex items-start gap-3">
                  <ToneIcon tone={s.tone} icon={s.icon} size="lg" />
                  <div className="min-w-0">
                    <h2 id={`guide-${s.id}-title`} className="text-xl font-bold text-slate-900">{s.title}</h2>
                    {s.account && !account && (
                      <ToneChip tone={TONES.violet} className="mt-1.5 gap-1"><LogIn className="h-3.5 w-3.5" aria-hidden="true" />{t('help:guide.after_login', 'Après connexion')}</ToneChip>
                    )}
                  </div>
                </div>
                <ol className="mt-4 space-y-3">
                  {s.steps.map((step, i) => (
                    <li key={step} className="flex gap-3">
                      <span aria-hidden="true" className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.tone.tile}`}>{i + 1}</span>
                      <span className="text-slate-700">{step}</span>
                    </li>
                  ))}
                </ol>
                {s.emergency && <EmergencyNumbers testid="guide-emergency" />}
                {links.length > 0 && (
                  <div className="mt-auto pt-5">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><MapPin className="h-4 w-4 text-slate-500" aria-hidden="true" />{t('help:guide.where', 'Où le trouver')}</h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {links.map((l) => (
                        <li key={l.to}>
                          <Link to={l.to} data-testid="guide-link" className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${s.tone.chip}`}>
                            {l.label}<ArrowRight className="rtl-flip h-4 w-4" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside className="relative mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-6" aria-labelledby="guide-more-title">
          <ToneBar tone={TONES.sky} />
          <h2 id="guide-more-title" className="text-xl font-bold text-slate-900">{t('help:guide.more.title', 'Encore une question ?')}</h2>
          <p className="mt-2 text-slate-700">{t('help:guide.more.text', 'Les questions fréquentes répondent aux questions les plus courantes.')}</p>
          <Link to="/questions-frequentes" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" data-testid="guide-faq-link">
            {t('help:guide.more.faq', 'Voir les questions fréquentes')}<ArrowRight className="rtl-flip h-4 w-4" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}

GuideUtilisation.propTypes = { account: PropTypes.bool };
