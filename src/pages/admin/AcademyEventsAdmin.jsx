// @ts-nocheck
/**
 * X04 (expansion) — the editorial side of the academy pages and events (api/_handlers/admin/events.js): draft → review → published, then cancel (event)
 * or withdraw (page). Changes need a named administrator with MFA; the server re-checks everything at approval and this page lists what is missing.
 * For an event the organizer sees COUNTS only (registered, places left, number per accessibility need) — never a person. Closed by default (503).
 */
import { useCallback, useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { formatDateTime, useT } from '@/i18n';
import { ACCESSIBILITY_FEATURES, accessibilityLabel } from '@/lib/academyEvents';

const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const EMPTY = { kind: 'EVENT', title: '', summary: '', body: '', organizerName: '', startsAt: '', endsAt: '', registrationClosesAt: '', venueName: '', venueAddress: '',
  venueCommune: '', capacity: '', accessibilityFeatures: [], accessibilityNote: '', translations: {} };
const field = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900';
/** an ISO date for a datetime-local input (the browser's clock) */
const local = (v) => { if (!v) return ''; const d = new Date(v); if (Number.isNaN(d.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const iso = (v) => (v ? new Date(v).toISOString() : null);

export default function AcademyEventsAdmin() {
  const { t } = useT('events');
  const [list, setList] = useState([]);
  const [closed, setClosed] = useState(false);
  const [current, setCurrent] = useState(null);   // { row?, draft }
  const [msg, setMsg] = useState('');
  const [problems, setProblems] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const statusLabel = (s) => ({ draft: t('events:admin.status.draft', 'Brouillon'), review: t('events:admin.status.review', 'À relire'), published: t('events:admin.status.published', 'Publié'),
    cancelled: t('events:status.cancelled', 'Annulé'), withdrawn: t('events:admin.status.withdrawn', 'Retiré') }[s] || s);
  const kindLabel = (k) => (k === 'EVENT' ? t('events:admin.kind.event', 'Événement') : t('events:admin.kind.lesson', 'Page de l’académie'));

  const load = useCallback(() => {
    apiClient.admin.listAcademy().then((r) => { setClosed(false); setList(r?.items || []); })
      .catch((e) => { if (e?.status === 503) setClosed(true); else setMsg(e?.message || t('events:admin.failed', 'Action refusée.')); });
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    setMsg(''); setNote('');
    const r = await apiClient.admin.getAcademy(id);
    setCurrent({ row: r, draft: { ...EMPTY, ...r, startsAt: local(r.startsAt), endsAt: local(r.endsAt), registrationClosesAt: local(r.registrationClosesAt), capacity: r.capacity ?? '',
      organizerName: r.organizerName || '', venueName: r.venueName || '', venueAddress: r.venueAddress || '', venueCommune: r.venueCommune || '', accessibilityNote: r.accessibilityNote || '',
      translations: r.translations || {} } });
    setProblems(r.problems || []);
  };
  const act = async (body, done) => {
    setBusy(true); setMsg(''); setProblems([]);
    try { const r = await apiClient.admin.academyAction(body); if (r?.problems) setProblems(r.problems); setMsg(done); if (r?.id) await open(r.id); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('events:admin.failed', 'Action refusée.')); setProblems(e?.payload?.problems || []); }
    finally { setBusy(false); }
  };
  const d = current?.draft; const row = current?.row;
  const set = (k, v) => setCurrent((c) => ({ ...c, draft: { ...c.draft, [k]: v } }));
  const setTr = (lang, k, v) => setCurrent((c) => ({ ...c, draft: { ...c.draft, translations: { ...c.draft.translations, [lang]: { ...(c.draft.translations[lang] || {}), [k]: v } } } }));
  const editable = !row || ['draft', 'review'].includes(row.status);
  const payload = () => ({ ...d, startsAt: iso(d.startsAt), endsAt: iso(d.endsAt), registrationClosesAt: iso(d.registrationClosesAt), capacity: d.capacity === '' ? null : Number(d.capacity) });
  const title = t('events:admin.title', 'Académie et événements');

  if (closed) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <SEO title={title} path="/admin/academie-evenements" noindex />
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p role="status" data-testid="academy-closed" className="max-w-3xl rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('events:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/admin/academie-evenements" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('events:admin.intro', 'Brouillon, relecture, puis publication par un administrateur. Un événement publié peut être annulé, une page retirée. Pour un événement, vous voyez des nombres, jamais les personnes inscrites.')}</p>
      </div>
      <Button variant="outline" onClick={() => { setCurrent({ draft: { ...EMPTY } }); setProblems([]); setMsg(''); }}>{t('events:admin.new', 'Nouveau')}</Button>
      <section aria-labelledby="academy-admin-list">
        <h2 id="academy-admin-list" className="text-lg font-semibold text-slate-900">{t('events:admin.list', 'Contenus')}</h2>
        <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white" data-testid="academy-admin-list">
          {list.length === 0 && <li className="p-3 text-sm text-slate-700">{t('events:admin.none', 'Aucun contenu pour le moment.')}</li>}
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 p-3 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" onClick={() => open(r.id)}>
                <span className="font-medium text-slate-900">{r.title}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">{kindLabel(r.kind)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">{statusLabel(r.status)}</span>
                {r.attendance && <span className="text-xs text-slate-700">{t('events:admin.counts', '{{registered}} inscrits sur {{capacity}}', { registered: r.attendance.registered, capacity: r.attendance.capacity ?? '—' })}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {d && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="academy-editor">
          <h2 id="academy-editor" className="text-lg font-semibold text-slate-900">{row ? `${kindLabel(row.kind)} — ${statusLabel(row.status)}` : t('events:admin.new', 'Nouveau')}</h2>
          <div aria-live="polite" role="status">{msg && <p className="text-sm font-medium text-slate-900">{msg}</p>}</div>
          {problems.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">{t('events:admin.missing', 'Avant publication, il manque :')}</p>
              <ul className="list-disc ps-5">{problems.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
            </div>
          )}
          {row?.attendance && (
            <div data-testid="academy-attendance" className="rounded-md border border-slate-200 p-3 text-sm text-slate-800">
              <p className="font-semibold">{t('events:admin.counts', '{{registered}} inscrits sur {{capacity}}', { registered: row.attendance.registered, capacity: row.attendance.capacity ?? '—' })}</p>
              {Object.keys(row.attendance.needs || {}).length > 0 && (
                <ul className="mt-1 list-disc ps-5">{Object.entries(row.attendance.needs).map(([k, n]) => <li key={k}>{accessibilityLabel(k, t)} : {n}</li>)}</ul>
              )}
            </div>
          )}
          {!row && (
            <label className="block text-sm font-semibold text-slate-900">{t('events:admin.f.kind', 'Type')}
              <select className={field} value={d.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="EVENT">{kindLabel('EVENT')}</option><option value="LESSON">{kindLabel('LESSON')}</option>
              </select></label>
          )}
          <label className="block text-sm font-semibold text-slate-900">{t('events:admin.f.title', 'Titre')}<input className={field} value={d.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} maxLength={200} /></label>
          <label className="block text-sm font-semibold text-slate-900">{t('events:admin.f.summary', 'Résumé')}<textarea className={field} rows={2} value={d.summary} disabled={!editable} onChange={(e) => set('summary', e.target.value)} maxLength={400} /></label>
          <label className="block text-sm font-semibold text-slate-900">{t('events:admin.f.body', 'Texte (texte simple, sans HTML)')}<textarea className={field} rows={8} value={d.body} disabled={!editable} onChange={(e) => set('body', e.target.value)} maxLength={20000} /></label>
          {(row?.kind || d.kind) === 'EVENT' && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-900">{t('events:detail.practical', 'Informations pratiques')}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm text-slate-900">{t('events:admin.f.starts', 'Début')}<input type="datetime-local" className={field} value={d.startsAt} disabled={!editable} onChange={(e) => set('startsAt', e.target.value)} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.ends', 'Fin')}<input type="datetime-local" className={field} value={d.endsAt} disabled={!editable} onChange={(e) => set('endsAt', e.target.value)} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.closes', 'Fin des inscriptions (facultatif)')}<input type="datetime-local" className={field} value={d.registrationClosesAt} disabled={!editable} onChange={(e) => set('registrationClosesAt', e.target.value)} /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-slate-900">{t('events:admin.f.venue', 'Lieu')}<input className={field} value={d.venueName} disabled={!editable} onChange={(e) => set('venueName', e.target.value)} maxLength={160} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.address', 'Adresse')}<input className={field} value={d.venueAddress} disabled={!editable} onChange={(e) => set('venueAddress', e.target.value)} maxLength={300} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.commune', 'Commune')}<input className={field} value={d.venueCommune} disabled={!editable} onChange={(e) => set('venueCommune', e.target.value)} maxLength={120} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.organizer', 'Organisateur (nom de la structure)')}<input className={field} value={d.organizerName} disabled={!editable} onChange={(e) => set('organizerName', e.target.value)} maxLength={160} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.capacity', 'Nombre de places')}<input type="number" min={1} max={5000} inputMode="numeric" className={field} value={d.capacity} disabled={!editable} onChange={(e) => set('capacity', e.target.value)} /></label>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-900">{t('events:a11y.title', 'Accessibilité')}</legend>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {ACCESSIBILITY_FEATURES.map((f) => (
                    <label key={f} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!editable} checked={d.accessibilityFeatures.includes(f)}
                      onChange={(e) => set('accessibilityFeatures', e.target.checked ? [...d.accessibilityFeatures, f] : d.accessibilityFeatures.filter((x) => x !== f))} />{accessibilityLabel(f, t)}</label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm text-slate-900">{t('events:admin.f.a11y_note', 'Précision sur l’accessibilité (obligatoire si rien n’est coché, par exemple « lieu non accessible en fauteuil »)')}<textarea className={field} rows={2} value={d.accessibilityNote} disabled={!editable} onChange={(e) => set('accessibilityNote', e.target.value)} maxLength={1000} /></label>
            </fieldset>
          )}
          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">{t('events:admin.translations', 'Traductions relues (facultatives)')}</summary>
            {LANGS.map((lang) => (
              <fieldset key={lang} className="mt-3 space-y-2" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <legend className="text-sm font-semibold uppercase text-slate-900">{lang}</legend>
                <label className="block text-sm text-slate-900">{t('events:admin.f.title', 'Titre')}<input className={field} value={d.translations?.[lang]?.title || ''} disabled={!editable} onChange={(e) => setTr(lang, 'title', e.target.value)} maxLength={200} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.summary', 'Résumé')}<textarea className={field} rows={2} value={d.translations?.[lang]?.summary || ''} disabled={!editable} onChange={(e) => setTr(lang, 'summary', e.target.value)} maxLength={400} /></label>
                <label className="block text-sm text-slate-900">{t('events:admin.f.body', 'Texte (texte simple, sans HTML)')}<textarea className={field} rows={4} value={d.translations?.[lang]?.body || ''} disabled={!editable} onChange={(e) => setTr(lang, 'body', e.target.value)} maxLength={20000} /></label>
              </fieldset>
            ))}
          </details>
          {row && ['review', 'published'].includes(row.status) && (
            <label className="block text-sm font-semibold text-slate-900">{t('events:admin.f.note', 'Note (motif du renvoi, de l’annulation ou du retrait)')}<textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {editable && <Button disabled={busy} onClick={() => act(row ? { action: 'save', id: row.id, draft: payload() } : { action: 'save', draft: payload() }, t('events:admin.saved', 'Brouillon enregistré.'))}>{t('events:admin.a.save', 'Enregistrer le brouillon')}</Button>}
            {row?.status === 'draft' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'submit', id: row.id }, t('events:admin.submitted', 'Envoyé en relecture.'))}>{t('events:admin.a.submit', 'Envoyer en relecture')}</Button>}
            {row?.status === 'review' && <Button disabled={busy} onClick={() => act({ action: 'approve', id: row.id }, t('events:admin.approved', 'Publié.'))}>{t('events:admin.a.approve', 'Approuver et publier')}</Button>}
            {row?.status === 'review' && <Button variant="outline" disabled={busy} onClick={() => act({ action: 'reject', id: row.id, note }, t('events:admin.rejected', 'Renvoyé en rédaction.'))}>{t('events:admin.a.reject', 'Renvoyer en rédaction')}</Button>}
            {row?.status === 'published' && row.kind === 'EVENT' && <Button variant="destructive" disabled={busy} onClick={() => act({ action: 'cancel', id: row.id, note }, t('events:admin.cancelled', 'Événement annulé ; les personnes inscrites sont prévenues dans leurs notifications.'))}>{t('events:admin.a.cancel', 'Annuler l’événement')}</Button>}
            {row?.status === 'published' && row.kind === 'LESSON' && <Button variant="destructive" disabled={busy} onClick={() => act({ action: 'withdraw', id: row.id, note }, t('events:admin.withdrawn', 'Page retirée.'))}>{t('events:admin.a.withdraw', 'Retirer la page')}</Button>}
          </div>
          {row?.publishedAt && <p className="text-xs text-slate-700">{t('events:admin.published_on', 'Publié le {{date}}', { date: formatDateTime(row.publishedAt) })}</p>}
        </section>
      )}
    </div>
  );
}
