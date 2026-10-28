// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RDV_ONLINE_LABEL, organismQuery, routeStructures, structurePath } from '@/lib/structureRouting';

const LINK = 'inline-flex min-h-11 items-center rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/**
 * DTA S3A — structures to consider for ONE plan step. The person chooses; ADA never claims a structure is suitable (name correspondence only, data UNVERIFIED).
 * `loader(query)` resolves to the directory items for a text query (injected: the page passes the real directory client). A failure or an empty answer is shown as an explicit limitation with safe alternatives.
 * No contact detail, availability or appointment is created here: booking, when offered, starts on the structure page the person opens.
 */
export default function PlanStructures({ who, loader }) {
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
    if (state.status === 'loading') return <p className="print-hide mt-2 text-sm text-slate-700" role="status" data-testid="plan-structures-loading">Recherche dans l&apos;annuaire…</p>;
    const route = routeStructures(who, state.status === 'error' ? [] : state.items);
    return (
        <div className="print-hide mt-3 rounded-lg bg-slate-50 p-3" data-testid="plan-structures" data-mode={state.status === 'error' ? 'ERROR' : route.mode}>
            {route.mode === 'MATCHED' && (
                <>
                    <p className="text-sm font-semibold text-slate-900">{route.structures.some((s) => s.service) ? 'Structures dont le nom ou un service indiqué correspond (à vous de choisir) :' : 'Structures dont le nom correspond (à vous de choisir) :'}</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                        {route.structures.map((s) => (
                            <li key={s.id} className="flex flex-col gap-1">
                                <Link to={structurePath(s)} className={LINK} data-testid="plan-structure-link">{s.nom}{s.ville ? ` — ${s.ville}` : ''}</Link>
                                {s.service && <span className="text-xs text-slate-700" data-testid="plan-structure-service">Indique proposer : « {s.service} »</span>}
                                {s.rdvOnline && <span className="text-xs font-medium text-slate-700" data-testid="plan-structure-rdv">{RDV_ONLINE_LABEL}</span>}
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <p className="mt-2 text-sm text-slate-800" data-testid="plan-structures-notice">
                {state.status === 'error' ? 'L\'annuaire n\'a pas pu être consulté pour le moment. Ce n\'est pas un refus : réessayez plus tard ou cherchez vous-même. ' : ''}
                {route.notice}
            </p>
            {route.mode !== 'MATCHED' && (
                <ul className="mt-2 flex flex-wrap gap-2">
                    {route.alternatives.map((a) => (<li key={a.to}><Link to={a.to} className={LINK}>{a.label}</Link></li>))}
                </ul>
            )}
        </div>
    );
}
