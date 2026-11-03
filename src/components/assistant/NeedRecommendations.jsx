// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { postRecommendations } from '@/lib/assistant/client';
import { formatDate, useT } from '@/i18n';

/**
 * PKG-11 / P16 — next to the assessment, what the VERIFIED catalogue holds for the need the person named in the first step: aides, démarches and structures,
 * ranked (best match of each kind first, then alternating), each with why it is shown (the words of the need it matches, or the service a structure declares)
 * and its source / verification date. Before: the need was ignored once the assessment replaced the old flow, and that flow asked the model to write an
 * unsourced « plan d'action » from the titles. These are leads, never an eligibility statement; a failure never hides the assessment.
 * R40: the frame is in the interface language (namespace `diagnostic`); the catalogue titles and the server's « why » stay French (lang="fr").
 */
const FR = { lang: 'fr', dir: 'ltr' };
const day = (iso) => formatDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }) || null;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

export default function NeedRecommendations({ need, label, territory }) {
  const { t } = useT('diagnostic');
  const KIND = { aide: t('diagnostic:wizard.recos.kind_aide', 'Aide'), demarche: t('diagnostic:wizard.recos.kind_demarche', 'Démarche'), structure: t('diagnostic:wizard.recos.kind_structure', 'Structure') };
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
      <h3 id="need-recos-title" className="text-base font-semibold text-slate-900">{t('diagnostic:wizard.recos.title', 'En lien avec votre besoin : « {{label}} »', { label })}</h3>
      <p className="mt-1 text-sm text-slate-700">{t('diagnostic:wizard.recos.intro', "Pistes tirées du catalogue vérifié d'ADA, classées par correspondance. Elles ne disent pas si une aide vous concerne : vérifiez auprès de l'organisme.")}</p>
      {state.status === 'loading' && <p className="mt-2 text-sm text-slate-800" role="status">{t('diagnostic:wizard.recos.loading', 'Recherche dans le catalogue…')}</p>}
      {state.status === 'error' && <p className="mt-2 text-sm text-slate-800" role="status" data-testid="need-recommendations-error">{t('diagnostic:wizard.recos.error', "Les pistes n'ont pas pu être chargées. Le résultat ci-dessus reste valable.")}</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="mt-2 text-sm text-slate-800" data-testid="need-recommendations-empty">{t('diagnostic:wizard.recos.empty', 'Aucune piste du catalogue vérifié ne correspond encore à ce besoin.')}</p>}
      {state.status === 'ready' && state.items.length > 0 && (
        <ol className="mt-3 space-y-3">
          {state.items.map((it) => (
            <li key={`${it.type}-${it.slug || it.url}`} className="rounded-md border border-slate-200 p-3" data-testid="need-recommendation" data-kind={it.type}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{KIND[it.type] || it.type}</p>
              <Link to={it.url} className="inline-flex min-h-11 items-center font-semibold text-blue-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"><span {...FR}>{it.title}</span></Link>
              {it.whyShown ? <p className="text-sm text-slate-800" data-testid="need-recommendation-why">{t('diagnostic:wizard.recos.why', 'Pourquoi cette piste :')} <span {...FR}>{it.whyShown}</span></p> : null}
              {it.sourceUrl || it.verifiedAt ? (
                <p className="text-xs text-slate-700">
                  {it.sourceUrl && host(it.sourceUrl) ? t('diagnostic:wizard.recos.source', 'Source : {{host}}', { host: host(it.sourceUrl) }) : t('diagnostic:wizard.recos.no_source', 'Source non précisée')}
                  {it.verifiedAt && day(it.verifiedAt) ? ` — ${t('diagnostic:wizard.recos.verified', 'vérifiée le {{date}}', { date: day(it.verifiedAt) })}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
