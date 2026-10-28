// @ts-nocheck
import { useState } from 'react';
import { officialInfoFor } from '@/lib/rightsInfoSources';
import { legalBasisFor } from '@/lib/legalArticles';
import { AlertCircle, CircleHelp, ClipboardCheck, CloudOff, SearchCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GROUPS, PROVENANCE_KEYS, STATE_LABELS, missingFactLabel, readAssessment } from '@/lib/assessmentLabels';

const ICONS = {
    MISSING_INFORMATION: CircleHelp,
    CHECK_REQUIRED: ClipboardCheck,
    POSSIBLE: SearchCheck,
    UNSUPPORTED: AlertCircle,
    ENGINE_UNAVAILABLE: CloudOff,
};
const LINKABLE = ['CHECK_REQUIRED', 'POSSIBLE'];

/**
 * DTA S1 stage 2b — renders the assessment contract (state + provenance), nothing else.
 * No amount, no total, no entitlement or inapplicability wording (see assessmentLabels.js). State = text + icon (never colour alone). FALC sentence first, full text and provenance in <details>.
 * `linkAides` adds a navigation link to the aide information page (it never states or implies entitlement).
 */
export default function AssessmentView({ results, linkAides = false, headingLevel = 2 }) {
    const { items, rejected, usable, dataStatusBanner } = readAssessment(results);
    const H = `h${headingLevel}`;
    const H3 = `h${Math.min(headingLevel + 1, 6)}`;

    if (!usable) {
        return (
            <section aria-labelledby="assessment-title" data-testid="assessment-unavailable" className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <H id="assessment-title" className="text-base font-bold text-amber-900">Résultat indisponible</H>
                <p className="mt-2 text-sm text-amber-900">
                    Aucun résultat exploitable n&apos;a été reçu{rejected ? ' (certains éléments ont été écartés car incomplets)' : ''}. Aucun résultat de remplacement n&apos;est affiché. Réessayez plus tard ou demandez conseil à un professionnel.
                </p>
            </section>
        );
    }

    return (
        <section aria-labelledby="assessment-title" data-testid="assessment-region" className="space-y-6">
            <div>
                <H id="assessment-title" className="text-lg font-bold text-slate-900">Pistes d&apos;orientation</H>
                <p className="mt-1 text-sm text-slate-700">
                    Ces pistes viennent d&apos;une simulation locale non officielle. Elles ne disent pas si vous avez une aide. Seul l&apos;organisme compétent peut décider.
                </p>
                <p data-testid="data-status-banner" className="mt-2 inline-block rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">{dataStatusBanner}</p>
            </div>
            {GROUPS.map((g) => {
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

function ItemCard({ it, link }) {
    const Icon = ICONS[it.state] || AlertCircle;
    return (
        <li data-testid={`assessment-item-${it.code}`} className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-slate-900">{it.label}</p>
                <span data-testid={`assessment-state-${it.code}`} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-900">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {STATE_LABELS[it.state]}
                </span>
            </div>
            <p className="mt-2 text-sm text-slate-800">{it.explanationFalc || it.explanation}</p>
            {it.state === 'MISSING_INFORMATION' && it.missingFacts?.length > 0 && (
                <p className="mt-2 text-sm text-slate-800">À préciser : {it.missingFacts.map(missingFactLabel).join(', ')}.</p>
            )}
            {it.whoToAsk && <p className="mt-2 text-sm font-medium text-slate-900">À demander à : {it.whoToAsk}.</p>}
            <details className="mt-3 text-sm text-slate-800">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    Pourquoi ce résultat ?
                </summary>
                {it.whyFalc && <p className="mt-2" data-testid={`why-falc-${it.code}`}><span className="font-semibold">En bref (facile à lire) : </span>{it.whyFalc}</p>}
                <p className="mt-2">{it.explanation}</p>
                {it.whyFr && <p className="mt-2" data-testid={`why-${it.code}`}>{it.whyFr}</p>}
                {it.basisFacts?.length > 0 && <p className="mt-2" data-testid={`why-basis-${it.code}`}>Réponses utilisées : {it.basisFacts.map(missingFactLabel).join(', ')}.</p>}
                <ul className="mt-2 list-disc space-y-1 pl-5">
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
                    Voir la fiche d&apos;information de cette aide
                </Link>
            )}
        </li>
    );
}

/** One cited reference: a button opens its list (no nested <details>: the result item is itself a <details>). */
function LegalReference({ reference: r }) {
    const [open, setOpen] = useState(false);
    const listId = `legal-${r.basis.replace(/[^A-Za-z0-9]+/g, '-')}`;
    const count = r.articles[0].kind === 'text' ? `${r.articles.length} texte${r.articles.length > 1 ? 's' : ''}` : `${r.articles.length} article${r.articles.length > 1 ? 's' : ''}`;
    return (
        <>
            <button type="button" className="min-h-11 py-2 text-left text-slate-900 underline" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} data-testid="legal-reference-toggle">
                {r.basis} — {count}
            </button>
            {open && (
                <ul id={listId} className="ml-4 mt-1 space-y-1">
                    {r.articles.map((a) => (
                        <li key={a.url}>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center py-2 text-indigo-800 underline">
                                {a.kind === 'text' ? a.num : `Article ${a.num}`}<span className="sr-only"> (Légifrance, nouvel onglet)</span>
                            </a>
                            {a.since && <span className="text-slate-700"> — version en vigueur depuis le {a.since}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

/** R16 / D15: the code articles behind the right (DILA LEGI), with the date each is in force from. An attachment to read, never the basis of the result. */
function LegalTexts({ code }) {
    const legal = legalBasisFor(code);
    if (!legal) return null;
    return (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3" data-testid={`legal-texts-${code}`}>
            <p className="font-semibold text-slate-900">Textes officiels (Légifrance){legal.referenceDate ? `, en vigueur au ${legal.referenceDate}` : ''}</p>
            <ul className="mt-1 space-y-1">
                {legal.references.map((r) => (
                    <li key={r.basis}>
                        {r.attached ? (
                            <LegalReference reference={r} />
                        ) : (
                            <span className="text-slate-800" data-testid="legal-text-not-attached">{r.basis} — texte non rattaché automatiquement (à consulter sur Légifrance)</span>
                        )}
                    </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-slate-700">Source : {legal.source}. Ces textes sont joints pour lecture : ADA n&apos;en tire aucune règle automatiquement.</p>
        </div>
    );
}

/** PKG-6 / D11: official pages to read (research register). Never the basis of the result above; the rules summary is not expert-validated. */
function OfficialInfo({ code }) {
    const info = officialInfoFor(code);
    if (!info) return null;
    return (
        <>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid={`official-info-${code}`}>
            <p className="font-semibold text-slate-900">Pour en savoir plus (pages officielles)</p>
            <ul className="mt-1 space-y-1">
                {info.pages.map((p) => (
                    <li key={p.url}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center py-2 text-indigo-800 underline">
                            {p.site}{p.scope ? ` — ${p.scope}` : ''}
                            <span className="sr-only"> (nouvel onglet)</span>
                        </a>
                        {p.pageDate && <span className="text-slate-700"> — date indiquée sur la page : {p.pageDate}</span>}
                    </li>
                ))}
            </ul>
            <p className="mt-1 text-slate-800">Qui décide : {info.decidedBy}.</p>
            {!info.validated && (
                <p className="mt-1 text-slate-800" data-testid={`official-info-unvalidated-${code}`}>
                    ADA a relevé les conditions de ces pages, mais aucun expert ne les a encore validées : le résultat ci-dessus n&apos;est pas calculé à partir d&apos;elles.
                </p>
            )}
        </div>
        <LegalTexts code={code} />
        </>
    );
}
