import { AlertTriangle, ExternalLink, Info, Scale } from 'lucide-react';
import { formatDate, formatNumber, useT } from '@/i18n';

/** the housing aids, whose amount depends on the commune */
const HOUSING = new Set(['apl', 'aide_logement']);

/**
 * G14 — the « estimation indicative » of the self-hosted OpenFisca engine (the `citizen` block of POST /api/diagnostic, api/lib/openfiscaLegislation.js).
 * Shows an amount ONLY when the server gave one (pinned legislation in force for the period); otherwise why there is none. Every aide says who decides,
 * the date of the legislation used when there is one, the official page and simulator, and « À vérifier auprès de l'organisme compétent » while its rule
 * is not expert-validated (D11). Never an entitlement statement. The interface frame is in the interface language (namespace `diagnostic`); what the
 * server wrote (aide names, deciding bodies, assumptions) stays French and is marked lang="fr".
 * @param {{ estimate: any, headingLevel?: 2 | 3, communeOutside?: boolean }} props communeOutside: the person chose « Autre commune … hors Eurométropole »
 */
export default function IndicativeEstimate({ estimate, headingLevel = 2, communeOutside = false }) {
    const { t } = useT('diagnostic');
    if (!estimate || estimate.contract !== 'ADA_CITIZEN_ESTIMATE_V1' || !Array.isArray(estimate.items)) return null;
    const H = headingLevel === 3 ? 'h3' : 'h2';
    const H2 = headingLevel === 3 ? 'h4' : 'h3';
    const withheld = (/** @type {string | null} */ code) => ({
        MISSING_INPUTS: t('diagnostic:estimate.withheld.missing_inputs', 'Pas de montant : il manque des informations.'),
        NOT_INDICATED: t('diagnostic:estimate.withheld.not_indicated', 'Pas de montant avec ces informations. Cela ne dit pas si l’aide est possible : l’organisme décide.'),
        LEGISLATION_UNKNOWN_FOR_PERIOD: t('diagnostic:estimate.withheld.legislation_unknown', 'Pas de montant : les règles en vigueur pour ce mois ne sont pas connues de notre outil.'),
        ENGINE_NOT_PINNED: t('diagnostic:estimate.withheld.engine_not_pinned', 'Pas de montant : la version de l’outil de calcul n’est pas vérifiée.'),
        NO_LEGISLATION_RECORD: t('diagnostic:estimate.withheld.not_estimated', 'Pas de montant : AccesDirectAide ne calcule pas cette aide.'),
    })[code || ''] || t('diagnostic:estimate.withheld.not_estimated', 'Pas de montant : AccesDirectAide ne calcule pas cette aide.');
    const missingLabel = (/** @type {string} */ key) => ({
        birthDate: t('diagnostic:estimate.missing.birth_date', 'votre date de naissance exacte'),
        statut: t('diagnostic:estimate.missing.statut', 'votre situation professionnelle'),
        income: t('diagnostic:estimate.missing.income', 'vos revenus du mois, même s’ils sont à zéro'),
        household: t('diagnostic:estimate.missing.household', 'la composition exacte du foyer'),
        pension: t('diagnostic:estimate.missing.pension', 'le montant de vos pensions (non demandé ici)'),
        housing: t('diagnostic:estimate.missing.housing', 'votre statut de locataire et votre loyer'),
        commune: t('diagnostic:estimate.missing.commune', 'votre commune (question « Commune »)'),
        disabilityRate: t('diagnostic:estimate.missing.disability_rate', 'le taux d’incapacité reconnu par la MDPH (non demandé ici)'),
        unemploymentHistory: t('diagnostic:estimate.missing.unemployment_history', 'votre parcours d’emploi (non demandé ici)'),
        otherParent: t('diagnostic:estimate.missing.other_parent', 'la situation de l’autre parent (non demandée ici)'),
        taxReference: t('diagnostic:estimate.missing.tax_reference', 'le revenu fiscal de référence (non demandé ici)'),
    })[key] || t('diagnostic:estimate.missing.not_supported', 'cette aide n’est pas calculée par AccesDirectAide');
    const period = /^\d{4}-\d{2}$/.test(String(estimate.period)) ? formatDate(`${estimate.period}-01T12:00:00Z`, { month: 'long', year: 'numeric' }) : '';
    const euros = (/** @type {number} */ n) => formatNumber(n, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

    return (
        <section aria-labelledby="estimate-title" data-testid="indicative-estimate" className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <H id="estimate-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Scale className="h-5 w-5 flex-shrink-0 text-blue-700" aria-hidden="true" />
                {t('diagnostic:estimate.title', 'Estimation indicative')}
            </H>
            <p className="mt-2 text-sm text-slate-700">{t('diagnostic:estimate.intro', 'Ce calcul donne un ordre d’idée, à partir de vos réponses seulement. Ce n’est pas une décision.')}</p>
            <p data-testid="estimate-decides" className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
                {t('diagnostic:estimate.decides', 'Seul l’organisme (CAF, CPAM, Département…) décide de vos droits.')}
            </p>
            {period && (
                <p className="mt-2 text-xs text-slate-700">
                    {t('diagnostic:estimate.engine', 'Calcul pour le mois de {{period}}, avec l’outil public OpenFisca-France (version {{version}}).', { period, version: estimate.engine?.version || '—' })}
                </p>
            )}

            <ul className="mt-4 space-y-3">
                {estimate.items.map((/** @type {any} */ item) => (
                    <li key={item.code} data-testid={`estimate-item-${item.code}`} className="rounded-xl border border-slate-200 p-4">
                        <H2 className="text-base font-bold text-slate-900" lang="fr">{item.label}</H2>
                        {communeOutside && HOUSING.has(item.code) && !(item.monthlyAmount > 0) ? (
                            <p className="mt-1 text-sm text-slate-700" data-testid="estimate-commune-outside">
                                {t('diagnostic:estimate.withheld.commune_outside', 'Pas de montant : l’aide au logement n’est estimée ici que pour les communes de l’Eurométropole de Strasbourg (le montant dépend de la commune). Votre Caf la calcule pour votre commune.')}
                            </p>
                        ) : Number.isInteger(item.monthlyAmount) && item.monthlyAmount > 0 ? (
                            <p className="mt-1 text-sm text-slate-800" data-testid="estimate-amount">
                                {t('diagnostic:estimate.amount', 'Montant estimé : environ {{amount}} par mois.', { amount: euros(item.monthlyAmount) })}
                            </p>
                        ) : (
                            <p className="mt-1 text-sm text-slate-700" data-testid="estimate-no-amount">{withheld(item.amountWithheld)}</p>
                        )}
                        {item.amountWithheld === 'MISSING_INPUTS' && item.missing?.length > 0 && !(communeOutside && HOUSING.has(item.code)) && (
                            <div className="mt-1 text-sm text-slate-700">
                                <p>{t('diagnostic:estimate.missing_title', 'Il faudrait connaître :')}</p>
                                <ul className="ms-5 list-disc">{item.missing.map((/** @type {string} */ k) => <li key={k}>{missingLabel(k)}</li>)}</ul>
                            </div>
                        )}
                        {item.legislation?.inForceFrom && (
                            <p className="mt-1 text-xs text-slate-700" data-testid="estimate-legislation">
                                {t('diagnostic:estimate.legislation', 'Règles en vigueur au {{date}}.', { date: formatDate(`${item.legislation.inForceFrom}T12:00:00Z`) })}
                            </p>
                        )}
                        {item.verifyWithOrganism && (
                            <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-amber-900" data-testid="estimate-verify">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                {t('diagnostic:estimate.verify', 'À vérifier auprès de l’organisme compétent.')}
                            </p>
                        )}
                        {item.organisme && (
                            <p className="mt-1 text-xs text-slate-700">
                                {t('diagnostic:estimate.who_decides', 'Qui décide :')} <span lang="fr">{item.organisme}</span>
                            </p>
                        )}
                        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            {(item.officialLinks || []).filter((/** @type {any} */ l) => /^https:\/\/[a-z0-9.-]+\.(gouv\.fr|caf\.fr)\//i.test(l.url)).map((/** @type {any} */ l) => (
                                <li key={l.url + l.kind}>
                                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline underline-offset-2">
                                        {l.kind === 'fiche' ? t('diagnostic:estimate.link_fiche', 'Fiche officielle') : t('diagnostic:estimate.link_simulator', 'Simulateur officiel')}
                                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="sr-only">{t('diagnostic:estimate.new_tab', '(s’ouvre dans un nouvel onglet)')}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>

            {estimate.assumptions?.length > 0 && (
                <details className="mt-4 text-sm text-slate-700">
                    <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-slate-800">
                        <Info className="h-4 w-4" aria-hidden="true" /> {t('diagnostic:estimate.assumptions_title', 'Les hypothèses du calcul')}
                    </summary>
                    <ul className="ms-5 mt-2 list-disc" lang="fr">{estimate.assumptions.map((/** @type {string} */ a) => <li key={a}>{a}</li>)}</ul>
                </details>
            )}
        </section>
    );
}

/**
 * G14: the notice shown when the indicative calculation could not be made — the page then shows the same orientation as before (SIMULATION_MODE).
 * @param {{ code: string }} props OPENFISCA_QUOTA_REACHED (this month's free allowance is spent) or anything else (engine unavailable)
 */
export function EstimateUnavailable({ code }) {
    const { t } = useT('diagnostic');
    const message = code === 'OPENFISCA_QUOTA_REACHED'
        ? t('diagnostic:estimate.notice_quota', 'Le calcul indicatif est suspendu jusqu’au début du mois prochain : la limite mensuelle d’utilisation est atteinte. Les pistes d’orientation ci-dessous restent disponibles.')
        : t('diagnostic:estimate.notice_unavailable', 'Le calcul indicatif est momentanément indisponible. Les pistes d’orientation ci-dessous restent disponibles. Réessayez plus tard.');
    return (
        <div role="status" data-testid="estimate-unavailable" data-code={code === 'OPENFISCA_QUOTA_REACHED' ? 'quota' : 'unavailable'} className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-900" aria-hidden="true" />
            <div>
                <p className="text-sm font-bold text-amber-900">{t('diagnostic:estimate.unavailable_title', 'Estimation indicative indisponible')}</p>
                <p className="mt-1 text-sm text-amber-900">{message}</p>
            </div>
        </div>
    );
}
