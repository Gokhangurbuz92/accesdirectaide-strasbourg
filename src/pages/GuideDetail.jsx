// @ts-nocheck

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import { Printer, ArrowRight } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import LazyImage from '@/components/ui/LazyImage';
import LoadError from '@/components/LoadError';
import OfficialText from '@/components/guides/OfficialText';
import PageHeader from '@/components/layout/PageHeader';
import ContentTranslationNotice from '@/components/i18n/ContentTranslationNotice';
import useContentTranslation from '@/hooks/useContentTranslation';
import i18n, { formatDate, useT } from '@/i18n';
import { guideNextSteps } from '@/config/guideNextSteps';

const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; } };
// R28: a guide is either the editorial step list, or an official Service-Public sheet reproduced without change ({ version: 'official-sheet-v1', intro, steps, provenance })
const stepsOf = (raw) => { const v = parse(raw); return Array.isArray(v) ? v : Array.isArray(v?.steps) ? v.steps : []; };
const officialOf = (raw) => { const v = parse(raw); return v && v.version === 'official-sheet-v1' ? v : null; };
// R32: the day in the interface language (« 30 octobre 2026 », « 30 October 2026 »…), Paris time; null when there is none
const dayOf = (d) => formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' }) || null;

export default function GuideDetail() {
    const { slug } = useParams();
    const { t } = useT('guides');
    const [guide, setGuide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
    // R32: the guide's own text (title, summary, body) — French, marked lang="fr", until a verified translation may be shown
    const tr = useContentTranslation('guide', guide);

    useEffect(() => {
        // an unknown or unpublished guide is 404 (« introuvable »); any other failure is said as a failure, with a retry
        setLoading(true); setFailed(false);
        fetch(`/api/guides?slug=${encodeURIComponent(slug)}`)
            .then(res => { if (res.status === 404) return null; if (!res.ok) throw new Error(`guide ${res.status}`); return res.json(); })
            .then(data => setGuide(data))
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, [slug, attempt]);

    if (loading) return <div className="p-8 text-center text-muted-foreground" role="status">{t('guides:detail.loading', 'Chargement…')}</div>;
    if (failed) return <div className="max-w-4xl mx-auto px-4 py-8"><LoadError what={t('guides:detail.load_what', 'ce guide')} onRetry={() => setAttempt((n) => n + 1)} testId="guide-error" headingLevel={1} /></div>;
    if (!guide) return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <EmptyState
                headingLevel={1}
                title={t('guides:detail.not_found.title', 'Guide introuvable')}
                description={t('guides:detail.not_found.text', "Cette page n'existe pas ou a été déplacée.")}
                actions={
                    <Link to="/bonnes-pratiques" className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
                        {t('guides:detail.not_found.back', 'Retour aux bonnes pratiques')}
                    </Link>
                }
            />
        </div>
    );

    const content = tr.value('contenu_json');
    const steps = stepsOf(content);
    const official = officialOf(content);
    const body = tr.attrs('contenu_json');
    const resume = tr.value('resume_falc');
    const checkedAt = dayOf(official?.provenance?.checkedAt);
    const changedAt = dayOf(official?.provenance?.importantChangeAt);

    // R29: the shared page header (title, category, audience) like every other public page; the article keeps the official text and its provenance
    const tags = [[tr.value('categorie'), 'categorie'], ...(tr.value('publics') || []).map((p) => [p, 'publics'])].filter(([tag]) => Boolean(tag));
    const next = guideNextSteps(guide, t);
    return (
        <div className="min-h-screen bg-slate-50 pb-16 print:bg-white print:pb-0">
            <SEO
                title={t('guides:detail.seo_title', '{{title}} - Bonnes Pratiques', { title: tr.value('titre') })}
                description={official?.intro || resume || t('guides:detail.seo_description', 'Guide de bonnes pratiques')}
                path={`/bonnes-pratiques/${slug}`}
            />
            <PageHeader title={<span {...tr.attrs('titre')}>{tr.value('titre')}</span>} eyebrow={official ? t('guides:detail.eyebrow_official', 'Guide pratique · fiche officielle') : t('guides:detail.eyebrow', 'Guide pratique')} width="reading" titleId="guide-title">
                {tags.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label={t('guides:detail.tags_label', 'Thème et public')}>
                        {tags.map(([tag, field]) => <li key={tag} className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white" {...tr.attrs(field)}>{tag}</li>)}
                    </ul>
                )}
            </PageHeader>
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 print:p-0 print:max-w-none">
            <ContentTranslationNotice translation={tr} className="mb-6" />
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6 print:hidden">
                <Link to="/bonnes-pratiques" className="font-medium text-blue-700 hover:underline">
                    <span className="inline-block rtl-flip" aria-hidden="true">&larr;</span> {t('guides:detail.back_all', 'Tous les guides pratiques')}
                </Link>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
                >
                    <Printer size={18} aria-hidden="true" />
                    {t('guides:detail.print', 'Imprimer la fiche')}
                </button>
            </div>
            <article className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm print:shadow-none print:border-0 print:p-0" data-testid="guide-detail" aria-labelledby="guide-title">
                <header className="mb-8 border-b pb-6">
                    <p className="hidden text-3xl font-bold text-gray-900 mb-4 print:block" {...tr.attrs('titre')}>{tr.value('titre')}</p>

                    {official && (
                        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-slate-800" data-testid="guide-official-provenance">
                            <p><Trans i18n={i18n} i18nKey="guides:detail.official_text" defaults="<strong>Texte officiel de Service-Public.gouv.fr</strong>, repris sans modification (Licence Ouverte 2.0)." components={{ strong: <strong /> }} />
                                {checkedAt && <> {t('guides:detail.checked_on', 'Vérifié le {{date}}', { date: checkedAt })}</>}
                                {changedAt && <>{t('guides:detail.important_change', ' ; dernière modification importante de la fiche : {{date}}', { date: changedAt })}</>}.</p>
                            {official.provenance?.sourceUrl && (
                                <a href={official.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-blue-700 hover:underline">
                                    {t('guides:detail.read_sheet', 'Lire la fiche sur service-public.gouv.fr')}<span className="sr-only"> {t('guides:detail.new_tab', '(nouvel onglet)')}</span>
                                </a>
                            )}
                            <p className="mt-2 text-slate-600">{t('guides:detail.general_rules', 'Cette fiche explique les règles générales : seul l’organisme concerné décide de votre situation.')}</p>
                        </div>
                    )}
                    {official?.intro && <p className="mt-4 text-lg text-slate-800" data-testid="guide-intro" {...body}>{official.intro}</p>}
                    {resume && (
                        <div className="bg-yellow-50 border-s-4 border-yellow-400 p-4 text-lg text-gray-800 font-medium">
                            <span className="block text-sm uppercase text-yellow-700 mb-1 font-bold">{t('guides:detail.easy_summary', 'Résumé facile à lire :')}</span>
                            <span {...tr.attrs('resume_falc')}>{resume}</span>
                        </div>
                    )}
                </header>

                <div className="space-y-8">
                    {Array.isArray(steps) && steps.map((step, idx) => (
                        <section key={idx} className="print:break-inside-avoid" data-testid="guide-step">
                            {step.titre && (official
                                ? <h2 className="text-xl font-bold text-blue-900 mb-3" {...body}>{step.titre}</h2>
                                : <h3 className="text-2xl font-bold text-blue-900 mb-3" {...body}>{idx + 1}. {step.titre}</h3>)}
                            {step.texte && (official ? <OfficialText text={step.texte} {...body} /> : <div className="prose max-w-none text-gray-700 whitespace-pre-line" {...body}>{step.texte}</div>)}
                            {step.image && (
                                <LazyImage src={step.image} alt="" className="mt-4 rounded shadow max-w-full md:max-w-md" />
                            )}
                        </section>
                    ))}

                    {steps.length === 0 && !resume && (
                        <p className="text-gray-500 italic">{t('guides:detail.in_progress', 'Contenu en cours de rédaction.')}</p>
                    )}
                </div>

                {(guide.sources_urls?.length > 0) && (
                    <footer className="mt-12 pt-6 border-t text-sm text-gray-500">
                        <h4 className="font-bold mb-2">{t('guides:detail.sources', 'Sources :')}</h4>
                        <ul className="list-disc ps-5">
                            {guide.sources_urls.map((/** @type {string} */ url, i) => (
                                <li key={i}><a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-800">{url}</a></li>
                            ))}
                        </ul>
                    </footer>
                )}
            </article>
            {next.length > 0 && (
                <section aria-labelledby="guide-next" className="mt-8 print:hidden" data-testid="guide-next-steps">
                    <h2 id="guide-next" className="text-lg font-semibold text-slate-900">{t('guides:detail.next_title', 'Et ensuite ? Agir près de chez vous')}</h2>
                    <ul className="mt-4 grid gap-4 sm:grid-cols-3">
                        {next.map((n) => (
                            <li key={n.to}>
                                <Link to={n.to} className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                                    <span className="font-semibold text-slate-900 group-hover:text-blue-700">{n.label}</span>
                                    <span className="mt-1 flex-1 text-sm text-slate-600">{n.text}</span>
                                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-700" aria-hidden="true">{t('guides:detail.next_see', 'Voir')} <ArrowRight className="h-4 w-4 rtl-flip" /></span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            </div>
        </div>
    );
}
