// @ts-nocheck
import { useCallback, useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import HdsUnlock from '@/components/hds/HdsUnlock';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { useCaseLabels } from '@/lib/caseLabelsI18n';
import { formatDate, useT } from '@/i18n';
import { getMemberKey, subscribeKeys } from '@/lib/hdsKeys';
import { saveBlob } from '@/lib/hdsClient';
import * as hs from '@/lib/hdsSharing';

const box = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const field = 'mt-1 block w-full rounded-md border border-slate-400 p-2 text-base text-slate-900';
const REASONS = ['SPECIALISED_SUPPORT', 'ACCESS_TO_RIGHTS', 'HOUSING', 'EMPLOYMENT', 'HEALTH', 'FOOD_AID', 'DIGITAL_SUPPORT', 'LEGAL', 'OTHER'];

/**
 * G14-R4 — « Dossiers chiffrés » (/pro/partages-chiffres): the dossiers people shared with this organisation at the certified health-data host. The member
 * opens them with their personal passphrase (their key opens the organisation key, which opens each dossier key) — nothing is readable on the ADA servers.
 * The administrator creates the organisation key and gives each member access to it. Export, attestation print and the SIAO hand-over sheet are built in this
 * browser; the person sees each of them in their access log. A referral wraps the dossier for the receiving organisation; the PERSON decides.
 */
export default function PartagesChiffres() {
  const { t } = useT('pro');
  const { reason: REASON_LABELS } = useCaseLabels();
  const ids = { msg: useId(), q: useId(), reason: useId(), note: useId(), file: useId() };
  const [keysState, setKeysState] = useState({ loading: true, unavailable: false, data: null });
  const [unlocked, setUnlocked] = useState(Boolean(getMemberKey()));
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [thread, setThread] = useState({ items: [], text: '' });
  const [ref, setRef] = useState({ q: '', receivers: [], to: '', reason: 'ACCESS_TO_RIGHTS', note: '' });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => subscribeKeys(() => setUnlocked(Boolean(getMemberKey()))), []);

  const fail = (err) => {
    const c = err?.code || err?.payload?.error;
    if (c === 'ORG_KEY_LOCKED') return t('pro:hds.org_locked', 'Votre clé ne peut pas encore ouvrir les dossiers de la structure : un administrateur doit vous en donner l’accès.');
    if (c === 'ORG_KEY_MISSING') return t('pro:hds.org_missing', 'La structure destinataire ne peut pas encore recevoir de dossier chiffré.');
    if (c === 'UNSUPPORTED_TYPE') return t('pro:hds.bad_type', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.');
    if (c === 'REKEY_PENDING') return t('pro:hds.rekey_pending', 'La personne est en train de re-chiffrer ce dossier. Réessayez plus tard.');
    return err?.serverMessage || err?.payload?.message || t('pro:hds.error', 'Une erreur est survenue. Réessayez.');
  };
  const run = async (fn, ok) => {
    setBusy(true); setProblem(''); setMessage('');
    try { await fn(); if (ok) setMessage(ok); } catch (err) { setProblem(fail(err)); } finally { setBusy(false); }
  };
  const loadKeys = useCallback(async () => {
    try { const data = await hs.proKeys(); setKeysState({ loading: false, unavailable: !data, data }); }
    catch (err) { setKeysState({ loading: false, unavailable: false, data: null }); setProblem(fail(err)); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once
  const loadList = useCallback(async () => { try { setList((await hs.proList())?.dossiers || []); } catch (err) { setProblem(fail(err)); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadKeys(); }, [loadKeys]);
  useEffect(() => { if (unlocked) loadList(); }, [unlocked, loadList]);

  const k = keysState.data;
  const admin = k?.role === 'STRUCTURE_ADMIN';
  const hasOrgKey = Boolean(k?.orgKeys?.some((o) => o.active));
  const openDossier = (id) => run(async () => { const d = await hs.proOpen(id); setOpen(d); setThread({ items: await hs.readThread('pro', d.key, d.id, k.structureId), text: '' }); });
  const createOrgKey = () => run(async () => { await hs.proCreateOrgKey(); await loadKeys(); }, t('pro:hds.org_created', 'Clé de la structure créée.'));
  const wrapPending = () => run(async () => { const n = await hs.proWrapPending(); await loadKeys(); setMessage(t('pro:hds.members_wrapped', '{{n}} membre(s) peuvent maintenant ouvrir les dossiers.', { n })); });
  const send = (e) => { e.preventDefault(); if (!thread.text.trim()) return;
    run(async () => { await hs.postThread('pro', open.key, open.keyEpoch, open.id, k.structureId, thread.text); setThread({ items: await hs.readThread('pro', open.key, open.id, k.structureId), text: '' }); }); };
  const addFile = (e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('file')?.files?.[0]; if (!f) return;
    run(async () => { await hs.addFile('pro', open.key, open.keyEpoch, open.id, f); setOpen(await hs.proOpen(open.id)); }, t('pro:hds.file_added', 'Document ajouté et chiffré pour la personne.')); };
  const download = (f) => run(async () => { const out = await hs.readFile('pro', open.key, open.id, f); saveBlob(new Blob([out.bytes], { type: out.type }), out.name); });
  const exportJson = () => run(async () => { await hs.proEvent(open.id, 'DOSSIER_EXPORTED');
    saveBlob(new Blob([JSON.stringify({ dossier: open.id, exportedAt: new Date().toISOString(), content: open.decrypted, files: open.files.map((f) => ({ name: f.name, type: f.type, addedBy: f.addedBy })) }, null, 2)], { type: 'application/json' }), `dossier-${open.id.slice(0, 8)}.json`); },
  t('pro:hds.exported', 'Export enregistré. La personne le voit dans son journal.'));
  const printAttestation = () => run(async () => { await hs.proEvent(open.id, 'ATTESTATION_PRINTED'); window.print(); });
  const siaoSheet = () => run(async () => { await hs.proEvent(open.id, 'SIAO_HANDOVER_PREPARED');
    const lines = [t('pro:hds.siao_head', 'Fiche de transmission SIAO (préparée par la structure, à vérifier avant envoi)'), `${t('pro:hds.siao_date', 'Date')} : ${new Date().toLocaleDateString('fr-FR')}`, '', String(open.decrypted?.title || ''), '', String(open.decrypted?.summary || '')];
    saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `fiche-siao-${open.id.slice(0, 8)}.txt`); }, t('pro:hds.siao_done', 'Fiche SIAO enregistrée. La personne le voit dans son journal.'));
  const findReceivers = (e) => { e.preventDefault(); run(async () => setRef({ ...ref, receivers: (await proRdvRequest('/api/pro/referrals', { query: { receivers: ref.q } }))?.receivers || [] })); };
  const propose = (e) => { e.preventDefault(); if (!ref.to) { setProblem(t('pro:hds.choose_receiver', 'Choisissez la structure destinataire.')); return; }
    run(async () => {
      const key = await hs.proPrepareReferral(open.id, ref.to, ref.note);
      try { await proRdvRequest('/api/pro/referrals', { method: 'POST', body: { action: 'propose', hdsDossierId: open.id, toStructureId: ref.to, reasonCode: ref.reason, idempotencyKey: key } }); }
      catch (err) { await hs.proWithdrawReferral(open.id, ref.to).catch(() => {}); throw err; }
      setRef({ q: '', receivers: [], to: '', reason: 'ACCESS_TO_RIGHTS', note: '' });
    }, t('pro:hds.referral_sent', 'Proposition envoyée. Rien n’est transmis tant que la personne n’a pas accepté.')); };

  if (keysState.loading) return <div className="mx-auto max-w-4xl px-4 py-8" role="status">{t('pro:hds.loading', 'Chargement…')}</div>;
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8" data-testid="pro-hds">
      <SEO title={t('pro:hds.title', 'Dossiers chiffrés')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('pro:hds.title', 'Dossiers chiffrés')}</h1>
      <p className="text-sm text-slate-700">{t('pro:hds.intro', 'Les dossiers que des personnes ont partagés avec votre structure. Ils sont chiffrés de bout en bout : seuls les membres à qui un administrateur a donné la clé de la structure peuvent les lire, dans leur navigateur.')}</p>
      <div aria-live="polite" role="status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900" data-testid="pro-hds-problem">{problem}</p> : null}
      {keysState.unavailable ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{t('pro:hds.unavailable', 'Les dossiers chiffrés ne sont pas disponibles sur ce site pour le moment.')}</p> : null}
      {!keysState.unavailable && k && !unlocked ? <HdsUnlock side="pro" hasKey={Boolean(k.member)} onDone={() => { setUnlocked(true); loadKeys(); }} testid="pro-hds-unlock" /> : null}
      {!keysState.unavailable && unlocked ? (<>
        {admin ? (
          <section className={box} aria-labelledby="pro-hds-admin">
            <h2 id="pro-hds-admin" className="text-lg font-semibold text-slate-900">{t('pro:hds.admin', 'Clé de la structure (administrateur)')}</h2>
            {!hasOrgKey ? <Button type="button" onClick={createOrgKey} disabled={busy} data-testid="pro-hds-create-org">{t('pro:hds.create_org', 'Créer la clé de la structure')}</Button>
              : <p className="text-sm text-slate-700">{t('pro:hds.org_ready', 'La structure peut recevoir des dossiers chiffrés.')}</p>}
            {k?.pendingMembers?.length ? <Button type="button" variant="outline" onClick={wrapPending} disabled={busy} data-testid="pro-hds-wrap">{t('pro:hds.wrap_pending', 'Donner l’accès à {{n}} membre(s) qui ont créé leur clé', { n: k.pendingMembers.length })}</Button> : null}
            {hasOrgKey ? <Button type="button" variant="outline" onClick={createOrgKey} disabled={busy}>{t('pro:hds.rotate', 'Changer la clé de la structure (après le départ d’un membre)')}</Button> : null}
          </section>) : null}
        <section className={box} aria-labelledby="pro-hds-list">
          <h2 id="pro-hds-list" className="text-lg font-semibold text-slate-900">{t('pro:hds.list', 'Dossiers partagés avec la structure')}</h2>
          {list.length ? <ul className="space-y-2" data-testid="pro-hds-items">{list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
              <span>{t('pro:hds.item', 'Dossier reçu le {{date}}', { date: formatDate(d.grantedAt) })}{d.expiresAt ? ` — ${t('pro:hds.until', 'accès jusqu’au {{date}}', { date: formatDate(d.expiresAt) })}` : ''}{d.source === 'referral' ? ` — ${t('pro:hds.via_referral', 'par orientation')}` : ''}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => openDossier(d.id)} disabled={busy}>{t('pro:hds.open', 'Ouvrir')}</Button></li>))}</ul>
            : <p className="text-sm text-slate-700">{t('pro:hds.empty', 'Aucun dossier partagé pour le moment.')}</p>}
        </section>
        {open ? (
          <section className={`${box} print:border-0 print:shadow-none`} aria-labelledby="pro-hds-open" data-testid="pro-hds-detail">
            <h2 id="pro-hds-open" className="text-lg font-semibold text-slate-900">{open.decrypted?.title}</h2>
            {open.decrypted?.summary ? <p className="whitespace-pre-wrap text-sm text-slate-800">{open.decrypted.summary}</p> : null}
            <ul className="space-y-1 print:hidden">{open.files.map((f) => <li key={f.id}><button type="button" className="text-sm text-blue-800 underline" onClick={() => download(f)}>{t('pro:hds.download', 'Télécharger « {{name}} »', { name: f.name })}</button></li>)}</ul>
            <form className="flex flex-wrap items-end gap-2 print:hidden" onSubmit={addFile}>
              <div><label htmlFor={ids.file} className="block text-sm text-slate-800">{t('pro:hds.add_file', 'Ajouter un document pour la personne (PDF, PNG ou JPEG)')}</label><input id={ids.file} name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="mt-1 text-sm" /></div>
              <Button type="submit" size="sm" disabled={busy}>{t('pro:hds.add', 'Ajouter')}</Button></form>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button type="button" size="sm" variant="outline" onClick={exportJson} disabled={busy}>{t('pro:hds.export', 'Exporter (fichier)')}</Button>
              <Button type="button" size="sm" variant="outline" onClick={printAttestation} disabled={busy}>{t('pro:hds.print', 'Imprimer une attestation')}</Button>
              <Button type="button" size="sm" variant="outline" onClick={siaoSheet} disabled={busy}>{t('pro:hds.siao', 'Préparer la fiche SIAO')}</Button>
            </div>
            <div className="space-y-2 print:hidden">
              <h3 className="font-semibold text-slate-900">{t('pro:hds.thread', 'Messages avec la personne')}</h3>
              <ul className="space-y-1">{thread.items.map((m) => <li key={m.id} className="rounded-md bg-slate-50 p-2 text-sm"><strong>{m.author === 'pro' ? t('pro:hds.us', 'Structure') : t('pro:hds.person', 'Personne')}</strong> — {formatDate(m.createdAt)} : <span className="whitespace-pre-wrap">{m.text}</span></li>)}</ul>
              <form className="grid gap-2" onSubmit={send}><label htmlFor={ids.msg} className="block text-sm text-slate-800">{t('pro:hds.write', 'Votre message')}</label>
                <textarea id={ids.msg} rows={3} className={field} value={thread.text} maxLength={4000} onChange={(e) => setThread({ ...thread, text: e.target.value })} />
                <div><Button type="submit" size="sm" disabled={busy}>{t('pro:hds.send', 'Envoyer')}</Button></div></form>
            </div>
            <div className="space-y-2 print:hidden">
              <h3 className="font-semibold text-slate-900">{t('pro:hds.referral', 'Proposer une orientation vers une autre structure')}</h3>
              <form className="flex gap-2" onSubmit={findReceivers}><label htmlFor={ids.q} className="sr-only">{t('pro:hds.receiver_search', 'Nom de la structure destinataire')}</label>
                <input id={ids.q} className={field} placeholder={t('pro:hds.receiver_search', 'Nom de la structure destinataire')} value={ref.q} onChange={(e) => setRef({ ...ref, q: e.target.value })} />
                <Button type="submit" variant="outline" disabled={busy}>{t('pro:hds.search', 'Chercher')}</Button></form>
              {ref.receivers.length ? (
                <form className="grid gap-2" onSubmit={propose}>
                  <fieldset><legend className="text-sm font-medium text-slate-800">{t('pro:hds.receiver', 'Structure destinataire')}</legend>
                    {ref.receivers.map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="radio" name="to" checked={ref.to === r.id} onChange={() => setRef({ ...ref, to: r.id })} />{r.name}{r.city ? ` (${r.city})` : ''}</label>)}</fieldset>
                  <label htmlFor={ids.reason} className="block text-sm text-slate-800">{t('pro:hds.reason', 'Motif')}</label>
                  <select id={ids.reason} className={field} value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })}>{REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r] || r}</option>)}</select>
                  <label htmlFor={ids.note} className="block text-sm text-slate-800">{t('pro:hds.note', 'Note pour la structure destinataire (chiffrée, facultative)')}</label>
                  <textarea id={ids.note} rows={3} className={field} value={ref.note} maxLength={4000} onChange={(e) => setRef({ ...ref, note: e.target.value })} />
                  <div><Button type="submit" disabled={busy}>{t('pro:hds.propose', 'Proposer à la personne')}</Button></div>
                </form>) : null}
            </div>
          </section>) : null}
      </>) : null}
    </div>
  );
}
