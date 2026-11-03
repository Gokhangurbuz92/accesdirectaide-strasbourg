// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NO_MATCH_NOTICE, ROUTING_NOTICE, ROUTING_NOTICE_SERVICES, organismQuery, routeStructures, structurePath } from '@/lib/structureRouting';
import { useT } from '@/i18n';

const LINK = 'inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/**
 * DTA S3A — structures to consider for ONE plan step. The person chooses; ADA never claims a structure is suitable (name correspondence only, data UNVERIFIED).
 * `loader(query)` resolves to the directory items for a text query (injected: the page passes the real directory client). A failure or an empty answer is shown as an explicit limitation with safe alternatives.
 * No contact detail, availability or appointment is created here: booking, when offered, starts on the structure page the person opens.
 * R40: the notices and links are in the interface language (namespace `diagnostic`, same texts as src/lib/structureRouting.js); structure names and declared services stay as published (lang="fr").
 */
export default function PlanStructures({ who, loader }) {
    const { t } = useT('diagnostic');
    const NOTICES = new Map([
        [ROUTING_NOTICE, t('diagnostic:plan_structures.notice', "Correspondance par le nom uniquement. ADA ne sait pas si cette structure dessert votre commune, traite votre demande ou est ouverte : renseignez-vous auprès d'elle. Données en cours de vérification.")],
        [ROUTING_NOTICE_SERVICES, t('diagnostic:plan_structures.notice_services', "Correspondance par le nom ou par un service que la structure indique proposer. ADA ne sait pas si cette structure dessert votre commune, traite votre demande ou est ouverte : renseignez-vous auprès d'elle. Données en cours de vérification.")],
        [NO_MATCH_NOTICE, t('diagnostic:plan_structures.no_match', "ADA n'a pas de structure à vous proposer pour cette étape. Ce n'est pas un refus : vous pouvez chercher vous-même dans l'annuaire.")],
    ]);
    const ALTERNATIVE_LABELS = {
        '/structures': t('diagnostic:plan_structures.alt_directory', "Parcourir l'annuaire des structures"),
        '/structures?type=france_services': t('diagnostic:plan_structures.alt_france_services', 'Chercher un espace France Services'),
        '/ressources?emergency=1': t('diagnostic:plan_structures.alt_emergency', "Ressources d'urgence"),
    };
    const org = organismQuery(who);
    const [state, setState] = useState({ status: org ? 'loading' : 'ready', items: [] });
    useEffect(() => {
        if (!org) return undefined;
        let live = true;
        Promise.resolve().then(() => loader(org.query)).then(
            (items) => { if (live) setState({ status: 'ready', items: Array.isArray(items) ? items : [] }); },
            () => { if (live) setState({ status: 'error', items: [] }); },
        );
        return () => { live = false; };
    }, [org && org.query, loader]); // eslint-disable-line react-hooks/exhaustive-deps
    if (state.status === 'loading') return <p className="print-hide mt-2 text-sm text-slate-700" role="status" data-testid="plan-structures-loading">{t('diagnostic:plan_structures.loading', "Recherche dans l'annuaire…")}</p>;
    const route = routeStructures(who, state.status === 'error' ? [] : state.items);
    return (
        <div className="print-hide mt-3 rounded-lg bg-slate-50 p-3" data-testid="plan-structures" data-mode={state.status === 'error' ? 'ERROR' : route.mode}>
            {route.mode === 'MATCHED' && (
                <>
                    <p className="text-sm font-semibold text-slate-900">{route.structures.some((s) => s.service) ? t('diagnostic:plan_structures.matched_services', 'Structures dont le nom ou un service indiqué correspond (à vous de choisir) :') : t('diagnostic:plan_structures.matched', 'Structures dont le nom correspond (à vous de choisir) :')}</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                        {route.structures.map((s) => (
                            <li key={s.id} className="flex flex-col gap-1">
                                <Link to={structurePath(s)} className={LINK} data-testid="plan-structure-link"><span lang="fr" dir="ltr">{s.nom}{s.ville ? ` — ${s.ville}` : ''}</span></Link>
                                {s.service && <span className="text-xs text-slate-700" data-testid="plan-structure-service">{t('diagnostic:plan_structures.service', 'Indique proposer :')} « <span lang="fr" dir="ltr">{s.service}</span> »</span>}
                                {s.rdvOnline && <span className="text-xs font-medium text-slate-700" data-testid="plan-structure-rdv">{t('diagnostic:plan_structures.rdv_online', 'Rendez-vous en ligne proposés sur ADA (à confirmer sur sa page)')}</span>}
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <p className="mt-2 text-sm text-slate-800" data-testid="plan-structures-notice">
                {state.status === 'error' ? `${t('diagnostic:plan_structures.error', "L'annuaire n'a pas pu être consulté pour le moment. Ce n'est pas un refus : réessayez plus tard ou cherchez vous-même.")} ` : ''}
                {NOTICES.get(route.notice) || route.notice}
            </p>
            {route.mode !== 'MATCHED' && (
                <ul className="mt-2 flex flex-wrap gap-2">
                    {route.alternatives.map((a) => (<li key={a.to}><Link to={a.to} className={LINK}>{ALTERNATIVE_LABELS[a.to] || a.label}</Link></li>))}
                </ul>
            )}
        </div>
    );
}
