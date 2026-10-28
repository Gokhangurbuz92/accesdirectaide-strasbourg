// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { postRecommendations } from '@/lib/assistant/client';

/**
 * PKG-11 / P16 — next to the assessment, what the VERIFIED catalogue holds for the need the person named in the first step: aides, démarches and structures,
 * ranked (best match of each kind first, then alternating), each with why it is shown (the words of the need it matches, or the service a structure declares)
 * and its source / verification date. Before: the need was ignored once the assessment replaced the old flow, and that flow asked the model to write an
 * unsourced « plan d'action » from the titles. These are leads, never an eligibility statement; a failure never hides the assessment.
 */
const KIND = { aide: 'Aide', demarche: 'Démarche', structure: 'Structure' };
const frDate = (iso) => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return null; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

export default function NeedRecommendations({ need, label, territory }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    const controller = new AbortController();
    postRecommendations({ need, territory, limit: 6 }, { signal: controller.signal })
      .then((r) => setState({ status: 'ready', items: Array.isArray(r?.items) ? r.items.filter((i) => i && i.url && i.title) : [] }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error', items: [] }); });
    return () => controller.abort();
  }, [need, territory]);

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4" aria-labelledby="need-recos-title" data-testid="need-recommendations" data-status={state.status}>
      <h3 id="need-recos-title" className="text-base font-semibold text-slate-900">En lien avec votre besoin : « {label} »</h3>
      <p className="mt-1 text-sm text-slate-700">Pistes tirées du catalogue vérifié d&apos;ADA, classées par correspondance. Elles ne disent pas si une aide vous concerne : vérifiez auprès de l&apos;organisme.</p>
      {state.status === 'loading' && <p className="mt-2 text-sm text-slate-800" role="status">Recherche dans le catalogue…</p>}
      {state.status === 'error' && <p className="mt-2 text-sm text-slate-800" role="status" data-testid="need-recommendations-error">Les pistes n&apos;ont pas pu être chargées. Le résultat ci-dessus reste valable.</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="mt-2 text-sm text-slate-800" data-testid="need-recommendations-empty">Aucune piste du catalogue vérifié ne correspond encore à ce besoin.</p>}
      {state.status === 'ready' && state.items.length > 0 && (
        <ol className="mt-3 space-y-3">
          {state.items.map((it) => (
            <li key={`${it.type}-${it.slug || it.url}`} className="rounded-md border border-slate-200 p-3" data-testid="need-recommendation" data-kind={it.type}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{KIND[it.type] || it.type}</p>
              <Link to={it.url} className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">{it.title}</Link>
              {it.whyShown ? <p className="text-sm text-slate-800" data-testid="need-recommendation-why">Pourquoi cette piste : {it.whyShown}</p> : null}
              {it.sourceUrl || it.verifiedAt ? (
                <p className="text-xs text-slate-700">
                  {it.sourceUrl && host(it.sourceUrl) ? `Source : ${host(it.sourceUrl)}` : 'Source non précisée'}
                  {it.verifiedAt && frDate(it.verifiedAt) ? ` — vérifiée le ${frDate(it.verifiedAt)}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
