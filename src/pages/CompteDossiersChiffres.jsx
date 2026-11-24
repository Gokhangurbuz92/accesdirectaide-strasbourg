// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import HdsUnlock from '@/components/hds/HdsUnlock';
import { formatDate, useT } from '@/i18n';
import { getVaultKey, subscribeKeys } from '@/lib/hdsKeys';
import { saveBlob } from '@/lib/hdsClient';
import { citizenApi } from '@/lib/citizenApi';
import * as hs from '@/lib/hdsSharing';

const box = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const field = 'mt-1 block w-full rounded-md border border-slate-400 p-2 text-base text-slate-900';

/**
 * G14-R4 — « Mes dossiers partagés (chiffrés) » (/compte/dossiers-chiffres): the person's shared dossiers at the certified health-data host. Everything is
 * encrypted in this browser with the Mon Coffre key; an organisation reads a dossier only after the person shares it (explicit consent to the approved
 * text, optional end date) and stops reading it when access is withdrawn (the dossier is then re-encrypted with a new key). A proposal of an organisation
 * (referral) waits for the person's decision. Threads, files and the access log are here too; « Exporter » saves everything, decrypted, on this device.
 */
export default function CompteDossiersChiffres() {
  const { t } = useT('compte');
  const ids = { title: useId(), summary: useId(), end: useId(), q: useId(), shareEnd: useId(), consent: useId(), msg: useId(), file: useId() };
  const [unlocked, setUnlocked] = useState(Boolean(getVaultKey()));
  const [state, setState] = useState({ loading: true, unavailable: false, dossiers: [], consentVersion: null });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', summary: '', end: '' });
  const [open, setOpen] = useState(null);
  const [share, setShare] = useState({ q: '', results: [], structureId: '', end: '', consent: false });
  const [thread, setThread] = useState({ structureId: '', items: [], text: '' });
  const [log, setLog] = useState(null);

  useEffect(() => subscribeKeys(() => setUnlocked(Boolean(getVaultKey()))), []);
  const fail = (err) => {
    const c = err?.code;
    if (c === 'SHARE_CONSENT_NOT_CONFIGURED') return t('compte:hds_dossiers.consent_not_ready', 'Le partage n’est pas encore ouvert : le texte d’accord doit d’abord être approuvé.');
    if (c === 'ORG_KEY_MISSING') return t('compte:hds_dossiers.org_not_ready', 'Cette structure ne peut pas encore recevoir de dossier chiffré.');
    if (c === 'UNSUPPORTED_TYPE') return t('compte:hds_dossiers.bad_type', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.');
    if (c === 'VAULT_LOCKED') return t('compte:hds_dossiers.locked', 'Ouvrez d’abord vos clés avec la phrase secrète de Mon Coffre.');
    return err?.serverMessage || t('compte:hds_dossiers.error', 'Une erreur est survenue. Réessayez.');
  };
  const run = async (fn, ok) => {
    setBusy(true); setProblem(''); setMessage('');
    try { await fn(); if (ok) setMessage(ok); } catch (err) { setProblem(fail(err)); } finally { setBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const out = await hs.listOwn();
      if (!out) { setState({ loading: false, unavailable: true, dossiers: [], consentVersion: null }); return; }
      setState({ loading: false, unavailable: false, dossiers: out.dossiers || [], consentVersion: out.shareConsentVersion || null });
    } catch (err) { setState((s) => ({ ...s, loading: false })); setProblem(fail(err)); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once
  useEffect(() => { load(); }, [load]);

  const openDossier = async (id) => run(async () => { setOpen(await hs.openOwn(id)); setThread({ structureId: '', items: [], text: '' }); setLog(null); });
  const reloadOpen = async () => { if (open) setOpen(await hs.openOwn(open.id)); await load(); };

  const create = (e) => { e.preventDefault(); if (!form.title.trim()) { setProblem(t('compte:hds_dossiers.title_required', 'Donnez un titre au dossier.')); return; }
    run(async () => { await hs.createOwn({ title: form.title, summary: form.summary }, form.end || undefined); setForm({ title: '', summary: '', end: '' }); await load(); }, t('compte:hds_dossiers.created', 'Dossier créé et chiffré.')); };
  const search = async (e) => { e.preventDefault();
    run(async () => { const r = await fetch(`/api/structures?q=${encodeURIComponent(share.q)}&limit=10`, { credentials: 'same-origin' }); const j = await r.json().catch(() => ({}));
      setShare((s) => ({ ...s, results: (j.items || []).map((x) => ({ id: String(x.id), name: x.nom || x.name || x.id, city: x.ville || x.city || '' })) })); }); };
  const doShare = (e) => { e.preventDefault();
    if (!share.structureId) { setProblem(t('compte:hds_dossiers.choose_org', 'Choisissez une structure.')); return; }
    if (!share.consent) { setProblem(t('compte:hds_dossiers.consent_required', 'Cochez la case pour donner votre accord.')); return; }
    run(async () => { await hs.shareWith(open.id, share.structureId, state.consentVersion, share.end || undefined); setShare({ q: '', results: [], structureId: '', end: '', consent: false }); await reloadOpen(); },
      t('compte:hds_dossiers.shared', 'Dossier partagé. La structure peut maintenant le lire.')); };
  const revoke = (structureId) => run(async () => { await hs.revoke(open.id, structureId); await reloadOpen(); }, t('compte:hds_dossiers.revoked', 'Accès retiré. Le dossier a été chiffré avec une nouvelle clé.'));
  // the referral's workflow lives in Mon Espace (closed codes, states); its payload here: both answers are given together, the HDS one first
  const answer = (g, accept) => run(async () => {
    if (accept && !window.confirm(t('compte:hds_dossiers.referral_confirm', 'Vous acceptez que cette structure lise ce dossier. Continuer ?'))) return;
    const ref = ((await citizenApi.referrals().catch(() => ({ referrals: [] })))?.referrals || []).find((r) => r.ref && r.ref === g.referralRef && r.status === 'PENDING_CITIZEN');
    await hs.answerReferral(open.id, g.structureId, accept, state.consentVersion);
    if (ref) {
      try { await citizenApi.decideReferral(ref.id, accept ? 'accept' : 'refuse'); }
      catch (e) { if (accept) await hs.revoke(open.id, g.structureId); throw e; }   // no access without the recorded decision
    }
    await reloadOpen();
  }, accept ? t('compte:hds_dossiers.referral_accepted', 'Proposition acceptée.') : t('compte:hds_dossiers.referral_refused', 'Proposition refusée. Rien n’a été transmis.'));
  const loadThread = (structureId) => run(async () => setThread({ structureId, items: await hs.readThread('citizen', open.key, open.id, structureId), text: '' }));
  const send = (e) => { e.preventDefault(); if (!thread.text.trim()) return;
    run(async () => { await hs.postThread('citizen', open.key, open.keyEpoch, open.id, thread.structureId, thread.text); setThread({ ...thread, items: await hs.readThread('citizen', open.key, open.id, thread.structureId), text: '' }); }); };
  const addFile = (e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('file')?.files?.[0]; if (!f) return;
    run(async () => { await hs.addFile('citizen', open.key, open.keyEpoch, open.id, f); await reloadOpen(); }, t('compte:hds_dossiers.file_added', 'Document ajouté et chiffré.')); };
  const download = (f) => run(async () => { const out = await hs.readFile('citizen', open.key, open.id, f); saveBlob(new Blob([out.bytes], { type: out.type }), out.name); });
  const remove = () => { if (!window.confirm(t('compte:hds_dossiers.delete_confirm', 'Supprimer ce dossier pour tout le monde ? Cette action est définitive.'))) return;
    run(async () => { await hs.removeOwn(open.id); setOpen(null); await load(); }, t('compte:hds_dossiers.deleted', 'Dossier supprimé.')); };
  const showLog = () => run(async () => setLog((await hs.accessLog(open.id))?.events || []));
  const exportAll = () => run(async () => { const out = await hs.exportAll(); saveBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'mes-donnees-chiffrees-ada.json'); },
    t('compte:hds_dossiers.exported', 'Export enregistré sur cet appareil.'));
  const statusLabel = (g) => ({ active: t('compte:hds_dossiers.st_active', 'accès ouvert'), pending_citizen: t('compte:hds_dossiers.st_pending', 'proposition en attente de votre accord'),
    revoked: t('compte:hds_dossiers.st_revoked', 'accès retiré'), refused: t('compte:hds_dossiers.st_refused', 'proposition refusée') }[g.status] || g.status);

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:hds_dossiers.loading', 'Chargement…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="hds-dossiers">
      <SEO title={t('compte:hds_dossiers.title', 'Mes dossiers partagés')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:hds_dossiers.title', 'Mes dossiers partagés')}</h1>
      <p className="text-sm text-slate-700">{t('compte:hds_dossiers.intro', 'Vos dossiers sont chiffrés dans votre navigateur avant d’être conservés chez un hébergeur certifié pour les données de santé. Seules les structures que vous choisissez peuvent les lire. Vous pouvez retirer un accès à tout moment.')}</p>
      <div aria-live="polite" role="status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" data-testid="hds-dossiers-status">{message}</p> : null}</div>
      {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900" data-testid="hds-dossiers-problem">{problem}</p> : null}
      {state.unavailable ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="hds-dossiers-unavailable">{t('compte:hds_dossiers.unavailable', 'Les dossiers chiffrés ne sont pas disponibles sur ce site pour le moment.')}</p> : null}
      {!state.unavailable && !unlocked ? <HdsUnlock side="citizen" onDone={() => { setUnlocked(true); load(); }} testid="hds-dossiers-unlock" /> : null}
      {!state.unavailable && unlocked ? (<>
        <section className={box} aria-labelledby="hds-new">
          <h2 id="hds-new" className="text-lg font-semibold text-slate-900">{t('compte:hds_dossiers.new', 'Créer un dossier')}</h2>
          <form className="grid gap-3" onSubmit={create}>
            <div><label htmlFor={ids.title} className="block text-sm font-medium text-slate-800">{t('compte:hds_dossiers.f_title', 'Titre')}</label>
              <input id={ids.title} className={field} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="hds-new-title" /></div>
            <div><label htmlFor={ids.summary} className="block text-sm font-medium text-slate-800">{t('compte:hds_dossiers.f_summary', 'Ce que vous voulez dire à la structure (facultatif)')}</label>
              <textarea id={ids.summary} rows={4} className={field} value={form.summary} maxLength={20000} onChange={(e) => setForm({ ...form, summary: e.target.value })} data-testid="hds-new-summary" /></div>
            <div><label htmlFor={ids.end} className="block text-sm font-medium text-slate-800">{t('compte:hds_dossiers.f_end', 'Supprimer automatiquement après le (facultatif)')}</label>
              <input id={ids.end} type="date" className={field} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
            <div><Button type="submit" disabled={busy} data-testid="hds-new-submit">{t('compte:hds_dossiers.create', 'Créer le dossier')}</Button></div>
          </form>
        </section>

        <section className={box} aria-labelledby="hds-list">
          <h2 id="hds-list" className="text-lg font-semibold text-slate-900">{t('compte:hds_dossiers.list', 'Mes dossiers')}</h2>
          {state.dossiers.length ? (
            <ul className="space-y-2" data-testid="hds-dossier-list">
              {state.dossiers.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm" data-testid="hds-dossier-item">
                  <span>{t('compte:hds_dossiers.item', 'Dossier du {{date}}', { date: formatDate(d.createdAt) })} — {t('compte:hds_dossiers.shared_with', 'partagé avec {{n}} structure(s)', { n: d.grants.filter((g) => g.status === 'active').length })}
                    {d.grants.some((g) => g.status === 'pending_citizen') ? <strong className="ml-1 text-amber-900"> — {t('compte:hds_dossiers.has_pending', 'une proposition attend votre réponse')}</strong> : null}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => openDossier(d.id)} data-testid="hds-dossier-open">{t('compte:hds_dossiers.open', 'Ouvrir')}</Button>
                </li>))}
            </ul>) : <p className="text-sm text-slate-700">{t('compte:hds_dossiers.empty', 'Aucun dossier pour le moment.')}</p>}
          <Button type="button" variant="outline" onClick={exportAll} disabled={busy} data-testid="hds-export">{t('compte:hds_dossiers.export', 'Exporter toutes mes données chiffrées (déchiffrées sur cet appareil)')}</Button>
        </section>

        {open ? (
          <section className={box} aria-labelledby="hds-open" data-testid="hds-dossier-detail">
            <h2 id="hds-open" className="text-lg font-semibold text-slate-900">{open.decrypted?.title}</h2>
            {open.decrypted?.summary ? <p className="whitespace-pre-wrap text-sm text-slate-800">{open.decrypted.summary}</p> : null}
            <h3 className="font-semibold text-slate-900">{t('compte:hds_dossiers.files', 'Documents')}</h3>
            <ul className="space-y-1">{open.files.map((f) => <li key={f.id}><button type="button" className="text-sm text-blue-800 underline" onClick={() => download(f)}>{t('compte:hds_dossiers.download', 'Télécharger « {{name}} »', { name: f.name })}</button></li>)}</ul>
            <form className="flex flex-wrap items-end gap-2" onSubmit={addFile}>
              <div><label htmlFor={ids.file} className="block text-sm text-slate-800">{t('compte:hds_dossiers.add_file', 'Ajouter un document (PDF, PNG ou JPEG, 3 Mo au plus)')}</label><input id={ids.file} name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="mt-1 text-sm" /></div>
              <Button type="submit" size="sm" disabled={busy}>{t('compte:hds_dossiers.add', 'Ajouter')}</Button>
            </form>

            <h3 className="font-semibold text-slate-900">{t('compte:hds_dossiers.access', 'Qui peut lire ce dossier')}</h3>
            <ul className="space-y-2" data-testid="hds-grants">{open.grants.map((g) => (
              <li key={g.structureId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                <span>{g.structureId} — {statusLabel(g)}{g.expiresAt ? ` — ${t('compte:hds_dossiers.until', 'jusqu’au {{date}}', { date: formatDate(g.expiresAt) })}` : ''}</span>
                <span className="flex flex-wrap gap-2">
                  {g.status === 'active' ? <Button type="button" size="sm" variant="outline" onClick={() => loadThread(g.structureId)}>{t('compte:hds_dossiers.messages', 'Messages')}</Button> : null}
                  {g.status === 'active' ? <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={() => revoke(g.structureId)} data-testid="hds-revoke">{t('compte:hds_dossiers.revoke', 'Retirer l’accès')}</Button> : null}
                  {g.status === 'pending_citizen' ? <><Button type="button" size="sm" onClick={() => answer(g, true)} disabled={!state.consentVersion} data-testid="hds-referral-accept">{t('compte:hds_dossiers.accept', 'Accepter')}</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => answer(g, false)} data-testid="hds-referral-refuse">{t('compte:hds_dossiers.refuse', 'Refuser')}</Button></> : null}
                </span>
              </li>))}</ul>

            <form className="grid gap-2" onSubmit={search}>
              <label htmlFor={ids.q} className="block text-sm font-medium text-slate-800">{t('compte:hds_dossiers.find_org', 'Partager avec une structure : cherchez son nom')}</label>
              <div className="flex gap-2"><input id={ids.q} className={field} value={share.q} onChange={(e) => setShare({ ...share, q: e.target.value })} /><Button type="submit" variant="outline" disabled={busy}>{t('compte:hds_dossiers.search', 'Chercher')}</Button></div>
            </form>
            {share.results.length ? (
              <form className="grid gap-3" onSubmit={doShare}>
                <fieldset><legend className="text-sm font-medium text-slate-800">{t('compte:hds_dossiers.choose', 'Structure')}</legend>
                  {share.results.map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="radio" name="org" value={r.id} checked={share.structureId === r.id} onChange={() => setShare({ ...share, structureId: r.id })} />{r.name}{r.city ? ` (${r.city})` : ''}</label>)}</fieldset>
                <div><label htmlFor={ids.shareEnd} className="block text-sm text-slate-800">{t('compte:hds_dossiers.share_end', 'Accès jusqu’au (facultatif)')}</label><input id={ids.shareEnd} type="date" className={field} value={share.end} onChange={(e) => setShare({ ...share, end: e.target.value })} /></div>
                <label htmlFor={ids.consent} className="flex items-start gap-2 text-sm text-slate-800"><input id={ids.consent} type="checkbox" checked={share.consent} onChange={(e) => setShare({ ...share, consent: e.target.checked })} data-testid="hds-share-consent" />
                  <span>{t('compte:hds_dossiers.consent', 'J’accepte que cette structure lise ce dossier et ses documents. Je peux retirer cet accès à tout moment. (Texte d’accord, version {{v}})', { v: state.consentVersion || '—' })}</span></label>
                <div><Button type="submit" disabled={busy || !state.consentVersion} data-testid="hds-share-submit">{t('compte:hds_dossiers.share', 'Partager')}</Button></div>
                {!state.consentVersion ? <p className="text-sm text-amber-900">{t('compte:hds_dossiers.consent_not_ready', 'Le partage n’est pas encore ouvert : le texte d’accord doit d’abord être approuvé.')}</p> : null}
              </form>) : null}

            {thread.structureId ? (
              <div className="space-y-2" data-testid="hds-thread">
                <h3 className="font-semibold text-slate-900">{t('compte:hds_dossiers.thread', 'Messages avec {{org}}', { org: thread.structureId })}</h3>
                <ul className="space-y-1">{thread.items.map((m) => <li key={m.id} className="rounded-md bg-slate-50 p-2 text-sm"><strong>{m.author === 'citizen' ? t('compte:hds_dossiers.me', 'Moi') : t('compte:hds_dossiers.org', 'Structure')}</strong> — {formatDate(m.createdAt)} : <span className="whitespace-pre-wrap">{m.text}</span></li>)}</ul>
                <form className="grid gap-2" onSubmit={send}><label htmlFor={ids.msg} className="block text-sm text-slate-800">{t('compte:hds_dossiers.write', 'Votre message')}</label>
                  <textarea id={ids.msg} rows={3} className={field} value={thread.text} maxLength={4000} onChange={(e) => setThread({ ...thread, text: e.target.value })} />
                  <div><Button type="submit" size="sm" disabled={busy}>{t('compte:hds_dossiers.send', 'Envoyer')}</Button></div></form>
              </div>) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={showLog} data-testid="hds-log">{t('compte:hds_dossiers.log', 'Voir qui a consulté ce dossier')}</Button>
              <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" onClick={remove} data-testid="hds-delete">{t('compte:hds_dossiers.delete', 'Supprimer le dossier')}</Button>
            </div>
            {log ? <ul className="space-y-1 text-sm" data-testid="hds-log-list">{log.map((ev, i) => <li key={`${ev.at}-${i}`}>{formatDate(ev.at)} — {ev.actorType === 'pro' ? t('compte:hds_dossiers.by_org', 'structure {{org}}', { org: ev.structureId || '' }) : t('compte:hds_dossiers.by_me', 'vous')} — {ev.action}</li>)}</ul> : null}
          </section>) : null}
        <p className="text-sm"><Link className="text-blue-800 underline" to="/compte/coffre">{t('compte:hds_dossiers.back_coffre', 'Retour à Mon Coffre')}</Link></p>
      </>) : null}
    </div>
  );
}
