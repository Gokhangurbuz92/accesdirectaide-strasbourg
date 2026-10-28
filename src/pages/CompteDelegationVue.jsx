// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { COFFRE_CATEGORY_LABELS, DELEGATION_SCOPE_LABELS, PARCOURS_STATUS_LABELS, formatBytes, formatDate } from '@/lib/monEspace';

const VIEWS = [['parcours', 'PARCOURS_READ', 'Mon Parcours'], ['coffre', 'COFFRE_LIST', 'Mon Coffre (liste)'], ['rdv', 'RDV_READ', 'Prochains rendez-vous']];

/**
 * PKG-2 / C23 — what a delegate sees (/compte/delegations/:id): read-only, only the parts the person granted, never notes nor document contents. The server re-checks
 * the delegation (active, not expired, scope) on every view and logs it for the person.
 */
export default function CompteDelegationVue() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, error: '', delegation: null, parts: {} });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { received } = await citizenApi.listDelegations();
        const d = (received || []).find((x) => x.id === id);
        if (!d || d.status !== 'ACTIVE') throw Object.assign(new Error('Cet accès n’est pas (ou plus) actif.'), { status: 404 });
        const parts = {};
        for (const [view, scope] of VIEWS) if (d.scopes.includes(scope)) parts[view] = await citizenApi.delegateView(id, view);
        if (live) setState({ loading: false, error: '', delegation: d, parts });
      } catch (err) { if (live) setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour consulter cet accès.' : err.message, delegation: null, parts: {} }); }
    })();
    return () => { live = false; };
  }, [id]);
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement…</div>;
  const { delegation: d, parts } = state;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="delegation-view">
      <SEO title="Accès en lecture seule" noindex />
      <p><Link className="text-blue-800 underline" to="/compte/delegations">← Personnes de confiance</Link></p>
      {state.error ? <><h1 className="text-2xl font-bold text-slate-900">Accès en lecture seule</h1><p role="alert" data-testid="delegation-view-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p></> : (
        <>
          <h1 className="text-2xl font-bold text-slate-900">Espace de {d.principalEmail}</h1>
          <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="delegation-readonly-banner">Lecture seule, jusqu’au {formatDate(d.expiresAt)}. Vous ne pouvez rien modifier. La personne voit ce que vous consultez et peut arrêter cet accès à tout moment.</p>
          {parts.parcours ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.PARCOURS_READ}</CardTitle></CardHeader><CardContent>
              {parts.parcours.items.length ? <ul className="space-y-1 text-sm" data-testid="delegate-parcours">{parts.parcours.items.map((i) => <li key={i.id} data-testid="delegate-parcours-item">{i.title} — {PARCOURS_STATUS_LABELS[i.status] || i.status}{i.dueDate ? ` — échéance le ${formatDate(i.dueDate)}` : ''}</li>)}</ul>
                : <p className="text-sm text-slate-700">Aucune étape.</p>}
            </CardContent></Card>
          ) : null}
          {parts.coffre ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.COFFRE_LIST}</CardTitle></CardHeader><CardContent>
              {parts.coffre.documents.length ? <ul className="space-y-1 text-sm" data-testid="delegate-coffre">{parts.coffre.documents.map((c, i) => <li key={i} data-testid="delegate-coffre-item">{c.name} ({COFFRE_CATEGORY_LABELS[c.category]}) — {formatBytes(c.byteLength)}</li>)}</ul>
                : <p className="text-sm text-slate-700">Aucun document.</p>}
            </CardContent></Card>
          ) : null}
          {parts.rdv ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.RDV_READ}</CardTitle></CardHeader><CardContent>
              {parts.rdv.appointments.length ? <ul className="space-y-1 text-sm" data-testid="delegate-rdv">{parts.rdv.appointments.map((a, i) => <li key={i}>{new Date(a.startAt).toLocaleString('fr-FR')} — {a.structure}</li>)}</ul>
                : <p className="text-sm text-slate-700" data-testid="delegate-rdv-empty">Aucun rendez-vous à venir.</p>}
            </CardContent></Card>
          ) : null}
        </>
      )}
    </div>
  );
}
