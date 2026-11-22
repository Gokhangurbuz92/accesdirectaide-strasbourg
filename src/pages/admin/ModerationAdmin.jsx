// @ts-nocheck
/**
 * G14 — « Modération et signalements » (/admin/moderation): who is named (staffing of each function), the assignment of the named roles to EXISTING
 * administrator accounts with MFA (moderator, Entraide safety officer), and — for a named moderator — the account-free notices (DSA art. 16), the appeals
 * (art. 20), the misuse measures (art. 23) and the transparency counts. Functions without their named person stay closed on the server (fail closed);
 * this page only shows it and lets the owner assign the persons. Every read and every decision is audited.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { formatDateTime, useT } from '@/i18n';
import { ROLES, SUSPENSION_MAX_DAYS, categoryLabel, contentTypeLabel, roleLabel, staffingReason } from '@/lib/moderation';

const FEATURES = ['testimonials', 'stories', 'employment', 'notices', 'entraide', 'events'];
const input = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm';

function Staffing({ data, onChanged }) {
  const { t } = useT('moderation');
  const id = useId();
  const [v, setV] = useState({ email: '', role: 'MODERATOR', charterAcknowledged: false });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const featureLabel = (f) => ({ testimonials: t('moderation:feature.testimonials', 'Témoignages (X02)'), stories: t('moderation:feature.stories', 'Histoires (X01)'),
    employment: t('moderation:feature.employment', 'Offres d’emploi (X05)'), notices: t('moderation:feature.notices', 'Formulaire de signalement'),
    entraide: t('moderation:feature.entraide', 'Entraide (X03)'), events: t('moderation:feature.events', 'Académie et événements (X04)') }[f]);
  const act = async (body) => {
    setBusy(true); setMsg('');
    try { await apiClient.admin.moderationAction(body); setMsg(t('moderation:admin.done', 'Enregistré.')); onChanged(); }
    catch (e) { setMsg(e?.payload?.error || e?.message || t('moderation:failed', 'Envoi refusé.')); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:admin.staffing', 'Personnes nommées et fonctions')}</h2>
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{t('moderation:admin.staffing', 'Personnes nommées et fonctions')}</caption>
        <thead><tr><th scope="col" className="text-start">{t('moderation:admin.function', 'Fonction')}</th><th scope="col" className="text-start">{t('moderation:admin.state', 'État')}</th></tr></thead>
        <tbody>
          {FEATURES.map((f) => {
            const s = data?.features?.[f];
            return (
              <tr key={f} className="border-t border-slate-200" data-testid={`staffing-${f}`}>
                <th scope="row" className="py-1 text-start font-normal">{featureLabel(f)}</th>
                <td className="py-1">{s?.staffed ? t('moderation:admin.staffed', 'Personne nommée : peut ouvrir') : `${t('moderation:admin.closed', 'Fermé')} — ${staffingReason(s?.reason, t)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="list-disc ps-5 text-sm text-slate-900">
        {(data?.staff || []).map((s) => (
          <li key={`${s.email}-${s.role}`}>
            {s.name} ({s.email}) — {roleLabel(s.role, t)}
            <Button size="sm" variant="outline" className="ms-2" disabled={busy} onClick={() => act({ action: 'role_revoke', email: s.email, role: s.role })}>{t('moderation:admin.revoke', 'Retirer le rôle')}</Button>
          </li>
        ))}
      </ul>
      <form className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" noValidate onSubmit={(e) => { e.preventDefault(); act({ action: 'role_assign', ...v }); }}>
        <h3 className="font-semibold text-slate-900">{t('moderation:admin.assign', 'Nommer une personne')}</h3>
        <p className="text-sm text-slate-700">{t('moderation:admin.assign_help', 'Le rôle va à un compte administrateur existant, actif, avec double authentification et portant le nom de son titulaire.')}</p>
        <label htmlFor={`${id}-email`} className="block text-sm font-semibold text-slate-900">{t('moderation:admin.email', 'Adresse du compte administrateur')}</label>
        <input id={`${id}-email`} type="email" dir="ltr" className={input} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <label htmlFor={`${id}-role`} className="block text-sm font-semibold text-slate-900">{t('moderation:admin.role', 'Rôle')}</label>
        <select id={`${id}-role`} className={input} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r, t)}</option>)}
        </select>
        <label className="flex items-start gap-2 text-sm text-slate-900">
          <input type="checkbox" className="mt-1" checked={v.charterAcknowledged} onChange={(e) => setV({ ...v, charterAcknowledged: e.target.checked })} />
          <span>{t('moderation:admin.charter', 'La personne a lu la charte de modération et s’engage à la confidentialité.')}</span>
        </label>
        <Button type="submit" disabled={busy || !v.email || !v.charterAcknowledged}>{t('moderation:admin.assign_submit', 'Attribuer le rôle')}</Button>
      </form>
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
    </section>
  );
}

function Notices() {
  const { t } = useT('moderation');
  const id = useId();
  const [items, setItems] = useState(null);
  const [facts, setFacts] = useState({});
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { apiClient.admin.moderation('notices').then((r) => setItems(r?.items || [])).catch((e) => { setItems([]); setMsg(e?.payload?.error || e?.message); }); }, []);
  useEffect(() => { load(); }, [load]);
  const close = async (n, outcome) => {
    setMsg('');
    try { await apiClient.admin.moderationAction({ action: 'notice_close', id: n.id, outcome, facts: facts[n.id] || '' }); setMsg(t('moderation:admin.done', 'Enregistré.')); load(); }
    catch (e) { setMsg(e?.payload?.error || e?.message); }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:admin.notices', 'Signalements reçus sans compte')}</h2>
      <p className="text-sm text-slate-700">{t('moderation:admin.notices_help', 'Les signalements urgents (sécurité, enfant) apparaissent en premier. Pour retirer le contenu, utilisez la file de la fonction concernée en indiquant la référence du signalement : la décision et l’avis au signalant suivent.')}</p>
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
      {items === null ? <p role="status">{t('moderation:loading', 'Chargement…')}</p> : items.length === 0 ? <p className="text-sm text-slate-700">{t('moderation:admin.none', 'Rien à traiter.')}</p> : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm" data-testid="admin-notice">
              <p className="font-semibold">{n.priority === 'urgent' ? `⚠ ${t('moderation:admin.urgent', 'Urgent')} — ` : ''}{categoryLabel(n.category, t)} — {contentTypeLabel(n.contentType, t)}</p>
              <p dir="ltr" className="break-all font-mono text-xs">{n.id} · {n.contentRef}</p>
              <p className="whitespace-pre-line">{n.explanation}</p>
              <p className="text-xs text-slate-700">{formatDateTime(n.createdAt)}{n.declaredTrustedFlagger ? ` · ${t('moderation:admin.trusted', 'déclare être signaleur de confiance (à vérifier sur la liste de l’Arcom)')}` : ''}{n.hasContact ? '' : ` · ${t('moderation:admin.no_contact', 'sans adresse')}`}</p>
              <label htmlFor={`${id}-${n.id}`} className="block font-semibold">{t('moderation:statement.facts', 'Faits et circonstances')}</label>
              <textarea id={`${id}-${n.id}`} rows={2} className={input} value={facts[n.id] || ''} onChange={(e) => setFacts({ ...facts, [n.id]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={(facts[n.id] || '').trim().length < 10} onClick={() => close(n, 'no_action')}>{t('moderation:admin.no_action', 'Aucune mesure (motivée)')}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Appeals() {
  const { t } = useT('moderation');
  const id = useId();
  const [items, setItems] = useState(null);
  const [resp, setResp] = useState({});
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { apiClient.admin.moderation('appeals').then((r) => setItems(r?.items || [])).catch((e) => { setItems([]); setMsg(e?.payload?.error || e?.message); }); }, []);
  useEffect(() => { load(); }, [load]);
  const review = async (a, outcome) => {
    setMsg('');
    try { await apiClient.admin.moderationAction({ action: 'appeal_review', id: a.id, outcome, response: resp[a.id] || '' }); setMsg(t('moderation:admin.done', 'Enregistré.')); load(); }
    catch (e) { setMsg(e?.payload?.reviewableFrom ? t('moderation:admin.sole_delay', 'Seul modérateur : réexamen possible à partir du {{d}}.', { d: formatDateTime(e.payload.reviewableFrom) }) : e?.payload?.error || e?.message); }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:admin.appeals', 'Contestations')}</h2>
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
      {items === null ? <p role="status">{t('moderation:loading', 'Chargement…')}</p> : items.length === 0 ? <p className="text-sm text-slate-700">{t('moderation:admin.none', 'Rien à traiter.')}</p> : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm" data-testid="admin-appeal">
              <p className="font-semibold">{contentTypeLabel(a.contentType, t)} — {a.reasonCode} — {formatDateTime(a.decidedAt)} ({a.decidedBy})</p>
              <p><span className="font-semibold">{t('moderation:admin.facts_were', 'Faits retenus :')}</span> {a.facts}</p>
              <p className="whitespace-pre-line"><span className="font-semibold">{t('moderation:admin.appeal_text', 'Contestation :')}</span> {a.body}</p>
              <label htmlFor={`${id}-${a.id}`} className="block font-semibold">{t('moderation:admin.response', 'Réponse motivée')}</label>
              <textarea id={`${id}-${a.id}`} rows={2} className={input} value={resp[a.id] || ''} onChange={(e) => setResp({ ...resp, [a.id]: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                {['upheld', 'reversed', 'modified'].map((o) => (
                  <Button key={o} size="sm" variant="outline" disabled={(resp[a.id] || '').trim().length < 10} onClick={() => review(a, o)}>
                    {{ upheld: t('moderation:admin.upheld', 'Maintenir'), reversed: t('moderation:admin.reversed', 'Annuler la décision'), modified: t('moderation:admin.modified', 'Modifier la mesure') }[o]}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sanctions() {
  const { t } = useT('moderation');
  const id = useId();
  const [v, setV] = useState({ kind: 'warning', scope: 'publishing', userId: '', noticeId: '', reason: '', days: 30 });
  const [msg, setMsg] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      await apiClient.admin.moderationAction({ action: 'sanction', kind: v.kind, scope: v.scope, reason: v.reason, ...(v.userId ? { userId: v.userId.trim() } : { noticeId: v.noticeId.trim() }), ...(v.kind === 'suspension' ? { days: Number(v.days) } : {}) });
      setMsg(t('moderation:admin.done', 'Enregistré.'));
    } catch (err) { setMsg(err?.payload?.error || err?.message); }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:admin.sanctions', 'Abus répétés : avertissement, puis suspension')}</h2>
      <p className="text-sm text-slate-700">{t('moderation:admin.sanctions_help', 'Une suspension exige un avertissement préalable du même type dans les 12 mois. Durée : 1 à {{max}} jours, décidée au cas par cas (nombre, proportion, gravité, intention).', { max: SUSPENSION_MAX_DAYS })}</p>
      <form className="grid gap-2 sm:grid-cols-2" noValidate onSubmit={submit}>
        <label htmlFor={`${id}-k`} className="text-sm font-semibold">{t('moderation:admin.kind', 'Mesure')}
          <select id={`${id}-k`} className={input} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            <option value="warning">{t('moderation:admin.warning', 'Avertissement')}</option><option value="suspension">{t('moderation:admin.suspension', 'Suspension temporaire')}</option>
          </select></label>
        <label htmlFor={`${id}-s`} className="text-sm font-semibold">{t('moderation:admin.scope', 'Portée')}
          <select id={`${id}-s`} className={input} value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })}>
            <option value="publishing">{t('moderation:admin.scope_publishing', 'Publications (contenus manifestement illicites)')}</option><option value="notices">{t('moderation:admin.scope_notices', 'Signalements (manifestement infondés)')}</option>
          </select></label>
        <label htmlFor={`${id}-u`} className="text-sm font-semibold">{t('moderation:admin.user', 'Identifiant du compte (ou laisser vide)')}
          <input id={`${id}-u`} dir="ltr" className={input} value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })} /></label>
        <label htmlFor={`${id}-n`} className="text-sm font-semibold">{t('moderation:admin.notice_ref', 'ou référence d’un signalement sans compte')}
          <input id={`${id}-n`} dir="ltr" className={input} value={v.noticeId} onChange={(e) => setV({ ...v, noticeId: e.target.value })} /></label>
        {v.kind === 'suspension' && <label htmlFor={`${id}-d`} className="text-sm font-semibold">{t('moderation:admin.days', 'Durée en jours')}
          <input id={`${id}-d`} type="number" min={1} max={SUSPENSION_MAX_DAYS} className={input} value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></label>}
        <label htmlFor={`${id}-r`} className="text-sm font-semibold sm:col-span-2">{t('moderation:admin.reason', 'Motifs (envoyés à la personne)')}
          <textarea id={`${id}-r`} rows={2} className={input} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></label>
        <div className="sm:col-span-2"><Button type="submit" disabled={v.reason.trim().length < 10 || (!v.userId.trim() && !v.noticeId.trim())}>{t('moderation:admin.sanction_submit', 'Enregistrer la mesure')}</Button></div>
      </form>
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
    </section>
  );
}

function Transparency() {
  const { t } = useT('moderation');
  const id = useId();
  const [data, setData] = useState(null);
  useEffect(() => { apiClient.admin.moderation('transparency').then(setData).catch(() => setData({})); }, []);
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:admin.transparency', 'Relevés pour le bilan annuel (comptages seulement)')}</h2>
      {data === null ? <p role="status">{t('moderation:loading', 'Chargement…')}</p> : (
        <pre dir="ltr" className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-900">{JSON.stringify(data, null, 2)}</pre>
      )}
    </section>
  );
}

export default function ModerationAdmin() {
  const { t } = useT('moderation');
  const [staffing, setStaffing] = useState(null);
  const [isStaff, setIsStaff] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    apiClient.admin.moderation('staffing').then((r) => setStaffing(r)).catch((e) => setMsg(e?.payload?.error || e?.message || ''));
    apiClient.admin.moderation('appeals').then(() => setIsStaff(true)).catch(() => setIsStaff(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const title = t('moderation:admin.title', 'Modération et signalements');
  return (
    <div className="space-y-8 p-4 sm:p-6">
      <SEO title={title} path="/admin/moderation" noindex />
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700">{t('moderation:admin.intro', 'Les fonctions qui demandent une personne nommée restent fermées tant que personne n’est nommé. Aucune décision n’est automatique.')}</p>
      </div>
      {msg && <p role="alert" className="text-sm text-red-800">{msg}</p>}
      {staffing && <Staffing data={staffing} onChanged={load} />}
      {isStaff ? (<><Notices /><Appeals /><Sanctions /><Transparency /></>)
        : <p className="text-sm text-slate-700" data-testid="moderation-not-staff">{t('moderation:admin.not_staff', 'Les files de signalements et de contestations sont réservées aux personnes nommées.')}</p>}
    </div>
  );
}
