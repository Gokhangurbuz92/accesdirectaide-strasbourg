// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Pause, Play, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

/**
 * Automatic verification — the owner's dashboard (owner decision D-5 v2, 2026-10-25: the system checks, publishes, corrects and withdraws by itself; the owner
 * supervises). Only systemic problems and high-impact changes are raised as alerts; no button here validates, refuses or holds a record. The pause is the
 * owner's emergency stop of the whole veille. Every record's history (sources, decisions, versions) is one click away.
 */
const OUTCOME = {
  PUBLISHED: { label: 'Publiée', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  CREATED: { label: 'Ajoutée', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  UPDATED: { label: 'Mise à jour', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
  CORRECTED: { label: 'Corrigée', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
  WITHDRAWN: { label: 'Retirée', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  RETRY: { label: 'À réessayer', cls: 'border-slate-300 bg-slate-50 text-slate-800' },
  UNRESOLVED: { label: 'Non résolue', cls: 'border-slate-300 bg-slate-50 text-slate-800' },
  OK: { label: 'Vérifiée', cls: 'border-slate-300 bg-slate-50 text-slate-800' },
};
const FILTERS = [['all', 'Tout'], ['PUBLISHED,CREATED', 'Publiées et ajoutées'], ['UPDATED,CORRECTED', 'Mises à jour'], ['WITHDRAWN', 'Retirées'], ['RETRY,UNRESOLVED', 'Pas encore résolues']];
const KIND = { aide: 'Aide', demarche: 'Démarche', dispositif: 'Dispositif', structure: 'Structure', fiche: 'Fiche Service-Public' };
const KINDS_PLURAL = { aide: 'aides', demarche: 'démarches', dispositif: 'dispositifs', structure: 'structures' };
const LEVEL = { NATIONAL: 'État et opérateurs nationaux', EUROPEEN: 'Institutions européennes', OPERATEUR: 'Opérateurs de services publics cités par Service-Public', ORGANISME: 'Organismes de sécurité sociale', REGIONAL: 'Région', DEPARTEMENTAL: 'Département (CeA)', PREFECTURE: 'Préfecture et services de l’État', COMMUNAL: 'Communes et CCAS', REGISTRE: 'Registres officiels', '—': 'Autres' };
const CLASS = { seed: 'Liste de départ', 'annuaire-attested': 'Sites attestés par l’Annuaire de l’administration', 'dila-attested': 'Services en ligne cités par Service-Public', '—': 'Autres' };
const PHASE = { sources: 'lecture des sources officielles', aide: 'aides', demarche: 'démarches', dispositif: 'dispositifs', structure: 'structures', doublons: 'doublons', 'nouveaux services publics': 'nouveaux services publics', FINESS: 'répertoire FINESS', 'nouveaux établissements FINESS': 'nouveaux établissements FINESS', 'data·inclusion': 'data·inclusion (services attribués)', 'nouveaux lieux data·inclusion': 'nouveaux lieux data·inclusion', 'nouvelles fiches': 'nouvelles fiches Service-Public', review: 'visite des sites du registre', 'contrôle de cohérence': 'contrôle de cohérence', done: 'terminée' };
const STATUS = { success: 'terminée', partial: 'terminée en partie (le temps de la veille était écoulé ; la suite à la prochaine)', stopped: 'arrêtée (pause ou machine occupée) ; la suite à la prochaine', error: 'interrompue par une erreur', running: 'en cours', interrupted: 'interrompue (serveur arrêté) ; reprise automatique', skipped: 'reportée' };
const FEED = { 'dila-service-public': 'Service-Public (DILA)', 'annuaire-administration': "Annuaire de l'administration", sirene: 'Répertoire SIRENE', finess: 'Répertoire FINESS+ (Agence du numérique en santé)', 'data-inclusion': 'data·inclusion (GIP de l’inclusion, services attribués à leurs producteurs)' };
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)} %` : '—');
const LEVEL_STYLE = { critical: 'border-rose-300 bg-rose-50 text-rose-950', warning: 'border-amber-300 bg-amber-50 text-amber-950', info: 'border-blue-200 bg-blue-50 text-blue-950' };
const adminLink = (e) => ({ aide: '/admin/aides', demarche: '/admin/demarches', dispositif: '/admin/dispositifs', structure: '/admin/structures' }[e.entityType] || null);

function Section({ title, intro, testid, children }) {
  return (
    <Card><CardContent className="p-5" data-testid={testid}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {intro ? <p className="mt-1 text-sm text-slate-700">{intro}</p> : null}
      <div className="mt-3">{children}</div>
    </CardContent></Card>
  );
}

/** the history of one record, from its sources to the decisions */
function History({ kind, id }) {
  const [h, setH] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { apiClient.admin.getVeilleHistory(kind, id).then(setH).catch((e) => setErr(e?.message || 'Historique indisponible.')); }, [kind, id]);
  if (err) return <p role="alert" className="mt-2 text-sm text-rose-900">{err}</p>;
  if (!h) return <p className="mt-2 flex items-center gap-2 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement de l’historique…</p>;
  const r = h.record;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="admin-veille-history">
      <p className="text-slate-900"><strong>{r.title}</strong> — {r.statut}, {r.verificationStatus === 'VERIFIED' ? `vérifiée par ${r.verifiedBy === 'ada-veille-automatique' ? 'la veille automatique' : 'une personne'}` : 'non vérifiée'}{r.hold ? ` ; retenue : ${r.hold}` : ''}.
        {r.sourceUrl ? <> <a className="text-blue-700 underline underline-offset-2" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">Source officielle</a></> : null}
        {r.autoCheck?.nextCheckAt ? <> Prochaine vérification : {when(r.autoCheck.nextCheckAt)} ({r.autoCheck.tier?.toLowerCase?.() || 'quotidienne'}).</> : null}</p>
      <div><h3 className="font-semibold text-slate-900">Décisions (registre des vérifications)</h3>
        {h.ledger.length === 0 ? <p className="text-slate-700">Aucune.</p> : <ul className="mt-1 space-y-1">{h.ledger.map((l) => <li key={l.id}><span className="font-medium">{when(l.createdAt)}</span> — {l.outcome} par {l.reviewerRole === 'system' ? 'la veille automatique' : `une personne (${l.reviewerId})`}{l.evidenceNote ? ` : ${l.evidenceNote.slice(0, 260)}` : ''}</li>)}</ul>}</div>
      <div><h3 className="font-semibold text-slate-900">Versions de la source officielle</h3>
        {h.snapshots.length === 0 ? <p className="text-slate-700">Aucune lecture enregistrée.</p> : <ul className="mt-1 space-y-1">{h.snapshots.map((s) => <li key={s.id}><span className="font-medium">{when(s.fetchedAt)}</span> — {s.title || s.url}{s.importantChangeAt ? ` (modification importante du ${String(s.importantChangeAt).slice(0, 10)})` : ''}, empreinte {String(s.fingerprint || '').slice(0, 10)}</li>)}</ul>}</div>
      <div><h3 className="font-semibold text-slate-900">Versions du contenu (restaurables)</h3>
        {h.versions.length === 0 ? <p className="text-slate-700">Aucune.</p> : <ul className="mt-1 space-y-1">{h.versions.map((v) => <li key={v.id}><span className="font-medium">{when(v.createdAt)}</span> — {v.reason || 'version'}{v.actor ? ` (${v.actor === 'ada-veille-automatique' ? 'veille automatique' : v.actor})` : ''}</li>)}</ul>}
        <Link to={`/admin/versions?type=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`} className="mt-1 inline-block text-blue-700 underline underline-offset-2">Comparer ou revenir à une version</Link></div>
      <div><h3 className="font-semibold text-slate-900">Ce que la veille a noté</h3>
        <ul className="mt-1 space-y-1">{h.events.map((e) => <li key={e.id}><span className="font-medium">{when(e.createdAt)}</span> — {(OUTCOME[e.outcome] || { label: e.outcome }).label} : {e.summary}</li>)}</ul></div>
    </div>
  );
}

export default function AdminVeille() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    setError(null);
    apiClient.admin.getVeille(7).then(setData).catch((e) => setError(e?.message || 'Chargement impossible.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  // while a run is in progress the page follows it
  useEffect(() => { if (!data?.status?.running) return undefined; const t = setInterval(load, 15000); return () => clearInterval(t); }, [data?.status?.running, load]);
  const events = useMemo(() => (data?.events || []).filter((e) => filter === 'all' || filter.split(',').includes(e.outcome)), [data, filter]);
  const act = async (fn, okText) => {
    setBusy(true); setMessage(null);
    try { const r = await fn(); setMessage(typeof okText === 'function' ? okText(r) : okText); setTimeout(load, 1500); }
    catch (e) { setMessage(e?.message || 'Action impossible.'); }
    finally { setBusy(false); }
  };
  const paused = data?.status?.paused?.paused;
  const running = data?.status?.running;
  const last = data?.status?.lastRun;
  const p = data?.period;

  return (
    <div className="space-y-6" data-testid="admin-veille">
      <SEO title="Veille automatique" noindex />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Veille automatique</h1>
          <p className="mt-2 max-w-3xl text-slate-700" data-testid="admin-veille-intro">
            Chaque nuit à 3 h 17 (et dès que le Mac se réveille si la nuit a été manquée), le système vérifie lui-même chaque fiche auprès des sources officielles :
            Service-Public (DILA), l’Annuaire de l’administration, le répertoire SIRENE et les sites des organismes publics. Il publie ce qu’il a pu confirmer, met
            à jour ce qui a changé, retire ce qui n’existe plus, fusionne les doublons et ajoute de nouveaux services publics. <strong>Vous n’avez rien à valider</strong> :
            cette page vous dit ce qui s’est passé, avec les preuves, et ne vous alerte que pour ce qui compte.
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap gap-2">
            {data.runner === 'inline' && !paused && (
              <Button onClick={() => act(() => apiClient.admin.runVeille(), (r) => (r?.alreadyRunning ? 'Une veille est déjà en cours.' : 'Veille lancée : les résultats apparaissent ici au fil de l’eau.'))}
                disabled={busy || Boolean(running) || data.running} data-testid="admin-veille-run-now" className="gap-2">
                {busy || running || data.running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {running || data.running ? 'Veille en cours…' : 'Lancer une veille maintenant'}
              </Button>
            )}
            {paused ? (
              <Button variant="outline" onClick={() => act(() => apiClient.admin.resumeVeille(), 'Veille reprise.')} disabled={busy} data-testid="admin-veille-resume" className="gap-2">
                <Play className="h-4 w-4" aria-hidden="true" /> Reprendre la veille
              </Button>
            ) : (
              <Button variant="outline" onClick={() => act(() => apiClient.admin.pauseVeille('arrêt d’urgence depuis la page de la veille'), 'Veille en pause : la veille en cours s’arrête à la fiche suivante, aucune autre ne démarre.')}
                disabled={busy} data-testid="admin-veille-pause" className="gap-2">
                <Pause className="h-4 w-4" aria-hidden="true" /> Mettre en pause
              </Button>
            )}
          </div>
        )}
      </div>
      {message && <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">{message}</p>}
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">{error}</p>}
      {!data && !error && <p className="flex items-center gap-2 text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement…</p>}

      {data && (
        <>
          <div data-testid="admin-veille-alerts" className="space-y-2">
            {(data.alerts || []).length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Aucun problème : la veille fonctionne normalement.</p>
            ) : data.alerts.map((a, i) => (
              <p key={`${a.code}-${i}`} role={a.level === 'critical' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-md border px-3 py-2 ${LEVEL_STYLE[a.level] || LEVEL_STYLE.info}`}>
                {a.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}<span>{a.message}</span>
              </p>
            ))}
          </div>

          {running && (
            <Card data-testid="admin-veille-progress"><CardContent className="p-5">
              <p className="flex items-center gap-2 font-semibold text-slate-900"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Veille en cours depuis {when(running.startedAt)}</p>
              <p className="mt-1 text-slate-700">Étape : {PHASE[running.progress?.phase] || running.progress?.phase || '…'}{running.progress?.total ? ` — ${running.progress.done} / ${running.progress.total}` : ''}{running.progress?.current ? ` (${running.progress.current})` : ''}.</p>
              <p className="mt-1 text-sm text-slate-600">Dernier signe de vie : {when(running.heartbeatAt)}. La page se met à jour toute seule.</p>
            </CardContent></Card>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card data-testid="admin-veille-last-run"><CardContent className="p-5">
              <p className="text-sm text-slate-600">Dernière veille</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{last ? when(last.startedAt) : 'Pas encore de veille'}</p>
              {last && <p className="mt-1 text-sm text-slate-700">{STATUS[last.status] || last.status}{last.durationMs ? ` en ${Math.max(1, Math.round(last.durationMs / 60000))} min` : ''}</p>}
              <p className="mt-2 text-sm text-slate-600">Prochaine : {paused ? 'en pause' : data.next?.at ? when(data.next.at) : 'cette nuit à 3 h 17 (calendrier du serveur)'}.</p>
            </CardContent></Card>
            <Card data-testid="admin-veille-totals"><CardContent className="p-5">
              <p className="text-sm text-slate-600">Fiches publiées</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                {(data.totals || []).map((t) => <li key={t.kind}><strong>{t.published}</strong> {KINDS_PLURAL[t.kind] || t.kind} sur {t.total}{t.withdrawnBySystem ? <span className="text-sm text-slate-600"> ({t.withdrawnBySystem} retirées)</span> : null}</li>)}
              </ul>
            </CardContent></Card>
            <Card data-testid="admin-veille-week"><CardContent className="p-5">
              <p className="text-sm text-slate-600">Ces 7 derniers jours</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                <li><strong>{p?.checked ?? 0}</strong> vérifications</li>
                <li><strong>{(p?.published ?? 0) + (p?.created ?? 0)}</strong> publiées ou ajoutées</li>
                <li><strong>{p?.updated ?? 0}</strong> mises à jour</li>
                <li><strong>{p?.withdrawn ?? 0}</strong> retirées, <strong>{p?.duplicates ?? 0}</strong> doublons fusionnés</li>
                <li><strong>{p?.textsRefused ?? 0}</strong> textes refusés par le contrôle</li>
              </ul>
            </CardContent></Card>
            <Card data-testid="admin-veille-freshness"><CardContent className="p-5">
              <p className="text-sm text-slate-600">Fraîcheur (fiches publiques vérifiées depuis moins de 48 h)</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                {(data.freshness || []).filter((f) => f.public > 0).map((f) => <li key={f.kind}><strong>{pct(f.within48h, f.public)}</strong> des {KINDS_PLURAL[f.kind]} ({f.within48h}/{f.public})</li>)}
                {(data.freshness || []).every((f) => !f.public) ? <li className="text-slate-700">Aucune fiche publique pour l’instant.</li> : null}
              </ul>
            </CardContent></Card>
          </div>

          <Section title="Changements importants" testid="admin-veille-important" intro="Conditions, montants, âges, textes juridiques ou territoire modifiés dans une source officielle : déjà répercutés sur les fiches (textes réécrits et contrôlés).">
            {(data.important || []).length === 0 ? <p className="text-slate-700">Aucun cette semaine.</p> : (
              <ul className="space-y-2">{data.important.map((e) => <li key={e.id} className="text-sm text-slate-800"><strong>{KIND[e.entityType] || e.entityType} « {e.title} »</strong> ({when(e.createdAt)}){e.legal ? ' — textes juridiques' : ''}{e.territorial ? ' — territoire' : ''} : {e.summary}</li>)}</ul>
            )}
          </Section>

          <Card><CardContent className="p-5" data-testid="admin-veille-events">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Ce que le système a fait</h2>
              <label className="flex items-center gap-2 text-sm text-slate-700">Afficher
                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900" data-testid="admin-veille-filter">
                  {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            {events.length === 0 ? <p className="mt-3 text-slate-700">Rien à afficher pour ce choix.</p> : (
              <ul className="mt-3 divide-y divide-slate-200">
                {events.slice(0, 200).map((e) => (
                  <li key={e.id} className="py-3" data-testid="admin-veille-event">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${(OUTCOME[e.outcome] || OUTCOME.OK).cls}`}>{(OUTCOME[e.outcome] || { label: e.outcome }).label}</span>
                      {e.entityType && <span className="text-xs text-slate-600">{KIND[e.entityType] || e.entityType}</span>}
                      <span className="font-medium text-slate-900">{e.details?.title || ''}</span>
                      <span className="text-xs text-slate-600">{when(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{e.summary}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm">
                      {KINDS_PLURAL[e.entityType] && e.entityId ? (
                        <button type="button" className="text-blue-700 underline underline-offset-2" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? 'Masquer l’historique' : 'Historique (sources, décisions, versions)'}
                        </button>
                      ) : null}
                      {adminLink(e) && e.details?.title ? <Link to={`${adminLink(e)}?q=${encodeURIComponent(e.details.title)}`} className="text-blue-700 underline underline-offset-2">Voir la fiche</Link> : null}
                    </div>
                    {open === e.id ? <History kind={e.entityType} id={e.entityId} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>

          <Section title="Ce que le système n’a pas encore pu résoudre" testid="admin-veille-unresolved" intro="Il réessaie à chaque veille. Aucune action n’est nécessaire ; si vous connaissez la page officielle d’une fiche, vous pouvez l’ajouter dans la fiche, le système la vérifiera.">
            {(data.unresolved || []).length === 0 ? <p className="text-slate-700">Rien pour l’instant.</p> : (
              <ul className="space-y-2">{data.unresolved.map((u) => <li key={`${u.entity_type}:${u.entity_id}`} className="text-sm text-slate-800"><strong>{KIND[u.entity_type] || u.entity_type}{u.title ? ` « ${u.title} »` : ''}</strong> — {u.summary} <span className="text-slate-600">({u.times} essais)</span></li>)}</ul>
            )}
          </Section>

          <Section title="Textes refusés par le contrôle automatique" testid="admin-veille-texts-rejected" intro="Le modèle local rédige ; le contrôle refuse tout texte avec un nombre absent de la source, une phrase trop longue, un mot difficile non expliqué ou une condition que la source ne pose pas. Une fiche refusée n’est pas publiée et le système réessaie à la veille suivante, avec les mêmes exigences.">
            {(data.textsRejected || []).length === 0 ? <p className="text-slate-700">Aucun cette semaine.</p> : (
              <ul className="space-y-2">{data.textsRejected.map((t) => <li key={t.id} className="text-sm text-slate-800"><strong>{KIND[t.entityType] || t.entityType} « {t.title} »</strong> ({when(t.createdAt)}) : {(t.reasons || []).join(' ; ').slice(0, 400)}</li>)}</ul>
            )}
          </Section>

          <Section title="Sources officielles suivies" testid="admin-veille-sources"
            intro={`La liste se met à jour seule chaque semaine (sites attestés par l’Annuaire de l’administration, services en ligne cités par Service-Public) ; chaque site est revisité une fois par mois.${data.sources?.lastRefresh ? ` Dernière mise à jour : ${when(data.sources.lastRefresh)} ; prochaine vers le ${when(data.sources.nextRefresh)}.` : ''}`}>
            <p className="text-slate-900"><strong>{data.sources?.active ?? 0}</strong> sources actives sur {data.sources?.total ?? 0} ; <strong>{data.sources?.newSince ?? 0}</strong> nouvelles cette semaine ; <strong>{data.sources?.rejectedCount ?? 0}</strong> écartées ; {data.sources?.retired ?? 0} retirées ; {data.sources?.reviewedLast30d ?? 0} visitées ce mois-ci.</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div><h3 className="font-semibold text-slate-900">Par niveau</h3>
                <ul className="mt-1 space-y-1">{(data.sources?.byLevel || []).map((l) => <li key={l.level} className="text-sm text-slate-800"><strong>{l.active}</strong> — {LEVEL[l.level] || l.level}</li>)}</ul></div>
              <div><h3 className="font-semibold text-slate-900">Par origine</h3>
                <ul className="mt-1 space-y-1">{(data.sources?.byClass || []).map((l) => <li key={l.cls} className="text-sm text-slate-800"><strong>{l.active}</strong> — {CLASS[l.cls] || l.cls}</li>)}</ul></div>
            </div>
            <div className="mt-4" data-testid="admin-veille-feeds"><h3 className="font-semibold text-slate-900">Flux lus chaque nuit</h3>
              <ul className="mt-1 space-y-1">{(data.sources?.feeds || []).map((f) => <li key={f.sourceId} className="text-sm text-slate-800"><strong>{FEED[f.sourceId] || f.name}</strong> : {f.health ? (f.health.ok ? `répond (${when(f.health.checkedAt)})` : `ne répond pas depuis le ${String(f.health.outageSince || '').slice(0, 10)} (${f.health.error || '—'})`) : 'pas encore lu'}{f.lastChangeAt ? ` ; dernière nouvelle version : ${when(f.lastChangeAt)}` : ''}</li>)}</ul></div>
            {(data.sources?.newest || []).length ? <div className="mt-4"><h3 className="font-semibold text-slate-900">Nouvelles sources</h3>
              <ul className="mt-1 space-y-1">{data.sources.newest.map((s) => <li key={s.name} className="text-sm text-slate-800">{s.name} — {s.attestation}{s.attestationUrl ? <> (<a className="text-blue-700 underline underline-offset-2" href={s.attestationUrl} target="_blank" rel="noopener noreferrer">preuve</a>)</> : null}</li>)}</ul></div> : null}
            {(data.sources?.paused || []).length ? <div className="mt-4"><h3 className="font-semibold text-slate-900">Sources mises de côté</h3>
              <ul className="mt-1 space-y-1">{data.sources.paused.map((s) => <li key={s.name} className="text-sm text-slate-800">{s.name} — {s.status === 'PAUSED' ? 'redirige vers un site non attesté' : 'injoignable depuis plusieurs visites'}{s.health?.reviewError ? ` (${s.health.reviewError})` : ''}</li>)}</ul></div> : null}
            {(data.sources?.rejected || []).length ? <div className="mt-4" data-testid="admin-veille-rejected"><h3 className="font-semibold text-slate-900">Écartées (et pourquoi)</h3>
              <ul className="mt-1 space-y-1">{data.sources.rejected.slice(0, 20).map((s, i) => <li key={`${s.host}-${i}`} className="text-sm text-slate-800">{s.host}{s.name ? ` (${s.name})` : ''} — {s.reason}</li>)}</ul></div> : null}
            <Link to="/admin/sources" className="mt-3 inline-block text-sm text-blue-700 underline underline-offset-2">Voir la liste complète des sources</Link>
          </Section>

          <Section title="Contrôle de cohérence" testid="admin-veille-audit" intro="À la fin de chaque veille, le système relit tout ce qui est public : décision enregistrée, preuve sur un site officiel, aucune adresse électronique personnelle, fraîcheur, doublons. Une fiche qui ne respecte pas ces règles est retirée d’elle-même.">
            {data.audit ? (
              <p className="text-slate-900"><strong>{data.audit.checked}</strong> fiches publiques relues le {when(data.audit.at)} : <strong>{data.audit.violations}</strong> écart(s){data.audit.violations ? ` (${Object.entries(data.audit.byCode || {}).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}{data.audit.withdrawn ? ` ; ${data.audit.withdrawn} retirée(s)` : ''}.</p>
            ) : <p className="text-slate-700">Pas encore de contrôle.</p>}
          </Section>

          <Section title="La machine" testid="admin-veille-machine" intro="La veille ne démarre pas pendant une campagne de QA native ni sous 10 Gio d’espace libre ; le modèle local n’écrit que si la mémoire le permet et il est déchargé à la fin.">
            {(() => {
              const m = data.machine?.live || data.machine?.lastRun?.end || data.machine?.lastRun?.start || null;
              if (!m) return <p className="text-slate-700">Pas de mesure (la machine n’est surveillée que sur le serveur du LAB).</p>;
              return (
                <ul className="space-y-1 text-sm text-slate-800">
                  <li>Espace disque libre : <strong>{m.disk?.freeGb ?? '—'} Gio</strong></li>
                  <li>Mémoire disponible : <strong>{m.memory?.availablePct ?? '—'} %</strong> ; mémoire d’échange utilisée : {m.memory?.swapUsedGb != null ? `${Math.round(m.memory.swapUsedGb * 10) / 10} Gio` : '—'}</li>
                  <li>Charge du processeur : {m.load?.one ?? '—'} pour {m.load?.cores ?? '—'} cœurs</li>
                  <li>Campagne de QA native en cours : {m.qa ? (m.qa.running ? 'oui (la veille attend)' : 'non') : '—'}</li>
                  {data.machine?.model ? <li>Modèle local à la dernière veille : {data.machine.model.used ? `utilisé${data.machine.model.unloaded ? ', puis déchargé' : ''}` : 'non utilisé'}{data.machine.model.deferredBecause ? ` (textes reportés : ${data.machine.model.deferredBecause})` : ''}</li> : null}
                </ul>
              );
            })()}
          </Section>
        </>
      )}
    </div>
  );
}
