// @ts-nocheck
/**
 * Actualités v2 — the editorial desk for ADA's own articles and explainers (api/_handlers/admin/news-editorial.js). Draft, send to review, approve or
 * send back, then correct (dated, shown to readers) or retract (the address keeps a retraction notice). Changes need a named administrator with MFA.
 * The rules an approval must meet are checked by the server; this page shows what is missing.
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { TOPIC_CHIPS, topicLabel } from '@/components/news/newsLabels';

const STATUSES = ['brouillon', 'a_relire', 'publie', 'retire'];
const CHECKS = ['factsSourced', 'noCopiedText', 'proportionateViewpoints', 'uncertaintyLabelled'];
const EMPTY = { titre: '', resume: '', contenu: '', topic: 'societe', geo: 'france', sources: [{ publisher: '', url: '', note: '' }], checklist: {}, aiAssisted: false, est_important: false, image: null };

export default function NewsEditorial() {
  const { t } = useT('admin');
  const [status, setStatus] = useState('brouillon');
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null);   // { id?, statut?, draft }
  const [msg, setMsg] = useState('');
  const [problems, setProblems] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const statusLabel = (s) => ({ brouillon: t('admin:news.status.draft', 'Brouillons'), a_relire: t('admin:news.status.review', 'À relire'), publie: t('admin:news.status.published', 'Publiés'), retire: t('admin:news.status.retracted', 'Retirés') }[s] || s);
  const checkLabel = (k) => ({
    factsSourced: t('admin:news.check.facts', 'Chaque fait est relié à une source citée'),
    noCopiedText: t('admin:news.check.copy', 'Aucune phrase reprise ou paraphrasée d’un article protégé'),
    proportionateViewpoints: t('admin:news.check.views', 'Points de vue présentés à proportion des preuves'),
    uncertaintyLabelled: t('admin:news.check.uncertainty', 'Estimations, annonces et faits contestés signalés comme tels'),
  }[k]);

  const load = useCallback(() => { apiClient.admin.listNewsArticles(status).then((r) => setList(r?.items || [])).catch((e) => setMsg(e?.message || t('admin:news.load_failed', 'Chargement impossible.'))); }, [status, t]);
  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    setProblems([]); setMsg(''); setNote('');
    const r = await apiClient.admin.getNewsArticle(id);
    const ada = r?.raw_payload_json?.ada || {};
    setCurrent({ id: r.id, statut: r.statut, draft: { ...EMPTY, titre: r.titre || '', resume: r.resume || '', contenu: r.contenu || '', topic: ada.topic || 'societe', geo: ada.geo || 'france',
      sources: ada.sources?.length ? ada.sources : EMPTY.sources, checklist: ada.checklist || {}, aiAssisted: ada.aiAssisted === true, est_important: r.est_important === true, image: ada.image || null } });
  };
  const act = async (body, done) => {
    setBusy(true); setMsg(''); setProblems([]);
    try { const r = await apiClient.admin.newsEditorial(body); if (r?.problems) setProblems(r.problems); setMsg(done); if (r?.id) await open(r.id); load(); }
    catch (e) { setMsg(e?.message || 'Erreur'); setProblems(e?.data?.problems || e?.body?.problems || []); }
    finally { setBusy(false); }
  };
  const d = current?.draft;
  const set = (k, v) => setCurrent((c) => ({ ...c, draft: { ...c.draft, [k]: v } }));
  const setSource = (i, k, v) => set('sources', d.sources.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const field = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
  const editable = !current?.statut || ['brouillon', 'a_relire'].includes(current.statut);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={t('admin:news.title', 'Rédaction des actualités')} path="/admin/actualites-redaction" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('admin:news.title', 'Rédaction des actualités')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('admin:news.intro', 'Articles et explications écrits par AccesDirectAide. Rien n’est publié sans votre approbation ; une correction est datée et visible ; un article retiré laisse une note de retrait.')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => <Button key={s} variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>{statusLabel(s)}</Button>)}
        <Button variant="outline" onClick={() => { setCurrent({ draft: { ...EMPTY } }); setProblems([]); setMsg(''); }}>{t('admin:news.new', 'Nouvel article')}</Button>
      </div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white" data-testid="news-editorial-list">
        {list.length === 0 && <li className="p-3 text-sm text-slate-600">{t('admin:news.none', 'Aucun article dans cet état.')}</li>}
        {list.map((a) => <li key={a.id}><button type="button" className="w-full p-3 text-start text-sm hover:bg-slate-50" onClick={() => open(a.id)}>{a.titre}</button></li>)}
      </ul>

      {d && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label={t('admin:news.editor', 'Éditeur')}>
          {msg && <p role="status" className="text-sm font-medium text-slate-800">{msg}</p>}
          {problems.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{t('admin:news.missing', 'Avant approbation, il manque :')}</p>
              <ul className="list-disc ps-5">{problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
            </div>
          )}
          <label className="block text-sm font-semibold">{t('admin:news.f.title', 'Titre')}<input className={field} value={d.titre} disabled={!editable} onChange={(e) => set('titre', e.target.value)} maxLength={200} /></label>
          <label className="block text-sm font-semibold">{t('admin:news.f.lead', 'Chapô (résumé factuel)')}<textarea className={field} rows={2} value={d.resume} disabled={!editable} onChange={(e) => set('resume', e.target.value)} maxLength={400} /></label>
          <label className="block text-sm font-semibold">{t('admin:news.f.text', 'Texte (texte simple, paragraphes séparés par une ligne vide)')}<textarea className={field} rows={12} value={d.contenu} disabled={!editable} onChange={(e) => set('contenu', e.target.value)} maxLength={20000} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">{t('admin:news.f.topic', 'Rubrique')}<select className={field} value={d.topic} disabled={!editable} onChange={(e) => set('topic', e.target.value)}>{TOPIC_CHIPS.filter((x) => x !== 'une').map((x) => <option key={x} value={x}>{topicLabel(x, (k, def) => def)}</option>)}</select></label>
            <label className="block text-sm font-semibold">{t('admin:news.f.geo', 'Lieu de l’événement')}<select className={field} value={d.geo} disabled={!editable} onChange={(e) => set('geo', e.target.value)}><option value="france">{t('admin:news.geo.france', 'France')}</option><option value="monde">{t('admin:news.geo.monde', 'Monde')}</option><option value="alsace">{t('admin:news.geo.alsace', 'Alsace / Strasbourg')}</option></select></label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('admin:news.f.sources', 'Sources (https ; deux sites différents pour la politique, la justice, la santé et l’international)')}</legend>
            {d.sources.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-3">
                <input className={field} placeholder={t('admin:news.f.publisher', 'Éditeur')} value={s.publisher} disabled={!editable} onChange={(e) => setSource(i, 'publisher', e.target.value)} />
                <input className={field} placeholder={t('admin:news.f.url', 'Adresse https://…')} value={s.url} disabled={!editable} onChange={(e) => setSource(i, 'url', e.target.value)} />
                <input className={field} placeholder={t('admin:news.f.claim', 'Ce que cette source établit')} value={s.note || ''} disabled={!editable} onChange={(e) => setSource(i, 'note', e.target.value)} />
              </div>
            ))}
            {editable && <Button type="button" variant="outline" onClick={() => set('sources', [...d.sources, { publisher: '', url: '', note: '' }])}>{t('admin:news.f.add_source', 'Ajouter une source')}</Button>}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">{t('admin:news.f.checklist', 'Contrôle éditorial (obligatoire)')}</legend>
            {CHECKS.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.checklist?.[k] === true} disabled={!editable} onChange={(e) => set('checklist', { ...d.checklist, [k]: e.target.checked })} />{checkLabel(k)}</label>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.aiAssisted} disabled={!editable} onChange={(e) => set('aiAssisted', e.target.checked)} />{t('admin:news.f.ai', 'Rédaction assistée par IA (relue et vérifiée)')}</label>
          </fieldset>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {editable && <Button disabled={busy} onClick={() => act({ action: 'save', id: current.id, draft: d }, t('admin:news.saved', 'Brouillon enregistré.'))}>{t('admin:news.a.save', 'Enregistrer le brouillon')}</Button>}
            {current.statut === 'brouillon' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'submit', id: current.id }, t('admin:news.submitted', 'Envoyé en relecture.'))}>{t('admin:news.a.submit', 'Envoyer en relecture')}</Button>}
            {current.statut === 'a_relire' && <Button disabled={busy} onClick={() => act({ action: 'approve', id: current.id }, t('admin:news.approved', 'Article approuvé et publié.'))}>{t('admin:news.a.approve', 'Approuver et publier')}</Button>}
            {current.statut === 'a_relire' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'reject', id: current.id, note }, t('admin:news.rejected', 'Renvoyé en rédaction.'))}>{t('admin:news.a.reject', 'Renvoyer en rédaction')}</Button>}
            {current.statut === 'publie' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'correct', id: current.id, note, kind: 'correction' }, t('admin:news.corrected', 'Correction publiée.'))}>{t('admin:news.a.correct', 'Publier une correction')}</Button>}
            {current.statut === 'publie' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'correct', id: current.id, note, kind: 'update' }, t('admin:news.updated', 'Mise à jour publiée.'))}>{t('admin:news.a.update', 'Publier une mise à jour')}</Button>}
            {current.statut === 'publie' && <Button variant="destructive" disabled={busy} onClick={() => act({ action: 'retract', id: current.id, note }, t('admin:news.retracted', 'Article retiré (note de retrait publiée).'))}>{t('admin:news.a.retract', 'Retirer l’article')}</Button>}
          </div>
          {current?.statut && current.statut !== 'brouillon' && (
            <label className="block text-sm font-semibold">{t('admin:news.f.note', 'Note (motif du renvoi, de la correction ou du retrait — visible des lecteurs pour une correction ou un retrait)')}
              <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          )}
        </section>
      )}
    </div>
  );
}
