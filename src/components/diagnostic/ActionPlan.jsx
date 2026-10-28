// @ts-nocheck
import { Link } from 'react-router-dom';
import { ListChecks, Printer } from 'lucide-react';
import { buildActionPlan } from '@/lib/actionPlan';
import PlanStructures from '@/components/diagnostic/PlanStructures';

// steps that only make sense for the person themself (sharing buttons, emergency page, the form): hidden in the read-only professional view
const CITIZEN_ONLY = ['complete', 'share', 'urgent'];

/**
 * DTA S2A (A5) — account-free "Plan d'action", built ONLY from the assessment states (src/lib/actionPlan.js).
 * Not saved anywhere, no account, no deadline, no reminder; documents are not invented; links are internal routes or in-page anchors.
 * FALC sentence first, fuller text in <details>; printable (src/index.css isolates this section when printing).
 * audience="pro": read-only view of the plan proposed to the person (inside the organization-bound dossier): no print button, no citizen-only steps, no in-page anchors.
 */
export default function ActionPlan({ results, audience = 'citizen', structureLoader }) {
    const pro = audience === 'pro';
    const plan = buildActionPlan(results);
    const steps = pro ? plan.steps.filter((s) => !CITIZEN_ONLY.includes(s.kind)) : plan.steps;
    if (!steps.length) return null;
    return (
        <section id="action-plan" data-testid="action-plan" aria-labelledby="action-plan-title" className="rounded-2xl border-2 border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="action-plan-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <ListChecks className="h-5 w-5" aria-hidden="true" /> {pro ? 'Plan d’action proposé à la personne' : 'Plan d’action'}
                </h2>
                {!pro && (
                    <button
                        type="button"
                        data-testid="action-plan-print"
                        onClick={() => window.print()}
                        className="print-hide flex min-h-11 items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        <Printer className="h-4 w-4" aria-hidden="true" /> Imprimer mon plan
                    </button>
                )}
            </div>
            <p className="mt-2 text-sm text-slate-700">
                {pro
                    ? 'Étapes proposées à la personne à partir de ses pistes d’orientation (lecture seule). Ce plan n’est pas enregistré, il ne décide rien et ne fixe aucune date. '
                    : 'Étapes proposées à partir de vos pistes d’orientation. Ce plan n’est pas enregistré, il ne décide rien et ne fixe aucune date. '}
                {plan.dataStatusBanner}
            </p>
            <ol className="mt-4 space-y-3" data-testid="action-plan-steps">
                {steps.map((s, idx) => {
                    const links = pro ? s.links.filter((l) => !l.to.startsWith('#')) : s.links;
                    return (
                        <li key={s.order} data-testid={`plan-step-${s.kind}`} data-step-kind={s.kind} className="rounded-xl border border-slate-200 p-4">
                            <p className="text-base font-bold text-slate-900"><span className="mr-2 text-slate-600">{pro ? idx + 1 : s.order}.</span>{s.titleFalc}</p>
                            <details className="mt-2 text-sm text-slate-800">
                                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Plus d&apos;explications</summary>
                                <p className="mt-2 font-medium">{s.title}</p>
                                <p className="mt-1">{s.detail}</p>
                            </details>
                            {!pro && s.kind === 'verify' && structureLoader && <PlanStructures who={s.who} loader={structureLoader} />}
                            {links.length > 0 && (
                                <ul className="print-hide mt-2 flex flex-wrap gap-2">
                                    {links.map((l) => (
                                        <li key={l.to}>
                                            {l.to.startsWith('#')
                                                ? <a href={l.to} className="inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{l.label}</a>
                                                : <Link to={l.to} className="inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{l.label}</Link>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
