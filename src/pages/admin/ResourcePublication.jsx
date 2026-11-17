// @ts-nocheck
/**
 * C12 — the documents of /ressources (api/_handlers/admin/resources.js). Create or edit a draft, confirm it against its official source (« vérifié le »,
 * the server's date at that action, bound to the version read), publish it explicitly, withdraw it. Changes need a named administrator with MFA; the
 * rules are checked by the server and this page lists what is missing. Rows created before migration 0050 are marked as such: they are not public and
 * keep no invented source or date — completing and verifying them is a human task. Without 0050 the tool says it is not available.
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { formatDate, useT } from '@/i18n';

const TYPES = ['guide', 'tool', 'document', 'link'];
const EMPTY = { title: '', type: 'guide', content: '', source_url: '', source_publisher: '', territory_scope: '' };
const field = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900';

export default function ResourcePublication() {
  const { t } = useT('admin');
  const [available, setAvailable] = useState(null);
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null);   // { id?, row?, draft }
  const [msg, setMsg] = useState('');
  const [problems, setProblems] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const typeLabel = (x) => ({ guide: t('admin:resources.type.guide', 'Guide'), tool: t('admin:resources.type.tool', 'Outil'), document: t('admin:resources.type.document', 'Document'), link: t('admin:resources.type.link', 'Lien utile') }[x] || x);
  const statusLabel = (s) => ({ draft: t('admin:resources.status.draft', 'Brouillon'), published: t('admin:resources.status.published', 'Publié'), withdrawn: t('admin:resources.status.withdrawn', 'Retiré') }[s] || s);
  const problemLabel = (p) => ({
    TITLE_TOO_SHORT: t('admin:resources.p.title', 'Un titre d’au moins 5 caractères.'),
    TYPE_REQUIRED: t('admin:resources.p.type', 'Un type de document.'),
    DESCRIPTION_TOO_SHORT: t('admin:resources.p.description', 'Une description d’au moins 20 caractères.'),
    SOURCE_URL_REQUIRED: t('admin:resources.p.source_url', 'L’adresse de la source officielle.'),
    UNSAFE_SOURCE_URL_NOT_HTTPS: t('admin:resources.p.https', 'L’adresse de la source doit commencer par https://.'),
    SOURCE_DOMAIN_NOT_OFFICIAL: t('admin:resources.p.domain', 'Le site de la source n’est pas dans la liste des sources officielles.'),
    SOURCE_PUBLISHER_REQUIRED: t('admin:resources.p.publisher', 'Le nom de l’éditeur de la source.'),
    NOT_VERIFIED: t('admin:resources.p.not_verified', 'Une vérification « vérifié le » par un administrateur.'),
    CHANGED_SINCE_VERIFICATION: t('admin:resources.p.changed', 'Le contenu a changé depuis la vérification : vérifiez-le à nouveau.'),
    NO_VERIFICATION_DATE: t('admin:resources.p.no_date', 'Une date de vérification.'),
    VERIFICATION_STALE: t('admin:resources.p.stale', 'La vérification date de plus de 180 jours : vérifiez à nouveau la source.'),
  }[p] || (p.startsWith('UNSAFE_MARKUP') ? t('admin:resources.p.markup', 'Texte simple uniquement : pas de balises HTML ni d’entités.') : p));
  const day = (d) => (d ? formatDate(d, { year: 'numeric', month: 'long', day: 'numeric' }) : '');

  const load = useCallback(() => {
    apiClient.admin.listResources().then((r) => { setAvailable(r?.available === true); setList(r?.items || []); })
      .catch((e) => setMsg(e?.message || t('admin:resources.load_failed', 'Chargement impossible.')));
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    setProblems([]); setMsg(''); setNote('');
    const r = await apiClient.admin.getResource(id);
    setCurrent({ id: r.id, row: r, draft: { title: r.title || '', type: TYPES.includes(r.type) ? r.type : 'guide', content: r.content || '', source_url: r.source_url || '',
      source_publisher: r.source_publisher || '', territory_scope: r.territory_scope || '' } });
    setProblems(r.problems || []);
  };
  const act = async (body, done) => {
    setBusy(true); setMsg(''); setProblems([]);
    try { const r = await apiClient.admin.resourceAction(body); if (r?.problems) setProblems(r.problems); setMsg(done); if (r?.id) await open(r.id); load(); }
    catch (e) { setMsg(e?.message || t('admin:resources.failed', 'Action refusée.')); setProblems(e?.payload?.problems || []); }
    finally { setBusy(false); }
  };
  const d = current?.draft;
  const row = current?.row;
  const set = (k, v) => setCurrent((c) => ({ ...c, draft: { ...c.draft, [k]: v } }));
  const editable = !row || row.status !== 'published' || !row.verified_at;

  if (available === false) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <SEO title={t('admin:resources.title', 'Documents de la page Ressources')} path="/admin/ressources-publication" noindex />
        <h1 className="text-2xl font-bold text-slate-900">{t('admin:resources.title', 'Documents de la page Ressources')}</h1>
        <p role="status" data-testid="resources-unavailable" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          {t('admin:resources.unavailable', 'La publication des documents n’est pas disponible sur cette base de données (migration 0050 non appliquée). La page publique ne montre aucun document.')}
        </p>
        <p className="text-sm text-slate-700">{t('admin:resources.existing', 'Lignes existantes (non publiques) : {{n}}', { n: list.length })}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={t('admin:resources.title', 'Documents de la page Ressources')} path="/admin/ressources-publication" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('admin:resources.title', 'Documents de la page Ressources')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('admin:resources.intro', 'Chaque document a une source officielle et son éditeur. Un administrateur vérifie le contenu contre la source (« vérifié le »), puis le publie. Rien n’est publié automatiquement ; une vérification de plus de 180 jours retire le document de la page publique.')}</p>
      </div>
      <Button variant="outline" onClick={() => { setCurrent({ draft: { ...EMPTY } }); setProblems([]); setMsg(''); setNote(''); }}>{t('admin:resources.new', 'Nouveau document')}</Button>
      <section aria-labelledby="resources-list-title">
        <h2 id="resources-list-title" className="text-lg font-semibold text-slate-900">{t('admin:resources.list', 'Documents')}</h2>
        <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white" data-testid="resources-admin-list">
          {list.length === 0 && <li className="p-3 text-sm text-slate-700">{t('admin:resources.none', 'Aucun document pour le moment.')}</li>}
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 p-3 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" onClick={() => open(r.id)}>
                <span className="font-medium text-slate-900">{r.title}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">{statusLabel(r.status)}</span>
                {r.legacy && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">{t('admin:resources.legacy', 'Ancienne ligne : source et vérification à compléter')}</span>}
                {r.publicDecision?.visible && <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-950">{t('admin:resources.public', 'Visible sur la page publique')}</span>}
                {r.publicDecision?.freshness === 'update_needed' && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">{t('admin:resources.update_needed', 'Vérification à renouveler bientôt')}</span>}
                {r.status === 'published' && r.publicDecision?.reasons?.includes('VERIFICATION_STALE') && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-950">{t('admin:resources.stale', 'Vérification expirée : masqué au public')}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {d && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="resource-editor-title">
          <h2 id="resource-editor-title" className="text-lg font-semibold text-slate-900">{row ? t('admin:resources.edit', 'Document') : t('admin:resources.new', 'Nouveau document')}</h2>
          {msg && <p role="status" className="text-sm font-medium text-slate-900">{msg}</p>}
          {problems.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">{t('admin:resources.missing', 'Avant publication, il manque :')}</p>
              <ul className="list-disc ps-5">{problems.map((p) => <li key={p}>{problemLabel(p)}</li>)}</ul>
            </div>
          )}
          {row && (
            <dl className="grid gap-1 text-sm text-slate-800 sm:grid-cols-2">
              <div><dt className="inline font-semibold">{t('admin:resources.f.status', 'État :')}</dt> <dd className="inline">{statusLabel(row.status)}</dd></div>
              <div><dt className="inline font-semibold">{t('admin:resources.f.verified', 'Vérifié le :')}</dt> <dd className="inline">{row.verified_at ? `${day(row.verified_at)} — ${row.reviewer_id}` : t('admin:resources.never', 'jamais')}</dd></div>
            </dl>
          )}
          <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.title', 'Titre')}<input className={field} value={d.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} maxLength={200} /></label>
          <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.type', 'Type')}
            <select className={field} value={d.type} disabled={!editable} onChange={(e) => set('type', e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}</select></label>
          <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.content', 'Description (texte simple, sans HTML)')}<textarea className={field} rows={6} value={d.content} disabled={!editable} onChange={(e) => set('content', e.target.value)} maxLength={5000} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.source_url', 'Adresse de la source officielle (https)')}<input className={field} type="url" inputMode="url" dir="ltr" value={d.source_url} disabled={!editable} onChange={(e) => set('source_url', e.target.value)} maxLength={500} /></label>
            <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.publisher', 'Éditeur de la source')}<input className={field} value={d.source_publisher} disabled={!editable} onChange={(e) => set('source_publisher', e.target.value)} maxLength={160} /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.territory', 'Territoire (facultatif)')}<input className={field} value={d.territory_scope} disabled={!editable} onChange={(e) => set('territory_scope', e.target.value)} maxLength={80} /></label>
          {row && ['draft', 'published'].includes(row.status) && !(row.status === 'published' && !row.verified_at) && (
            <label className="block text-sm font-semibold text-slate-900">{t('admin:resources.f.note', 'Note (ce que vous avez vérifié sur la source, ou motif du retrait)')}
              <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {editable && <Button disabled={busy} onClick={() => act(row ? { action: 'edit', id: row.id, draft: d } : { action: 'create', draft: d }, t('admin:resources.saved', 'Brouillon enregistré.'))}>{t('admin:resources.a.save', 'Enregistrer le brouillon')}</Button>}
            {row && (row.status === 'draft' || (row.status === 'published' && row.verified_at)) && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'verify', id: row.id, expectedVersion: row.version, note }, t('admin:resources.verified', 'Vérification enregistrée.'))}>{t('admin:resources.a.verify', 'J’ai vérifié ce contenu sur la source')}</Button>}
            {row?.status === 'draft' && <Button disabled={busy} onClick={() => act({ action: 'publish', id: row.id }, t('admin:resources.published', 'Document publié.'))}>{t('admin:resources.a.publish', 'Publier')}</Button>}
            {row?.status === 'published' && <Button variant="destructive" disabled={busy} onClick={() => act({ action: 'withdraw', id: row.id, reason: note }, t('admin:resources.withdrawn', 'Document retiré de la page publique.'))}>{t('admin:resources.a.withdraw', 'Retirer')}</Button>}
          </div>
          {row?.events?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t('admin:resources.history', 'Historique (non modifiable)')}</h3>
              <ol className="mt-1 space-y-1 text-xs text-slate-800">
                {row.events.map((e) => <li key={e.id}><span dir="ltr">{day(e.createdAt)}</span> — {e.action} — {e.actorId}{e.note ? ` — ${e.note}` : ''}</li>)}
              </ol>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
