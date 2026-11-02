// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { formatDate, useT } from '@/i18n';

const VIEWS = [['parcours', 'PARCOURS_READ', 'Mon Parcours'], ['coffre', 'COFFRE_LIST', 'Mon Coffre (liste)'], ['rdv', 'RDV_READ', 'Prochains rendez-vous']];

/**
 * PKG-2 / C23 — what a delegate sees (/compte/delegations/:id): read-only, only the parts the person granted, never notes nor document contents. The server re-checks
 * the delegation (active, not expired, scope) on every view and logs it for the person.
 */
export default function CompteDelegationVue() {
  const { t } = useT('compte');
  const { coffreCategory: COFFRE_CATEGORY_LABELS, delegationScope: DELEGATION_SCOPE_LABELS, parcoursStatus: PARCOURS_STATUS_LABELS, formatBytes } = useMonEspaceLabels();
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, error: '', delegation: null, parts: {} });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { received } = await citizenApi.listDelegations();
        const d = (received || []).find((x) => x.id === id);
        if (!d || d.status !== 'ACTIVE') throw Object.assign(new Error(t('compte:delegation_view.inactive', 'Cet accès n’est pas (ou plus) actif.')), { status: 404 });
        const parts = {};
        for (const [view, scope] of VIEWS) if (d.scopes.includes(scope)) parts[view] = await citizenApi.delegateView(id, view);
        if (live) setState({ loading: false, error: '', delegation: d, parts });
      } catch (err) { if (live) setState({ loading: false, error: err.status === 401 ? t('compte:delegation_view.login_required', 'Connectez-vous pour consulter cet accès.') : err.message, delegation: null, parts: {} }); }
    })();
    return () => { live = false; };
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once per delegation; the messages follow the language at load time
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:delegation_view.chargement', 'Chargement…')}</div>;
  const { delegation: d, parts } = state;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="delegation-view">
      <SEO title={t('compte:delegation_view.acces_lecture_seule', 'Accès en lecture seule')} noindex />
      <p><Link className="text-blue-800 underline" to="/compte/delegations">{t('compte:delegation_view.personnes_confiance', '← Personnes de confiance')}</Link></p>
      {state.error ? <><h1 className="text-2xl font-bold text-slate-900">{t('compte:delegation_view.acces_lecture_seule', 'Accès en lecture seule')}</h1><p role="alert" data-testid="delegation-view-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p></> : (
        <>
          <h1 className="text-2xl font-bold text-slate-900">{t('compte:delegation_view.space_of', 'Espace de {{email}}', { email: d.principalEmail })}</h1>
          <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="delegation-readonly-banner">{t('compte:delegation_view.readonly_until', 'Lecture seule, jusqu’au {{date}}. Vous ne pouvez rien modifier. La personne voit ce que vous consultez et peut arrêter cet accès à tout moment.', { date: formatDate(d.expiresAt) })}</p>
          {parts.parcours ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.PARCOURS_READ}</CardTitle></CardHeader><CardContent>
              {parts.parcours.items.length ? <ul className="space-y-1 text-sm" data-testid="delegate-parcours">{parts.parcours.items.map((i) => <li key={i.id} data-testid="delegate-parcours-item">{i.title} — {PARCOURS_STATUS_LABELS[i.status] || i.status}{i.dueDate ? ` — ${t('compte:parcours.due_on', 'échéance le {{date}}', { date: formatDate(i.dueDate) })}` : ''}</li>)}</ul>
                : <p className="text-sm text-slate-700">{t('compte:delegation_view.aucune_etape', 'Aucune étape.')}</p>}
            </CardContent></Card>
          ) : null}
          {parts.coffre ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.COFFRE_LIST}</CardTitle></CardHeader><CardContent>
              {parts.coffre.documents.length ? <ul className="space-y-1 text-sm" data-testid="delegate-coffre">{parts.coffre.documents.map((c, i) => <li key={i} data-testid="delegate-coffre-item">{c.name} ({COFFRE_CATEGORY_LABELS[c.category]}) — {formatBytes(c.byteLength)}</li>)}</ul>
                : <p className="text-sm text-slate-700">{t('compte:delegation_view.aucun_document', 'Aucun document.')}</p>}
            </CardContent></Card>
          ) : null}
          {parts.rdv ? (
            <Card><CardHeader><CardTitle className="text-lg">{DELEGATION_SCOPE_LABELS.RDV_READ}</CardTitle></CardHeader><CardContent>
              {parts.rdv.appointments.length ? <ul className="space-y-1 text-sm" data-testid="delegate-rdv">{parts.rdv.appointments.map((a, i) => <li key={i}>{formatDate(a.startAt, { dateStyle: 'short', timeStyle: 'medium' })} — {a.structure}</li>)}</ul>
                : <p className="text-sm text-slate-700" data-testid="delegate-rdv-empty">{t('compte:delegation_view.aucun_rendez_vous_venir', 'Aucun rendez-vous à venir.')}</p>}
            </CardContent></Card>
          ) : null}
        </>
      )}
    </div>
  );
}
