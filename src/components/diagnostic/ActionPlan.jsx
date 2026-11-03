// @ts-nocheck
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { ListChecks, Printer } from 'lucide-react';
import { DEFAULT_WHO, buildActionPlan } from '@/lib/actionPlan';
import { readAssessment } from '@/lib/assessmentLabels';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { useT } from '@/i18n';
import PlanStructures from '@/components/diagnostic/PlanStructures';

// steps that only make sense for the person themself (sharing buttons, emergency page, the form): hidden in the read-only professional view
const CITIZEN_ONLY = ['complete', 'share', 'urgent'];
/** French text inside any interface language (the server's aide labels and organism names): read with a French voice, left to right */
const FR = { lang: 'fr', dir: 'ltr' };

/**
 * R40 — the texts of one step in the interface language (namespace `diagnostic`). Same order, kinds and links as src/lib/actionPlan.js, whose
 * French sentences stay the reference (the PDF prints them; tests/unit/r40-action-plan-i18n.test.jsx checks the French screen is the same text).
 * The aide labels and the organism the server names stay French (lang="fr"); ADA's own fallback organism (DEFAULT_WHO) is translated.
 */
function useStepTexts(results) {
    const { t, i18n } = useT('diagnostic');
    const { missingFactLabel } = useAssessmentLabels();
    const { items } = readAssessment(results);
    const byCode = new Map(items.map((i) => [i.code, i]));
    const fr = <span {...FR} />;
    return (s) => {
        const group = s.itemCodes.map((c) => byCode.get(c)).filter(Boolean);
        const labels = group.map((i) => i.label).join(', ');
        const generic = s.who === DEFAULT_WHO;
        const who = generic ? t('diagnostic:plan.default_who', 'un organisme compétent') : s.who;
        const whoEl = generic ? <span /> : fr;
        const link = (l) => {
            if (l.to.startsWith('/aides/')) {
                const it = group.find((i) => `/aides/${encodeURIComponent(i.code)}` === l.to);
                return <Trans i18n={i18n} i18nKey="diagnostic:plan.verify.link_info" defaults="Fiche d'information : <0>{{label}}</0>" values={{ label: it ? it.label : '' }} components={[fr]} />;
            }
            const LINKS = {
                '#diag-birthdate': t('diagnostic:plan.complete.link', 'Revenir au formulaire'),
                '/structures': s.kind === 'verify'
                    ? t('diagnostic:plan.verify.link_structures', 'Trouver une structure pour faire vérifier (données en cours de vérification)')
                    : t('diagnostic:plan.accompany.link', "Trouver une structure d'accompagnement (données en cours de vérification)"),
                '#share-actions': t('diagnostic:plan.share.link', 'Aller aux boutons de partage'),
                '/ressources?emergency=1': t('diagnostic:plan.urgent.link', "Voir les ressources d'urgence"),
            };
            return LINKS[l.to] || l.label;
        };
        switch (s.kind) {
            case 'complete': {
                const facts = [...new Set(group.flatMap((i) => (i.missingFacts || []).map(missingFactLabel)))].join(', ');
                return {
                    title: <Trans i18n={i18n} i18nKey="diagnostic:plan.complete.title" defaults="Compléter les informations manquantes (<0>{{labels}}</0>)" values={{ labels }} components={[fr]} />,
                    titleFalc: t('diagnostic:plan.complete.title_falc', 'Ajoutez les informations qui manquent.'),
                    detail: t('diagnostic:plan.complete.detail', 'Pour orienter votre demande, il faut préciser : {{facts}}. Vous pouvez répondre « je ne sais pas » ; un professionnel pourra vous aider.', { facts }),
                    link,
                };
            }
            case 'verify':
                return {
                    title: <Trans i18n={i18n} i18nKey="diagnostic:plan.verify.title" defaults="Faire vérifier votre situation pour <0>{{labels}}</0> auprès de <1>{{who}}</1>" values={{ labels, who }} components={[fr, whoEl]} />,
                    titleFalc: <Trans i18n={i18n} i18nKey="diagnostic:plan.verify.title_falc" defaults="Demandez à <1>{{who}}</1> de regarder : <0>{{labels}}</0>." values={{ labels, who }} components={[fr, whoEl]} />,
                    detail: t('diagnostic:plan.verify.detail', "Ce plan n'est pas une décision : seul l'organisme compétent peut examiner votre situation."),
                    link,
                };
            case 'prepare':
                return {
                    title: t('diagnostic:plan.prepare.title', 'Préparer vos justificatifs'),
                    titleFalc: t('diagnostic:plan.prepare.title_falc', 'Préparez vos papiers.'),
                    detail: t('diagnostic:plan.prepare.detail', "Rassemblez vos papiers personnels. La liste exacte des documents à fournir est à confirmer auprès de l'organisme : ADA n'a pas encore de liste de documents à vous donner."),
                    link,
                };
            case 'accompany':
                return {
                    title: <Trans i18n={i18n} i18nKey="diagnostic:plan.accompany.title" defaults="Demander conseil pour : <0>{{labels}}</0>" values={{ labels }} components={[fr]} />,
                    titleFalc: <Trans i18n={i18n} i18nKey="diagnostic:plan.accompany.title_falc" defaults="Demandez conseil à un professionnel pour : <0>{{labels}}</0>." values={{ labels }} components={[fr]} />,
                    detail: <Trans i18n={i18n} i18nKey="diagnostic:plan.accompany.detail" defaults="ADA ne sait pas encore évaluer ces aides (<0>{{labels}}</0>). Un professionnel (travailleur social, structure d'accompagnement, France Services) peut vous aider à voir ce qui existe." values={{ labels }} components={[fr]} />,
                    link,
                };
            case 'share':
                return {
                    title: t('diagnostic:plan.share.title', 'Partager votre diagnostic avec une structure (facultatif)'),
                    titleFalc: t('diagnostic:plan.share.title_falc', 'Vous pouvez partager vos résultats avec une structure.'),
                    detail: t('diagnostic:plan.share.detail', "C'est facultatif : le partage se fait avec la structure que vous choisissez, selon les autorisations que vous accordez, et vous pouvez le retirer."),
                    link,
                };
            case 'urgent':
                return {
                    title: t('diagnostic:plan.urgent.title', "En cas d'urgence"),
                    titleFalc: t('diagnostic:plan.urgent.title_falc', "Si c'est urgent, voyez les ressources d'urgence."),
                    detail: t('diagnostic:plan.urgent.detail', "Des ressources d'urgence sont réunies sur une page dédiée."),
                    link,
                };
            default:
                return { title: s.title, titleFalc: s.titleFalc, detail: s.detail, link: (l) => l.label };
        }
    };
}

