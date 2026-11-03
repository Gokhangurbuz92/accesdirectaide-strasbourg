import { useState } from 'react';
import { officialInfoFor } from '@/lib/rightsInfoSources';
import { legalBasisFor } from '@/lib/legalArticles';
import { AlertCircle, CircleHelp, ClipboardCheck, CloudOff, SearchCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PROVENANCE_KEYS, readAssessment } from '@/lib/assessmentLabels';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { formatDate, useT } from '@/i18n';

/** @type {Record<string, import('lucide-react').LucideIcon>} */
const ICONS = {
    MISSING_INFORMATION: CircleHelp,
    CHECK_REQUIRED: ClipboardCheck,
    POSSIBLE: SearchCheck,
    UNSUPPORTED: AlertCircle,
    ENGINE_UNAVAILABLE: CloudOff,
};
const LINKABLE = ['CHECK_REQUIRED', 'POSSIBLE'];
const HEADINGS = /** @type {const} */ (['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** French text inside any interface language (the server's explanations, legal names, official page names): read with a French voice, left to right */
const FR = { lang: 'fr', dir: 'ltr' };
/** R40: the dates of the legal and official sources arrive as « jj/mm/aaaa » (frDate); outside French they are written the way the interface language writes a date */
const DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
function useDay() {
    const { i18n } = useT('diagnostic');
    return (/** @type {string} */ fr) => {
        const m = DAY.exec(fr || '');
        return m && i18n.language !== 'fr' ? formatDate(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`, { day: '2-digit', month: '2-digit', year: 'numeric' }) || fr : fr;
    };
}

/** @typedef {import('@/lib/assessmentLabels').AssessmentItem} AssessmentItem */
/** @typedef {NonNullable<ReturnType<typeof legalBasisFor>>['references'][number]} LegalBasisReference */

/**
 * DTA S1 stage 2b — renders the assessment contract (state + provenance), nothing else.
 * No amount, no total, no entitlement or inapplicability wording (see assessmentLabels.js). State = text + icon (never colour alone). FALC sentence first, full text and provenance in <details>.
 * `linkAides` adds a navigation link to the aide information page (it never states or implies entitlement).
 * R39: the frame is in the interface language (namespace `diagnostic`; states and facts from assessmentLabelsI18n.js); what the server wrote (label,
 * explanations, provenance) and the official names (legal references, pages, deciding bodies) stay French and are marked lang="fr".
 * @param {{ results: unknown, linkAides?: boolean, headingLevel?: 1 | 2 | 3 | 4 | 5 }} props
 */
export default function AssessmentView({ results, linkAides = false, headingLevel = 2 }) {
    const { t } = useT('diagnostic');
    const { items, rejected, usable } = readAssessment(results);
    const { groups, dataStatusBanner } = useAssessmentLabels();
    const H = HEADINGS[headingLevel - 1];
    const H3 = HEADINGS[headingLevel];

    if (!usable) {
        return (
            <section aria-labelledby="assessment-title" data-testid="assessment-unavailable" className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <H id="assessment-title" className="text-base font-bold text-amber-900">{t('diagnostic:assessment.unavailable_title', 'Résultat indisponible')}</H>
                <p className="mt-2 text-sm text-amber-900">
                    {rejected
                        ? t('diagnostic:assessment.unavailable_rejected', "Aucun résultat exploitable n'a été reçu (certains éléments ont été écartés car incomplets). Aucun résultat de remplacement n'est affiché. Réessayez plus tard ou demandez conseil à un professionnel.")
                        : t('diagnostic:assessment.unavailable_text', "Aucun résultat exploitable n'a été reçu. Aucun résultat de remplacement n'est affiché. Réessayez plus tard ou demandez conseil à un professionnel.")}
                </p>
            </section>
        );
    }

    return (
        <section aria-labelledby="assessment-title" data-testid="assessment-region" className="space-y-6">
            <div>
                <H id="assessment-title" className="text-lg font-bold text-slate-900">{t('diagnostic:assessment.title', "Pistes d'orientation")}</H>
                <p className="mt-1 text-sm text-slate-700">
                    {t('diagnostic:assessment.intro', "Ces pistes viennent d'une simulation locale non officielle. Elles ne disent pas si vous avez une aide. Seul l'organisme compétent peut décider.")}
                </p>
                <p data-testid="data-status-banner" className="mt-2 inline-block rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">{dataStatusBanner}</p>
            </div>
            {groups.map((g) => {
                const list = items.filter((i) => g.states.includes(i.state));
                if (!list.length) return null;
                return (
                    <div key={g.id} data-testid={`assessment-group-${g.id}`}>
                        <H3 className="mb-2 text-sm font-semibold text-slate-800">{g.title} ({list.length})</H3>
                        <ul className="space-y-3">
                            {list.map((it) => <ItemCard key={it.code} it={it} link={linkAides && LINKABLE.includes(it.state)} />)}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}

/** @param {{ it: AssessmentItem, link: boolean }} props */
function ItemCard({ it, link }) {
    const { t } = useT('diagnostic');
    const { state: STATE_LABELS, missingFactLabel } = useAssessmentLabels();
    const Icon = ICONS[it.state] || AlertCircle;
    const missing = it.missingFacts || [];
    const basis = it.basisFacts || [];
    return (
        <li data-testid={`assessment-item-${it.code}`} className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-slate-900" {...FR}>{it.label}</p>
                <span data-testid={`assessment-state-${it.code}`} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-900">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {STATE_LABELS[it.state]}
                </span>
            </div>
            <p className="mt-2 text-sm text-slate-800" {...FR}>{it.explanationFalc || it.explanation}</p>
            {it.state === 'MISSING_INFORMATION' && missing.length > 0 && (
                <p className="mt-2 text-sm text-slate-800">{t('diagnostic:item.to_specify', 'À préciser : {{facts}}.', { facts: missing.map(missingFactLabel).join(', ') })}</p>
            )}
            {it.whoToAsk && <p className="mt-2 text-sm font-medium text-slate-900">{t('diagnostic:item.who_to_ask', 'À demander à :')} <span {...FR}>{it.whoToAsk}</span>.</p>}
            <details className="mt-3 text-sm text-slate-800">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    {t('diagnostic:item.why', 'Pourquoi ce résultat ?')}
                </summary>
                {it.whyFalc && <p className="mt-2" data-testid={`why-falc-${it.code}`}><span className="font-semibold">{t('diagnostic:item.why_falc', 'En bref (facile à lire) :')} </span><span {...FR}>{it.whyFalc}</span></p>}
                <p className="mt-2" {...FR}>{it.explanation}</p>
                {it.whyFr && <p className="mt-2" data-testid={`why-${it.code}`} {...FR}>{it.whyFr}</p>}
                {basis.length > 0 && <p className="mt-2" data-testid={`why-basis-${it.code}`}>{t('diagnostic:item.basis', 'Réponses utilisées : {{facts}}.', { facts: basis.map(missingFactLabel).join(', ') })}</p>}
                <ul className="mt-2 list-disc space-y-1 ps-5" {...FR}>
                    {PROVENANCE_KEYS.map((k) => (
                        <li key={k} data-testid={`provenance-${it.code}-${k}`}>{it.provenance.display[k]}</li>
                    ))}
                </ul>
                <OfficialInfo code={it.code} />
            </details>
            {link && (
                <Link
                    to={`/aides/${encodeURIComponent(it.code)}`}
                    data-testid={`diagnostic-open-aide-${it.code}`}
                    className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                    {t('diagnostic:item.open_aide', "Voir la fiche d'information de cette aide")}
                </Link>
            )}
        </li>
    );
}

/** One cited reference: a button opens its list (no nested <details>: the result item is itself a <details>). @param {{ reference: LegalBasisReference }} props */
function LegalReference({ reference: r }) {
    const { t } = useT('diagnostic');
    const day = useDay();
    const [open, setOpen] = useState(false);
    const listId = `legal-${r.basis.replace(/[^A-Za-z0-9]+/g, '-')}`;
    const n = r.articles.length;
    const count = r.articles[0].kind === 'text'
        ? t('diagnostic:legal.texts', { count: n, defaultValue_one: '{{count}} texte', defaultValue_other: '{{count}} textes' })
        : t('diagnostic:legal.articles', { count: n, defaultValue_one: '{{count}} article', defaultValue_other: '{{count}} articles' });
    return (
        <>
            <button type="button" className="min-h-11 py-2 text-start text-slate-900 underline" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} data-testid="legal-reference-toggle">
                <span {...FR}>{r.basis}</span> — {count}
            </button>
            {open && (
                <ul id={listId} className="ms-4 mt-1 space-y-1">
                    {r.articles.map((a) => (
                        <li key={a.url}>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center py-2 text-indigo-800 underline">
                                {/* the official name of the text or article, in French (Légifrance) */}
                                <span {...FR}>{a.kind === 'text' ? a.num : `Article ${a.num}`}</span><span className="sr-only"> {t('diagnostic:legal.new_tab', '(Légifrance, nouvel onglet)')}</span>
                            </a>
                            {a.since && <span className="text-slate-700"> — {t('diagnostic:legal.since', 'version en vigueur depuis le {{date}}', { date: day(a.since) })}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

/** R16 / D15: the code articles behind the right (DILA LEGI), with the date each is in force from. An attachment to read, never the basis of the result. @param {{ code: string }} props */
function LegalTexts({ code }) {
    const { t } = useT('diagnostic');
    const day = useDay();
    const legal = legalBasisFor(code);
    if (!legal) return null;
    return (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3" data-testid={`legal-texts-${code}`}>
            <p className="font-semibold text-slate-900">
                {legal.referenceDate
                    ? t('diagnostic:legal.title_dated', 'Textes officiels (Légifrance), en vigueur au {{date}}', { date: day(legal.referenceDate) })
                    : t('diagnostic:legal.title', 'Textes officiels (Légifrance)')}
            </p>
            <ul className="mt-1 space-y-1">
                {legal.references.map((r) => (
                    <li key={r.basis}>
                        {r.attached ? (
                            <LegalReference reference={r} />
                        ) : (
                            <span className="text-slate-800" data-testid="legal-text-not-attached"><span {...FR}>{r.basis}</span> — {t('diagnostic:legal.not_attached', 'texte non rattaché automatiquement (à consulter sur Légifrance)')}</span>
                        )}
                    </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-slate-700">{t('diagnostic:legal.source', 'Source :')} <span {...FR}>{legal.source}</span>. {t('diagnostic:legal.reading_only', "Ces textes sont joints pour lecture : ADA n'en tire aucune règle automatiquement.")}</p>
        </div>
    );
}

/** PKG-6 / D11: official pages to read (research register). Never the basis of the result above; the rules summary is not expert-validated. @param {{ code: string }} props */
function OfficialInfo({ code }) {
    const { t } = useT('diagnostic');
    const day = useDay();
    const info = officialInfoFor(code);
    if (!info) return null;
    return (
        <>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid={`official-info-${code}`}>
            <p className="font-semibold text-slate-900">{t('diagnostic:official.title', 'Pour en savoir plus (pages officielles)')}</p>
            <ul className="mt-1 space-y-1">
                {info.pages.map((p) => (
                    <li key={p.url}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center py-2 text-indigo-800 underline">
                            <span {...FR}>{p.site}{p.scope ? ` — ${p.scope}` : ''}</span>
                            <span className="sr-only"> {t('diagnostic:official.new_tab', '(nouvel onglet)')}</span>
                        </a>
                        {p.pageDate && <span className="text-slate-700"> — {t('diagnostic:official.page_date', 'date indiquée sur la page : {{date}}', { date: day(p.pageDate) })}</span>}
                    </li>
                ))}
            </ul>
            <p className="mt-1 text-slate-800">{t('diagnostic:official.decided_by', 'Qui décide :')} <span {...FR}>{info.decidedBy}</span>.</p>
            {!info.validated && (
                <p className="mt-1 text-slate-800" data-testid={`official-info-unvalidated-${code}`}>
                    {t('diagnostic:official.unvalidated', "ADA a relevé les conditions de ces pages, mais aucun expert ne les a encore validées : le résultat ci-dessus n'est pas calculé à partir d'elles.")}
                </p>
            )}
        </div>
        <LegalTexts code={code} />
        </>
    );
}
