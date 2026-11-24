import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronDown, Search } from 'lucide-react';
import SEO from '@/components/SEO';
import { useT } from '@/i18n';
import { PAGE } from '@/design/layout';
import { TONES } from '@/design/categoryTone';
import { ToneBar, ToneIcon } from '@/components/ui/Tone';
import { generateFAQSchema } from '@/lib/jsonld';
import { buildFaq } from '@/components/help/faqContent';
import { foldText, helpLinks } from '@/components/help/helpRoutes';
import EmergencyNumbers from '@/components/help/EmergencyNumbers';

/**
 * « Questions fréquentes » (/questions-frequentes; /faq redirects here) — the questions people ask about the site, in sections. Native
 * <details>/<summary> accordions (keyboard and screen readers for free), a search box that filters the questions in the browser, a section menu that
 * stays visible on a wide screen, and the FAQPage structured data. Content: src/components/help/faqContent.js.
 */
export default function QuestionsFrequentes() {
  const { t } = useT('help');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const sections = useMemo(() => buildFaq(t), [t]);
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const shown = sections
    .map((s) => ({ ...s, items: words.length ? s.items.filter((it) => { const hay = foldText(`${it.q} ${it.a} ${s.title}`); return words.every((w) => hay.includes(w)); }) : s.items }))
    .filter((s) => s.items.length > 0);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const found = shown.reduce((n, s) => n + s.items.length, 0);
  const schema = useMemo(() => generateFAQSchema(sections.flatMap((s) => s.items.map((it) => ({ question: it.q, answer: it.a })))), [sections]);

  return (
    <div className="min-h-screen bg-white" data-testid="faq-page">
      <SEO
        title={t('help:faq.seo.title', 'Questions fréquentes')}
        description={t('help:faq.seo.description', 'Les réponses aux questions sur AccesDirectAide : trouver une aide, les sources, le compte, les rendez-vous, les données personnelles, l’accessibilité et l’urgence.')}
        path="/questions-frequentes"
        schema={schema}
      />
      <header className="border-b border-slate-200 bg-slate-50">
        <div className={`${PAGE} py-10 sm:py-12`}>
          <div className="flex items-start gap-4">
            <ToneIcon tone={TONES.sky} icon={BookOpen} size="lg" />
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t('help:faq.title', 'Questions fréquentes')}</h1>
              <p className="mt-3 max-w-3xl text-base text-slate-700">{t('help:faq.intro', 'Les réponses aux questions les plus courantes sur AccesDirectAide. Le site informe et oriente : seul l’organisme concerné décide de vos droits.')}</p>
            </div>
          </div>
          <form role="search" className="mt-6 max-w-2xl" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor={searchId} className="mb-1.5 block text-sm font-semibold text-slate-900">{t('help:faq.search.label', 'Chercher dans les questions')}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('help:faq.search.placeholder', 'Ex : rendez-vous, mot de passe, langue')}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pe-3 ps-10 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                data-testid="faq-search"
              />
            </div>
            <p className="mt-2 text-sm text-slate-700" role="status" aria-live="polite" data-testid="faq-count">
              {words.length
                ? t('help:faq.search.found', '{{found}} question(s) sur {{total}} correspondent à votre recherche.', { found, total })
                : t('help:faq.search.total', '{{total}} questions, classées par thème.', { total })}
            </p>
          </form>
        </div>
      </header>

      <div className={`${PAGE} py-10`}>
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-labelledby="faq-menu-title" className="mb-8 lg:mb-0">
            <div className="lg:sticky lg:top-24">
              <h2 id="faq-menu-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">{t('help:faq.menu', 'Thèmes')}</h2>
              <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#faq-${s.id}`} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:border-transparent">
                      <ToneIcon tone={s.tone} icon={s.icon} size="sm" className="h-7 w-7" />
                      <span>{s.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="min-w-0 max-w-3xl">
            {shown.length === 0 && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-slate-800" data-testid="faq-empty">
                {t('help:faq.search.none', 'Aucune question ne correspond. Essayez un autre mot, ou consultez le guide d’utilisation.')}
              </p>
            )}
            {shown.map((s) => (
              <section key={s.id} id={`faq-${s.id}`} aria-labelledby={`faq-${s.id}-title`} className="mb-10 scroll-mt-24" data-testid="faq-section">
                <h2 id={`faq-${s.id}-title`} className="mb-4 flex items-center gap-3 text-2xl font-bold text-slate-900">
                  <ToneIcon tone={s.tone} icon={s.icon} />
                  <span>{s.title}</span>
                </h2>
                <div className="space-y-3">
                  {s.items.map((it) => {
                    const links = helpLinks(t, it.links);
                    return (
                      <details key={`${it.id}-${words.length ? 'q' : 'all'}`} open={words.length > 0 || undefined} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="faq-item">
                        <ToneBar tone={s.tone} side="start" />
                        <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 px-5 py-4 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 [&::-webkit-details-marker]:hidden">
                          <span>{it.q}</span>
                          <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                        </summary>
                        <div className="px-5 pb-5 text-slate-700">
                          <p>{it.a}</p>
                          {it.emergency && <EmergencyNumbers testid="faq-emergency" />}
                          {links.length > 0 && (
                            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                              {links.map((l) => (
                                <Link key={l.to} to={l.to} className="inline-flex min-h-6 items-center gap-1 font-semibold text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
                                  {l.label}<ArrowRight className="rtl-flip h-4 w-4" aria-hidden="true" />
                                </Link>
                              ))}
                            </p>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </section>
            ))}

            <aside className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-6" aria-labelledby="faq-more-title">
              <ToneBar tone={TONES.teal} />
              <h2 id="faq-more-title" className="text-xl font-bold text-slate-900">{t('help:faq.more.title', 'Vous ne trouvez pas votre réponse ?')}</h2>
              <p className="mt-2 text-slate-700">{t('help:faq.more.text', 'Le guide d’utilisation explique pas à pas chaque partie du site.')}</p>
              <Link to="/guide" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" data-testid="faq-guide-link">
                {t('help:faq.more.guide', 'Ouvrir le guide d’utilisation')}<ArrowRight className="rtl-flip h-4 w-4" aria-hidden="true" />
              </Link>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
