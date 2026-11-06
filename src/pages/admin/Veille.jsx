// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Pause, Play, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import i18n, { formatDate, formatDateTime, useLanguage, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * Automatic verification — the owner's dashboard (owner decision D-5 v2, 2026-10-25: the system checks, publishes, corrects and withdraws by itself; the owner
 * supervises). Only systemic problems and high-impact changes are raised as alerts; no button here validates, refuses or holds a record. The pause is the
 * owner's emergency stop of the whole veille. Every record's history (sources, decisions, versions) is one click away.
 * R37: the labels follow the interface language (useVeilleLabels); the French text is the default of each key.
 */
const OUTCOME_CLS = {
  PUBLISHED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  CREATED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  UPDATED: 'border-blue-300 bg-blue-50 text-blue-900',
  CORRECTED: 'border-blue-300 bg-blue-50 text-blue-900',
  WITHDRAWN: 'border-amber-300 bg-amber-50 text-amber-900',
  RETRY: 'border-slate-300 bg-slate-50 text-slate-800',
  UNRESOLVED: 'border-slate-300 bg-slate-50 text-slate-800',
  OK: 'border-slate-300 bg-slate-50 text-slate-800',
};
const when = (d) => (d ? formatDate(d, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)} %` : '—');
const LEVEL_STYLE = { critical: 'border-rose-300 bg-rose-50 text-rose-950', warning: 'border-amber-300 bg-amber-50 text-amber-950', info: 'border-blue-200 bg-blue-50 text-blue-950' };
const adminLink = (e) => ({ aide: '/admin/aides', demarche: '/admin/demarches', dispositif: '/admin/dispositifs', structure: '/admin/structures' }[e.entityType] || null);

/** the label maps of the page, in the interface language */
function useVeilleLabels() {
  const { t } = useT('admin');
  const OUTCOME = {
    PUBLISHED: t('admin:veille.outcome.published', 'Publiée'),
    CREATED: t('admin:veille.outcome.created', 'Ajoutée'),
    UPDATED: t('admin:veille.outcome.updated', 'Mise à jour'),
    CORRECTED: t('admin:veille.outcome.corrected', 'Corrigée'),
    WITHDRAWN: t('admin:veille.outcome.withdrawn', 'Retirée'),
    RETRY: t('admin:veille.outcome.retry', 'À réessayer'),
    UNRESOLVED: t('admin:veille.outcome.unresolved', 'Non résolue'),
    OK: t('admin:veille.outcome.ok', 'Vérifiée'),
  };
  const FILTERS = [['all', t('admin:veille.filter.all', 'Tout')], ['PUBLISHED,CREATED', t('admin:veille.filter.published', 'Publiées et ajoutées')], ['UPDATED,CORRECTED', t('admin:veille.filter.updated', 'Mises à jour')], ['WITHDRAWN', t('admin:veille.filter.withdrawn', 'Retirées')], ['RETRY,UNRESOLVED', t('admin:veille.filter.unresolved', 'Pas encore résolues')]];
  const KIND = { aide: t('admin:veille.kind.aide', 'Aide'), demarche: t('admin:veille.kind.demarche', 'Démarche'), dispositif: t('admin:veille.kind.dispositif', 'Dispositif'), structure: t('admin:veille.kind.structure', 'Structure'), fiche: t('admin:veille.kind.fiche', 'Fiche Service-Public') };
  const KINDS_PLURAL = { aide: t('admin:veille.kinds.aide', 'aides'), demarche: t('admin:veille.kinds.demarche', 'démarches'), dispositif: t('admin:veille.kinds.dispositif', 'dispositifs'), structure: t('admin:veille.kinds.structure', 'structures') };
  const LEVEL = { NATIONAL: t('admin:veille.level.national', 'État et opérateurs nationaux'), EUROPEEN: t('admin:veille.level.europeen', 'Institutions européennes'), OPERATEUR: t('admin:veille.level.operateur', 'Opérateurs de services publics cités par Service-Public'), ORGANISME: t('admin:veille.level.organisme', 'Organismes de sécurité sociale'), REGIONAL: t('admin:veille.level.regional', 'Région'), DEPARTEMENTAL: t('admin:veille.level.departemental', 'Département (CeA)'), PREFECTURE: t('admin:veille.level.prefecture', 'Préfecture et services de l’État'), COMMUNAL: t('admin:veille.level.communal', 'Communes et CCAS'), REGISTRE: t('admin:veille.level.registre', 'Registres officiels'), '—': t('admin:veille.level.other', 'Autres') };
  const CLASS = { seed: t('admin:veille.class.seed', 'Liste de départ'), 'annuaire-attested': t('admin:veille.class.annuaire', 'Sites attestés par l’Annuaire de l’administration'), 'dila-attested': t('admin:veille.class.dila', 'Services en ligne cités par Service-Public'), '—': t('admin:veille.class.other', 'Autres') };
  const PHASE = { sources: t('admin:veille.phase.sources', 'lecture des sources officielles'), aide: t('admin:veille.kinds.aide', 'aides'), demarche: t('admin:veille.kinds.demarche', 'démarches'), dispositif: t('admin:veille.kinds.dispositif', 'dispositifs'), structure: t('admin:veille.kinds.structure', 'structures'), doublons: t('admin:veille.phase.doublons', 'doublons'), 'nouveaux services publics': t('admin:veille.phase.new_services', 'nouveaux services publics'), FINESS: t('admin:veille.phase.finess', 'répertoire FINESS'), 'nouveaux établissements FINESS': t('admin:veille.phase.new_finess', 'nouveaux établissements FINESS'), 'data·inclusion': t('admin:veille.phase.data_inclusion', 'data·inclusion (services attribués)'), 'nouveaux lieux data·inclusion': t('admin:veille.phase.new_data_inclusion', 'nouveaux lieux data·inclusion'), 'nouvelles fiches': t('admin:veille.phase.new_fiches', 'nouvelles fiches Service-Public'), review: t('admin:veille.phase.review', 'visite des sites du registre'), 'contrôle de cohérence': t('admin:veille.phase.audit', 'contrôle de cohérence'), done: t('admin:veille.phase.done', 'terminée') };
  const STATUS = { success: t('admin:veille.status.success', 'terminée'), partial: t('admin:veille.status.partial', 'terminée en partie (le temps de la veille était écoulé ; la suite à la prochaine)'), stopped: t('admin:veille.status.stopped', 'arrêtée (pause ou machine occupée) ; la suite à la prochaine'), error: t('admin:veille.status.error', 'interrompue par une erreur'), running: t('admin:veille.status.running', 'en cours'), interrupted: t('admin:veille.status.interrupted', 'interrompue (serveur arrêté) ; reprise automatique'), skipped: t('admin:veille.status.skipped', 'reportée') };
  const FEED = { 'dila-service-public': t('admin:veille.feed.dila', 'Service-Public (DILA)'), 'annuaire-administration': t('admin:veille.feed.annuaire', "Annuaire de l'administration"), sirene: t('admin:veille.feed.sirene', 'Répertoire SIRENE'), finess: t('admin:veille.feed.finess', 'Répertoire FINESS+ (Agence du numérique en santé)'), 'data-inclusion': t('admin:veille.feed.data_inclusion', 'data·inclusion (GIP de l’inclusion, services attribués à leurs producteurs)') };
  return { t, OUTCOME, FILTERS, KIND, KINDS_PLURAL, LEVEL, CLASS, PHASE, STATUS, FEED };
}

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
  const { t, OUTCOME } = useVeilleLabels();
  const [h, setH] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { apiClient.admin.getVeilleHistory(kind, id).then(setH).catch((e) => setErr(e?.message || t('admin:veille.history_unavailable', 'Historique indisponible.'))); }, [kind, id]);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once per record; the message follows the language at load time
  if (err) return <p role="alert" className="mt-2 text-sm text-rose-900">{err}</p>;
  if (!h) return <p className="mt-2 flex items-center gap-2 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('admin:veille.history_loading', 'Chargement de l’historique…')}</p>;
  const r = h.record;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="admin-veille-history">
      <p className="text-slate-900"><strong>{r.title}</strong> — {r.statut}, {r.verificationStatus === 'VERIFIED' ? (r.verifiedBy === 'ada-veille-automatique' ? t('admin:veille.verified_by_system', 'vérifiée par la veille automatique') : t('admin:veille.verified_by_person', 'vérifiée par une personne')) : t('admin:veille.not_verified', 'non vérifiée')}{r.hold ? t('admin:veille.hold', ' ; retenue : {{hold}}', { hold: r.hold }) : ''}.
        {r.sourceUrl ? <> <a className="text-blue-700 underline underline-offset-2" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{t('admin:veille.official_source', 'Source officielle')}</a></> : null}
        {r.autoCheck?.nextCheckAt ? <> {t('admin:veille.next_check', 'Prochaine vérification : {{date}} ({{tier}}).', { date: when(r.autoCheck.nextCheckAt), tier: r.autoCheck.tier?.toLowerCase?.() || t('admin:veille.daily', 'quotidienne') })}</> : null}</p>
      <div><h3 className="font-semibold text-slate-900">{t('admin:veille.decisions_title', 'Décisions (registre des vérifications)')}</h3>
        {h.ledger.length === 0 ? <p className="text-slate-700">{t('admin:veille.none_f', 'Aucune.')}</p> : <ul className="mt-1 space-y-1">{h.ledger.map((l) => <li key={l.id}><span className="font-medium">{when(l.createdAt)}</span> — {t('admin:veille.ledger_line', '{{outcome}} par {{who}}{{note}}', { outcome: l.outcome, who: l.reviewerRole === 'system' ? t('admin:veille.by_system', 'la veille automatique') : t('admin:veille.by_person', 'une personne ({{id}})', { id: l.reviewerId }), note: l.evidenceNote ? t('admin:veille.note_suffix', ' : {{note}}', { note: l.evidenceNote.slice(0, 260) }) : '' })}</li>)}</ul>}</div>
      <div><h3 className="font-semibold text-slate-900">{t('admin:veille.snapshots_title', 'Versions de la source officielle')}</h3>
        {h.snapshots.length === 0 ? <p className="text-slate-700">{t('admin:veille.no_snapshot', 'Aucune lecture enregistrée.')}</p> : <ul className="mt-1 space-y-1">{h.snapshots.map((s) => <li key={s.id}><span className="font-medium">{when(s.fetchedAt)}</span> — {t('admin:veille.snapshot_line', '{{title}}{{important}}, empreinte {{fingerprint}}', { title: s.title || s.url, important: s.importantChangeAt ? t('admin:veille.important_change', ' (modification importante du {{date}})', { date: String(s.importantChangeAt).slice(0, 10) }) : '', fingerprint: String(s.fingerprint || '').slice(0, 10) })}</li>)}</ul>}</div>
      <div><h3 className="font-semibold text-slate-900">{t('admin:veille.versions_title', 'Versions du contenu (restaurables)')}</h3>
        {h.versions.length === 0 ? <p className="text-slate-700">{t('admin:veille.none_f', 'Aucune.')}</p> : <ul className="mt-1 space-y-1">{h.versions.map((v) => <li key={v.id}><span className="font-medium">{when(v.createdAt)}</span> — {v.reason || t('admin:veille.version_fallback', 'version')}{v.actor ? ` (${v.actor === 'ada-veille-automatique' ? t('admin:veille.actor_system', 'veille automatique') : v.actor})` : ''}</li>)}</ul>}
        <Link to={`/admin/versions?type=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`} className="mt-1 inline-block text-blue-700 underline underline-offset-2">{t('admin:veille.compare_versions', 'Comparer ou revenir à une version')}</Link></div>
      <div><h3 className="font-semibold text-slate-900">{t('admin:veille.events_noted', 'Ce que la veille a noté')}</h3>
        <ul className="mt-1 space-y-1">{h.events.map((e) => <li key={e.id}><span className="font-medium">{when(e.createdAt)}</span> — {t('admin:veille.event_line', '{{label}} : {{summary}}', { label: OUTCOME[e.outcome] || e.outcome, summary: e.summary })}</li>)}</ul></div>
    </div>
  );
}

export default function AdminVeille() {
  const { t, OUTCOME, FILTERS, KIND, KINDS_PLURAL, LEVEL, CLASS, PHASE, STATUS, FEED } = useVeilleLabels();
  // R47: an alert the server writes in French is said in the interface language when its code is known (the French page keeps the server's sentence);
  // any other alert stays in French, marked lang="fr"
  const { isSource } = useLanguage(); const fr = useFrAttrs();
  const alertText = (/** @type {any} */ a) => {
    if (isSource) return a.message;
    if (a.code === 'NO_RUN' && 'since' in a) return a.since ? t('admin:veille.alert.no_run_since', 'Aucune veille terminée depuis le {{date}} : le serveur du LAB est-il lancé ?', { date: formatDateTime(a.since) }) : t('admin:veille.alert.no_run', 'Aucune veille terminée pour l’instant.');
    if (a.code === 'IMPORTANT_CHANGES' && typeof a.count === 'number') return t('admin:veille.alert.important_changes', '{{n}} changement(s) important(s) de conditions, de montants, de textes juridiques ou de territoire ces trois derniers jours : déjà répercutés sur les fiches (voir « Changements importants »).', { n: a.count });
    return null;
  };
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    setError(null);
    apiClient.admin.getVeille(7).then(setData).catch((e) => setError(e?.message || t('admin:veille.load_failed', 'Chargement impossible.')));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- a stable loader; the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  // while a run is in progress the page follows it
  useEffect(() => { if (!data?.status?.running) return undefined; const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [data?.status?.running, load]);
  const events = useMemo(() => (data?.events || []).filter((e) => filter === 'all' || filter.split(',').includes(e.outcome)), [data, filter]);
  const act = async (fn, okText) => {
    setBusy(true); setMessage(null);
    try { const r = await fn(); setMessage(typeof okText === 'function' ? okText(r) : okText); setTimeout(load, 1500); }
    catch (e) { setMessage(e?.message || t('admin:veille.action_failed', 'Action impossible.')); }
    finally { setBusy(false); }
  };
  const paused = data?.status?.paused?.paused;
  const running = data?.status?.running;
  const last = data?.status?.lastRun;
  const p = data?.period;
  const strong = <strong />;

  return (
    <div className="space-y-6" data-testid="admin-veille">
      <SEO title={t('admin:veille.title', 'Veille automatique')} noindex />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('admin:veille.title', 'Veille automatique')}</h1>
          <p className="mt-2 max-w-3xl text-slate-700" data-testid="admin-veille-intro">
            <Trans i18n={i18n} i18nKey="admin:veille.intro" defaults="Chaque nuit à 3 h 17 (et dès que le Mac se réveille si la nuit a été manquée), le système vérifie lui-même chaque fiche auprès des sources officielles : Service-Public (DILA), l’Annuaire de l’administration, le répertoire SIRENE et les sites des organismes publics. Il publie ce qu’il a pu confirmer, met à jour ce qui a changé, retire ce qui n’existe plus, fusionne les doublons et ajoute de nouveaux services publics. <0>Vous n’avez rien à valider</0> : cette page vous dit ce qui s’est passé, avec les preuves, et ne vous alerte que pour ce qui compte." components={[strong]} />
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap gap-2">
            {data.runner === 'inline' && !paused && (
              <Button onClick={() => act(() => apiClient.admin.runVeille(), (r) => (r?.alreadyRunning ? t('admin:veille.already_running', 'Une veille est déjà en cours.') : t('admin:veille.started', 'Veille lancée : les résultats apparaissent ici au fil de l’eau.')))}
                disabled={busy || Boolean(running) || data.running} data-testid="admin-veille-run-now" className="gap-2">
                {busy || running || data.running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {running || data.running ? t('admin:veille.running_button', 'Veille en cours…') : t('admin:veille.run_now', 'Lancer une veille maintenant')}
              </Button>
            )}
            {paused ? (
              <Button variant="outline" onClick={() => act(() => apiClient.admin.resumeVeille(), t('admin:veille.resumed', 'Veille reprise.'))} disabled={busy} data-testid="admin-veille-resume" className="gap-2">
                <Play className="h-4 w-4" aria-hidden="true" /> {t('admin:veille.resume', 'Reprendre la veille')}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => act(() => apiClient.admin.pauseVeille('arrêt d’urgence depuis la page de la veille'), t('admin:veille.paused_message', 'Veille en pause : la veille en cours s’arrête à la fiche suivante, aucune autre ne démarre.'))}
                disabled={busy} data-testid="admin-veille-pause" className="gap-2">
                <Pause className="h-4 w-4" aria-hidden="true" /> {t('admin:veille.pause', 'Mettre en pause')}
              </Button>
            )}
          </div>
        )}
      </div>
      {message && <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">{message}</p>}
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">{error}</p>}
      {!data && !error && <p className="flex items-center gap-2 text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('admin:veille.loading', 'Chargement…')}</p>}

      {data && (
        <>
          <div data-testid="admin-veille-alerts" className="space-y-2">
            {(data.alerts || []).length === 0 ? (
              <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t('admin:veille.no_problem', 'Aucun problème : la veille fonctionne normalement.')}</p>
            ) : data.alerts.map((a, i) => (
              <p key={`${a.code}-${i}`} role={a.level === 'critical' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-md border px-3 py-2 ${LEVEL_STYLE[a.level] || LEVEL_STYLE.info}`}>
                {a.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}{alertText(a) !== null ? <span>{alertText(a)}</span> : <span {...fr}>{a.message}</span>}
              </p>
            ))}
          </div>

          {running && (
            <Card data-testid="admin-veille-progress"><CardContent className="p-5">
              <p className="flex items-center gap-2 font-semibold text-slate-900"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('admin:veille.running_since', 'Veille en cours depuis {{date}}', { date: when(running.startedAt) })}</p>
              <p className="mt-1 text-slate-700">{t('admin:veille.step', 'Étape : {{phase}}{{progress}}{{current}}.', { phase: PHASE[running.progress?.phase] || running.progress?.phase || '…', progress: running.progress?.total ? ` — ${running.progress.done} / ${running.progress.total}` : '', current: running.progress?.current ? ` (${running.progress.current})` : '' })}</p>
              <p className="mt-1 text-sm text-slate-600">{t('admin:veille.heartbeat', 'Dernier signe de vie : {{date}}. La page se met à jour toute seule.', { date: when(running.heartbeatAt) })}</p>
            </CardContent></Card>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card data-testid="admin-veille-last-run"><CardContent className="p-5">
              <p className="text-sm text-slate-600">{t('admin:veille.last_run', 'Dernière veille')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{last ? when(last.startedAt) : t('admin:veille.no_run_yet', 'Pas encore de veille')}</p>
              {last && <p className="mt-1 text-sm text-slate-700">{STATUS[last.status] || last.status}{last.durationMs ? t('admin:veille.duration', ' en {{n}} min', { n: Math.max(1, Math.round(last.durationMs / 60000)) }) : ''}</p>}
              <p className="mt-2 text-sm text-slate-600">{t('admin:veille.next_run', 'Prochaine : {{next}}.', { next: paused ? t('admin:veille.next_paused', 'en pause') : data.next?.at ? when(data.next.at) : t('admin:veille.next_tonight', 'cette nuit à 3 h 17 (calendrier du serveur)') })}</p>
            </CardContent></Card>
            <Card data-testid="admin-veille-totals"><CardContent className="p-5">
              <p className="text-sm text-slate-600">{t('admin:veille.published_records', 'Fiches publiées')}</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                {(data.totals || []).map((tot) => <li key={tot.kind}><Trans i18n={i18n} i18nKey="admin:veille.total_line" defaults="<0>{{published}}</0> {{kind}} sur {{total}}" values={{ published: tot.published, kind: KINDS_PLURAL[tot.kind] || tot.kind, total: tot.total }} components={[strong]} />{tot.withdrawnBySystem ? <span className="text-sm text-slate-600">{t('admin:veille.total_withdrawn', ' ({{n}} retirées)', { n: tot.withdrawnBySystem })}</span> : null}</li>)}
              </ul>
            </CardContent></Card>
            <Card data-testid="admin-veille-week"><CardContent className="p-5">
              <p className="text-sm text-slate-600">{t('admin:veille.last_7_days', 'Ces 7 derniers jours')}</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                <li><Trans i18n={i18n} i18nKey="admin:veille.week_checked" defaults="<0>{{n}}</0> vérifications" values={{ n: p?.checked ?? 0 }} components={[strong]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:veille.week_published" defaults="<0>{{n}}</0> publiées ou ajoutées" values={{ n: (p?.published ?? 0) + (p?.created ?? 0) }} components={[strong]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:veille.week_updated" defaults="<0>{{n}}</0> mises à jour" values={{ n: p?.updated ?? 0 }} components={[strong]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:veille.week_withdrawn" defaults="<0>{{withdrawn}}</0> retirées, <1>{{duplicates}}</1> doublons fusionnés" values={{ withdrawn: p?.withdrawn ?? 0, duplicates: p?.duplicates ?? 0 }} components={[strong, strong]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:veille.week_refused" defaults="<0>{{n}}</0> textes refusés par le contrôle" values={{ n: p?.textsRefused ?? 0 }} components={[strong]} /></li>
              </ul>
            </CardContent></Card>
            <Card data-testid="admin-veille-freshness"><CardContent className="p-5">
              <p className="text-sm text-slate-600">{t('admin:veille.freshness', 'Fraîcheur (fiches publiques vérifiées depuis moins de 48 h)')}</p>
              <ul className="mt-1 space-y-1 text-slate-900">
                {(data.freshness || []).filter((f) => f.public > 0).map((f) => <li key={f.kind}><Trans i18n={i18n} i18nKey="admin:veille.freshness_line" defaults="<0>{{pct}}</0> des {{kind}} ({{within}}/{{total}})" values={{ pct: pct(f.within48h, f.public), kind: KINDS_PLURAL[f.kind], within: f.within48h, total: f.public }} components={[strong]} /></li>)}
                {(data.freshness || []).every((f) => !f.public) ? <li className="text-slate-700">{t('admin:veille.no_public_record', 'Aucune fiche publique pour l’instant.')}</li> : null}
              </ul>
            </CardContent></Card>
          </div>

          <Section title={t('admin:veille.important_title', 'Changements importants')} testid="admin-veille-important" intro={t('admin:veille.important_intro', 'Conditions, montants, âges, textes juridiques ou territoire modifiés dans une source officielle : déjà répercutés sur les fiches (textes réécrits et contrôlés).')}>
            {(data.important || []).length === 0 ? <p className="text-slate-700">{t('admin:veille.none_this_week', 'Aucun cette semaine.')}</p> : (
              <ul className="space-y-2">{data.important.map((e) => <li key={e.id} className="text-sm text-slate-800"><Trans i18n={i18n} i18nKey="admin:veille.important_line" defaults="<0>{{kind}} « {{title}} »</0> ({{date}}){{legal}}{{territorial}} : {{summary}}" values={{ kind: KIND[e.entityType] || e.entityType, title: e.title, date: when(e.createdAt), legal: e.legal ? t('admin:veille.legal', ' — textes juridiques') : '', territorial: e.territorial ? t('admin:veille.territorial', ' — territoire') : '', summary: e.summary }} components={[strong]} /></li>)}</ul>
            )}
          </Section>

          <Card><CardContent className="p-5" data-testid="admin-veille-events">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{t('admin:veille.events_title', 'Ce que le système a fait')}</h2>
              <label className="flex items-center gap-2 text-sm text-slate-700">{t('admin:veille.show', 'Afficher')}
                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900" data-testid="admin-veille-filter">
                  {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            {events.length === 0 ? <p className="mt-3 text-slate-700">{t('admin:veille.nothing_for_filter', 'Rien à afficher pour ce choix.')}</p> : (
              <ul className="mt-3 divide-y divide-slate-200">
                {events.slice(0, 200).map((e) => (
                  <li key={e.id} className="py-3" data-testid="admin-veille-event">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_CLS[e.outcome] || OUTCOME_CLS.OK}`}>{OUTCOME[e.outcome] || e.outcome}</span>
                      {e.entityType && <span className="text-xs text-slate-600">{KIND[e.entityType] || e.entityType}</span>}
                      <span className="font-medium text-slate-900">{e.details?.title || ''}</span>
                      <span className="text-xs text-slate-600">{when(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{e.summary}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm">
                      {KINDS_PLURAL[e.entityType] && e.entityId ? (
                        <button type="button" className="text-blue-700 underline underline-offset-2" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? t('admin:veille.hide_history', 'Masquer l’historique') : t('admin:veille.show_history', 'Historique (sources, décisions, versions)')}
                        </button>
                      ) : null}
                      {adminLink(e) && e.details?.title ? <Link to={`${adminLink(e)}?q=${encodeURIComponent(e.details.title)}`} className="text-blue-700 underline underline-offset-2">{t('admin:veille.see_record', 'Voir la fiche')}</Link> : null}
                    </div>
                    {open === e.id ? <History kind={e.entityType} id={e.entityId} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>

          <Section title={t('admin:veille.unresolved_title', 'Ce que le système n’a pas encore pu résoudre')} testid="admin-veille-unresolved" intro={t('admin:veille.unresolved_intro', 'Il réessaie à chaque veille. Aucune action n’est nécessaire ; si vous connaissez la page officielle d’une fiche, vous pouvez l’ajouter dans la fiche, le système la vérifiera.')}>
            {(data.unresolved || []).length === 0 ? <p className="text-slate-700">{t('admin:veille.nothing_yet', 'Rien pour l’instant.')}</p> : (
              <ul className="space-y-2">{data.unresolved.map((u) => <li key={`${u.entity_type}:${u.entity_id}`} className="text-sm text-slate-800"><strong>{KIND[u.entity_type] || u.entity_type}{u.title ? t('admin:veille.quoted_title', ' « {{title}} »', { title: u.title }) : ''}</strong> — {u.summary} <span className="text-slate-600">{t('admin:veille.attempts', '({{n}} essais)', { n: u.times })}</span></li>)}</ul>
            )}
          </Section>

          <Section title={t('admin:veille.texts_rejected_title', 'Textes refusés par le contrôle automatique')} testid="admin-veille-texts-rejected" intro={t('admin:veille.texts_rejected_intro', 'Le modèle local rédige ; le contrôle refuse tout texte avec un nombre absent de la source, une phrase trop longue, un mot difficile non expliqué ou une condition que la source ne pose pas. Une fiche refusée n’est pas publiée et le système réessaie à la veille suivante, avec les mêmes exigences.')}>
            {(data.textsRejected || []).length === 0 ? <p className="text-slate-700">{t('admin:veille.none_this_week', 'Aucun cette semaine.')}</p> : (
              <ul className="space-y-2">{data.textsRejected.map((tx) => <li key={tx.id} className="text-sm text-slate-800"><Trans i18n={i18n} i18nKey="admin:veille.text_rejected_line" defaults="<0>{{kind}} « {{title}} »</0> ({{date}}) : {{reasons}}" values={{ kind: KIND[tx.entityType] || tx.entityType, title: tx.title, date: when(tx.createdAt), reasons: (tx.reasons || []).join(' ; ').slice(0, 400) }} components={[strong]} /></li>)}</ul>
            )}
          </Section>

          <Section title={t('admin:veille.sources_title', 'Sources officielles suivies')} testid="admin-veille-sources"
            intro={`${t('admin:veille.sources_intro', 'La liste se met à jour seule chaque semaine (sites attestés par l’Annuaire de l’administration, services en ligne cités par Service-Public) ; chaque site est revisité une fois par mois.')}${data.sources?.lastRefresh ? t('admin:veille.sources_refresh', ' Dernière mise à jour : {{last}} ; prochaine vers le {{next}}.', { last: when(data.sources.lastRefresh), next: when(data.sources.nextRefresh) }) : ''}`}>
            <p className="text-slate-900"><Trans i18n={i18n} i18nKey="admin:veille.sources_summary" defaults="<0>{{active}}</0> sources actives sur {{total}} ; <1>{{newSince}}</1> nouvelles cette semaine ; <2>{{rejected}}</2> écartées ; {{retired}} retirées ; {{reviewed}} visitées ce mois-ci." values={{ active: data.sources?.active ?? 0, total: data.sources?.total ?? 0, newSince: data.sources?.newSince ?? 0, rejected: data.sources?.rejectedCount ?? 0, retired: data.sources?.retired ?? 0, reviewed: data.sources?.reviewedLast30d ?? 0 }} components={[strong, strong, strong]} /></p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div><h3 className="font-semibold text-slate-900">{t('admin:veille.by_level', 'Par niveau')}</h3>
                <ul className="mt-1 space-y-1">{(data.sources?.byLevel || []).map((l) => <li key={l.level} className="text-sm text-slate-800"><strong>{l.active}</strong> — {LEVEL[l.level] || l.level}</li>)}</ul></div>
              <div><h3 className="font-semibold text-slate-900">{t('admin:veille.by_origin', 'Par origine')}</h3>
                <ul className="mt-1 space-y-1">{(data.sources?.byClass || []).map((l) => <li key={l.cls} className="text-sm text-slate-800"><strong>{l.active}</strong> — {CLASS[l.cls] || l.cls}</li>)}</ul></div>
            </div>
            <div className="mt-4" data-testid="admin-veille-feeds"><h3 className="font-semibold text-slate-900">{t('admin:veille.feeds_title', 'Flux lus chaque nuit')}</h3>
              <ul className="mt-1 space-y-1">{(data.sources?.feeds || []).map((f) => <li key={f.sourceId} className="text-sm text-slate-800"><strong>{FEED[f.sourceId] || f.name}</strong>{t('admin:veille.feed_line', ' : {{status}}{{last}}', { status: f.health ? (f.health.ok ? t('admin:veille.feed_ok', 'répond ({{date}})', { date: when(f.health.checkedAt) }) : t('admin:veille.feed_down', 'ne répond pas depuis le {{since}} ({{error}})', { since: String(f.health.outageSince || '').slice(0, 10), error: f.health.error || '—' })) : t('admin:veille.feed_never', 'pas encore lu'), last: f.lastChangeAt ? t('admin:veille.feed_last_change', ' ; dernière nouvelle version : {{date}}', { date: when(f.lastChangeAt) }) : '' })}</li>)}</ul></div>
            {(data.sources?.newest || []).length ? <div className="mt-4"><h3 className="font-semibold text-slate-900">{t('admin:veille.new_sources', 'Nouvelles sources')}</h3>
              <ul className="mt-1 space-y-1">{data.sources.newest.map((s) => <li key={s.name} className="text-sm text-slate-800">{s.name} — {s.attestation}{s.attestationUrl ? <> (<a className="text-blue-700 underline underline-offset-2" href={s.attestationUrl} target="_blank" rel="noopener noreferrer">{t('admin:veille.proof', 'preuve')}</a>)</> : null}</li>)}</ul></div> : null}
            {(data.sources?.paused || []).length ? <div className="mt-4"><h3 className="font-semibold text-slate-900">{t('admin:veille.paused_sources', 'Sources mises de côté')}</h3>
              <ul className="mt-1 space-y-1">{data.sources.paused.map((s) => <li key={s.name} className="text-sm text-slate-800">{s.name} — {s.status === 'PAUSED' ? t('admin:veille.source_redirects', 'redirige vers un site non attesté') : t('admin:veille.source_unreachable', 'injoignable depuis plusieurs visites')}{s.health?.reviewError ? ` (${s.health.reviewError})` : ''}</li>)}</ul></div> : null}
            {(data.sources?.rejected || []).length ? <div className="mt-4" data-testid="admin-veille-rejected"><h3 className="font-semibold text-slate-900">{t('admin:veille.rejected_sources', 'Écartées (et pourquoi)')}</h3>
              <ul className="mt-1 space-y-1">{data.sources.rejected.slice(0, 20).map((s, i) => <li key={`${s.host}-${i}`} className="text-sm text-slate-800">{s.host}{s.name ? ` (${s.name})` : ''} — {s.reason}</li>)}</ul></div> : null}
            <Link to="/admin/sources" className="mt-3 inline-block text-sm text-blue-700 underline underline-offset-2">{t('admin:veille.all_sources', 'Voir la liste complète des sources')}</Link>
          </Section>

          <Section title={t('admin:veille.audit_title', 'Contrôle de cohérence')} testid="admin-veille-audit" intro={t('admin:veille.audit_intro', 'À la fin de chaque veille, le système relit tout ce qui est public : décision enregistrée, preuve sur un site officiel, aucune adresse électronique personnelle, fraîcheur, doublons. Une fiche qui ne respecte pas ces règles est retirée d’elle-même.')}>
            {data.audit ? (
              <p className="text-slate-900"><Trans i18n={i18n} i18nKey="admin:veille.audit_line" defaults="<0>{{checked}}</0> fiches publiques relues le {{date}} : <1>{{violations}}</1> écart(s){{codes}}{{withdrawn}}." values={{ checked: data.audit.checked, date: when(data.audit.at), violations: data.audit.violations, codes: data.audit.violations ? ` (${Object.entries(data.audit.byCode || {}).map(([k, v]) => `${v} ${k}`).join(', ')})` : '', withdrawn: data.audit.withdrawn ? t('admin:veille.audit_withdrawn', ' ; {{n}} retirée(s)', { n: data.audit.withdrawn }) : '' }} components={[strong, strong]} /></p>
            ) : <p className="text-slate-700">{t('admin:veille.no_audit', 'Pas encore de contrôle.')}</p>}
          </Section>

          <Section title={t('admin:veille.machine_title', 'La machine')} testid="admin-veille-machine" intro={t('admin:veille.machine_intro', 'La veille ne démarre pas pendant une campagne de QA native ni sous 10 Gio d’espace libre ; le modèle local n’écrit que si la mémoire le permet et il est déchargé à la fin.')}>
            {(() => {
              const m = data.machine?.live || data.machine?.lastRun?.end || data.machine?.lastRun?.start || null;
              if (!m) return <p className="text-slate-700">{t('admin:veille.no_measure', 'Pas de mesure (la machine n’est surveillée que sur le serveur du LAB).')}</p>;
              return (
                <ul className="space-y-1 text-sm text-slate-800">
                  <li><Trans i18n={i18n} i18nKey="admin:veille.disk" defaults="Espace disque libre : <0>{{gb}} Gio</0>" values={{ gb: m.disk?.freeGb ?? '—' }} components={[strong]} /></li>
                  <li><Trans i18n={i18n} i18nKey="admin:veille.memory" defaults="Mémoire disponible : <0>{{pct}} %</0> ; mémoire d’échange utilisée : {{swap}}" values={{ pct: m.memory?.availablePct ?? '—', swap: m.memory?.swapUsedGb != null ? t('admin:veille.gib', '{{n}} Gio', { n: Math.round(m.memory.swapUsedGb * 10) / 10 }) : '—' }} components={[strong]} /></li>
                  <li>{t('admin:veille.cpu', 'Charge du processeur : {{load}} pour {{cores}} cœurs', { load: m.load?.one ?? '—', cores: m.load?.cores ?? '—' })}</li>
                  <li>{t('admin:veille.qa', 'Campagne de QA native en cours : {{state}}', { state: m.qa ? (m.qa.running ? t('admin:veille.qa_yes', 'oui (la veille attend)') : t('admin:veille.qa_no', 'non')) : '—' })}</li>
                  {data.machine?.model ? <li>{t('admin:veille.model', 'Modèle local à la dernière veille : {{used}}{{deferred}}', { used: data.machine.model.used ? (data.machine.model.unloaded ? t('admin:veille.model_used_unloaded', 'utilisé, puis déchargé') : t('admin:veille.model_used', 'utilisé')) : t('admin:veille.model_not_used', 'non utilisé'), deferred: data.machine.model.deferredBecause ? t('admin:veille.model_deferred', ' (textes reportés : {{why}})', { why: data.machine.model.deferredBecause }) : '' })}</li> : null}
                </ul>
              );
            })()}
          </Section>
        </>
      )}
    </div>
  );
}
