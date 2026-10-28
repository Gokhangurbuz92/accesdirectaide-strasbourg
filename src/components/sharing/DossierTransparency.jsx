// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { COFFRE_CATEGORY_LABELS, COFFRE_UPLOAD_CATEGORIES, formatBytes, formatDate } from '@/lib/monEspace';
import { CASE_STATUS_LABELS, OUTCOME_LABELS, label } from '@/lib/caseLabels';

/**
 * PKG-2 — on a dossier attached to the account: R16 "who did what with my dossier" (by organisation, no staff name, no IP), C17 the documents organisations attached
 * (download, remove), and share-from-Coffre: send ONE of my Coffre documents to ONE organisation that already has access. Every rule is enforced by the server.
 * @param {{ shareId: string }} props
 */
export default function DossierTransparency({ shareId }) {
  const [data, setData] = useState({ loading: true, events: [], documents: [], grants: [], coffre: [], followUps: [] });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [pick, setPick] = useState({ documentId: '', structureId: '' });
  const load = useCallback(async () => {
    try {
      const [a, d, g, c, f] = await Promise.all([citizenApi.dossierAccess(shareId), citizenApi.dossierDocuments(shareId), citizenApi.dossierGrants(shareId).catch(() => ({ grants: [] })), citizenApi.listCoffre().catch(() => ({ documents: [] })),
        (citizenApi.dossierFollowUps ? citizenApi.dossierFollowUps(shareId) : Promise.resolve({ followUps: [] })).catch(() => ({ followUps: [] }))]);
      setData({ loading: false, events: a.events || [], documents: d.documents || [], grants: (g.grants || []).filter((x) => !x.revoked), coffre: (c.documents || []).filter((x) => COFFRE_UPLOAD_CATEGORIES.includes(x.category)), followUps: (f && f.followUps) || [] });
    } catch (err) { setData((x) => ({ ...x, loading: false, failed: true })); setProblem(err.message); }   // R8: what could not be read is not « nobody »
  }, [shareId]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setMessage(''); setProblem(''); try { await fn(); setMessage(ok); await load(); } catch (err) { setProblem(err.message); } };
  if (data.loading) return <p role="status">Chargement…</p>;
  return (
    <div className="space-y-4" data-testid="dossier-transparency">
      <div aria-live="polite" role="status" data-testid="transparency-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="transparency-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      {data.followUps.length ? (
        <Card>
          <CardHeader><CardTitle className="text-lg">Suivi par les structures</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.followUps.map((fu, i) => (
              <div key={i} data-testid="followup" className="rounded-md border border-slate-200 p-2 text-sm">
                <p><strong>{fu.organization}</strong> — {label(CASE_STATUS_LABELS, fu.status)}{fu.outcome ? ` — ${label(OUTCOME_LABELS, fu.outcome)}` : ''}</p>
                {fu.summary ? <p data-testid="followup-summary">« {fu.summary} »</p> : null}
                {fu.notes.map((n, j) => <p key={j} data-testid="followup-note" className="text-slate-800">{formatDate(n.at)} : {n.body}</p>)}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-lg">Qui a consulté ou modifié ce dossier</CardTitle></CardHeader>
        <CardContent>
          {data.failed ? <p className="text-sm text-slate-700" data-testid="access-unknown">Le journal des consultations n’a pas pu être lu.</p> : data.events.length ? (
            <ol className="space-y-1 text-sm text-slate-800" data-testid="access-log">
              {data.events.map((e, i) => <li key={i} data-testid="access-event">{new Date(e.at).toLocaleString('fr-FR')} — <strong>{e.organization}</strong> {e.label}</li>)}
            </ol>
          ) : <p className="text-sm text-slate-700" data-testid="access-empty">Aucune organisation n’a encore consulté ce dossier.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Documents de ce dossier</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.documents.length ? (
            <ul className="space-y-2" data-testid="dossier-docs">
              {data.documents.map((d) => (
                <li key={d.id} data-testid="dossier-doc" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span>{d.name} — {formatBytes(d.byteLength)} — déposé par <strong>{d.organization}</strong>{d.uploadedAt ? ` le ${formatDate(d.uploadedAt)}` : ''}</span>
                  <span className="flex gap-2">
                    <Button asChild size="sm" variant="outline"><a href={citizenApi.dossierDocumentUrl(shareId, d.id)} aria-label={`Télécharger ${d.name}`} data-testid="dossier-doc-download">Télécharger</a></Button>
                    <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" aria-label={`Retirer ${d.name} du dossier`} data-testid="dossier-doc-remove" onClick={() => run(() => citizenApi.removeDossierDocument(shareId, d.id), 'Document retiré du dossier.')}>Retirer</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : data.failed ? <p className="text-sm text-slate-700" data-testid="dossier-docs-unknown">La liste des documents n’a pas pu être lue.</p>   /* R18: a failed read is not « no document » */
            : <p className="text-sm text-slate-700" data-testid="dossier-docs-empty">Aucun document dans ce dossier.</p>}
          {data.grants.length && data.coffre.length ? (
            <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); run(() => citizenApi.shareFromCoffre(pick.documentId, shareId, pick.structureId), 'Document envoyé à l’organisation choisie (elle seule le voit).'); }}>
              <div><label htmlFor="sfc-doc" className="block text-sm text-slate-800">Document de Mon Coffre</label>
                <select id="sfc-doc" data-testid="share-coffre-doc" required className="mt-1 w-full rounded-md border border-slate-300 p-2" value={pick.documentId} onChange={(e) => setPick({ ...pick, documentId: e.target.value })}>
                  <option value="">Choisir…</option>{data.coffre.map((c) => <option key={c.id} value={c.id}>{c.name} ({COFFRE_CATEGORY_LABELS[c.category]})</option>)}
                </select></div>
              <div><label htmlFor="sfc-org" className="block text-sm text-slate-800">Organisation qui a accès</label>
                <select id="sfc-org" data-testid="share-coffre-org" required className="mt-1 w-full rounded-md border border-slate-300 p-2" value={pick.structureId} onChange={(e) => setPick({ ...pick, structureId: e.target.value })}>
                  <option value="">Choisir…</option>{data.grants.map((g) => <option key={g.structureId} value={g.structureId}>{g.structureName}</option>)}
                </select></div>
              <div className="flex items-end"><Button type="submit" data-testid="share-coffre-send">Envoyer</Button></div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