/**
 * DTA S2A (A5) — account-free "Plan d'action", built ONLY from the assessment states (src/lib/actionPlan.js).
 * Not saved anywhere, no account, no deadline, no reminder; documents are not invented; links are internal routes or in-page anchors.
 * FALC sentence first, fuller text in <details>; printable (src/index.css isolates this section when printing).
 * audience="pro": read-only view of the plan proposed to the person (inside the organization-bound dossier): no print button, no citizen-only steps, no in-page anchors.
 */
export default function ActionPlan({ results, audience = 'citizen', structureLoader }) {
    const { t } = useT('diagnostic');
    const { dataStatusBanner } = useAssessmentLabels();
    const textsOf = useStepTexts(results);
    const pro = audience === 'pro';
    const plan = buildActionPlan(results);
    const steps = pro ? plan.steps.filter((s) => !CITIZEN_ONLY.includes(s.kind)) : plan.steps;
    if (!steps.length) return null;
    return (
        <section id="action-plan" data-testid="action-plan" aria-labelledby="action-plan-title" className="rounded-2xl border-2 border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="action-plan-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <ListChecks className="h-5 w-5" aria-hidden="true" /> {pro ? t('diagnostic:plan.title_pro', 'Plan d’action proposé à la personne') : t('diagnostic:plan.title', 'Plan d’action')}
                </h2>
                {!pro && (
                    <button
                        type="button"
                        data-testid="action-plan-print"
                        onClick={() => window.print()}
                        className="print-hide flex min-h-11 items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                        <Printer className="h-4 w-4" aria-hidden="true" /> {t('diagnostic:plan.print', 'Imprimer mon plan')}
                    </button>
                )}
            </div>
            <p className="mt-2 text-sm text-slate-700">
                {pro
                    ? t('diagnostic:plan.intro_pro', 'Étapes proposées à la personne à partir de ses pistes d’orientation (lecture seule). Ce plan n’est pas enregistré, il ne décide rien et ne fixe aucune date.')
                    : t('diagnostic:plan.intro', 'Étapes proposées à partir de vos pistes d’orientation. Ce plan n’est pas enregistré, il ne décide rien et ne fixe aucune date.')}
                {' '}{dataStatusBanner}
            </p>
            <ol className="mt-4 space-y-3" data-testid="action-plan-steps">
                {steps.map((s, idx) => {
                    const links = pro ? s.links.filter((l) => !l.to.startsWith('#')) : s.links;
                    const text = textsOf(s);
                    return (
                        <li key={s.order} data-testid={`plan-step-${s.kind}`} data-step-kind={s.kind} className="rounded-xl border border-slate-200 p-4">
                            <p className="text-base font-bold text-slate-900"><span className="me-2 text-slate-600">{pro ? idx + 1 : s.order}.</span>{text.titleFalc}</p>
                            <details className="mt-2 text-sm text-slate-800">
                                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{t('diagnostic:plan.more', "Plus d'explications")}</summary>
                                <p className="mt-2 font-medium" data-testid="plan-step-title">{text.title}</p>
                                <p className="mt-1" data-testid="plan-step-detail">{text.detail}</p>
                            </details>
                            {!pro && s.kind === 'verify' && structureLoader && <PlanStructures who={s.who} loader={structureLoader} />}
                            {links.length > 0 && (
                                <ul className="print-hide mt-2 flex flex-wrap gap-2">
                                    {links.map((l) => (
                                        <li key={l.to}>
                                            {l.to.startsWith('#')
                                                ? <a href={l.to} className="inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{text.link(l)}</a>
                                                : <Link to={l.to} className="inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{text.link(l)}</Link>}
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
