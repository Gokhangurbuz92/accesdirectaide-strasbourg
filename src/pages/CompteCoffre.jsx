// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { COFFRE_UPLOAD_CATEGORIES, fileToBase64 } from '@/lib/monEspace';
import { saveBlob } from '@/lib/hdsClient';
import { VAULT_PASSPHRASE_MIN, changePassphrase, createKeyring, encryptDocument, openContent, openMeta, recoverWithCode, renewRecoveryCode, sniffType, unlockKeyring } from '@/lib/vaultCrypto';
import { RecoveryCodePanel, VaultRecoveryForm, VaultSecurityCard } from '@/components/hds/VaultRecovery';
import VaultHealthConsent from '@/components/hds/VaultHealthConsent';
import { healthCategoryOffered } from '@/lib/vaultHealth';
import { useMonEspaceLabels } from '@/lib/monEspaceLabels';
import { getVaultKey, setVaultKey } from '@/lib/hdsKeys';
import { ensureBoxKey } from '@/lib/hdsSharing';
import { MAX_SIZE } from '@/lib/fileVaultLimits';
import { formatDate, useT } from '@/i18n';

const ACCEPT = 'application/pdf,image/png,image/jpeg';
const MAX = MAX_SIZE;   // PKG-11 audit: 3 Mo — the JSON upload (base64, +33 %) must fit the ~4.5 MB serverless body (10 Mo was offered and then failed)

/**
 * PKG-2 / C09 — Mon Coffre (/compte/coffre): the person keeps their own papers. The server encrypts each file before storing it, checks its type from its content and enforces
 * the limits; the screen says plainly that files are NOT scanned by an antivirus yet. Download and deletion are immediate; deletion also erases the stored file.
 */
export default function CompteCoffre() {
  const { t } = useT('compte');
  const { coffreCategory: COFFRE_CATEGORY_LABELS, formatBytes } = useMonEspaceLabels();
  const [state, setState] = useState({ loading: true, error: '', documents: [], quota: null });
  const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ category: 'identite', expiresAt: '' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  // G14-R3 end-to-end mode (HDS service): the vault key lives only in this page (non-extractable CryptoKey), never in storage, never sent
  const vaultKeyRef = useRef(getVaultKey());   // G14-R4: the key unlocked on another screen of this page life (memory only)
  const [e2e, setE2e] = useState({ on: false, keyring: null, unlocked: false });
  const [pass, setPass] = useState({ a: '', b: '' });
  // G14-R4: the recovery code is shown ONCE (memory only), then forgotten by the page; « recover » = the forgotten-passphrase form
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recovering, setRecovering] = useState(false);
  // G14-R4b: health documents (art. 9.2.a) — what the HDS service announces ({ enabled, version }) and the person's current consent (version or null)
  const [health, setHealth] = useState({ category: null, consent: null });

  const load = useCallback(async () => {
    try {
      const out = await citizenApi.listCoffre();
      let documents = out.documents || [];
      if (out.e2e) {
        setE2e({ on: true, keyring: out.keyring || null, unlocked: Boolean(vaultKeyRef.current) });
        setHealth({ category: out.healthCategory || null, consent: out.healthConsent || null });
        documents = vaultKeyRef.current ? await Promise.all(documents.map(async (d) => {
          const m = await openMeta(vaultKeyRef.current, d);
          return { ...d, name: m.name, category: m.category, mimeType: m.type };
        })) : [];
      }
      setState({ loading: false, error: '', documents, quota: out.quota });
    }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:coffre.login_required', 'Connectez-vous pour accéder à Mon Coffre.') : err.message, auth: err.status === 401, documents: [], quota: null }); }   // R18: « Se connecter » only when the session is really missing (401); any other failure offers to try again (it read as « please sign in »)
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);

  // G14-R4b: « Santé » is offered only with the consent of the version this build shows (never the legacy route, never without the box)
  const healthOk = e2e.on && healthCategoryOffered(health.category) && health.consent === health.category?.version;
  const categories = Object.keys(COFFRE_CATEGORY_LABELS).filter((c) => (c === 'sante' ? healthOk : COFFRE_UPLOAD_CATEGORIES.includes(c)));
  const giveHealth = async (version) => {
    setMessage(''); setProblem(''); setBusy(true);
    try { await citizenApi.giveCoffreHealthConsent(version); setMessage(t('compte:coffre_sante.given_saved', 'Votre accord est enregistré.')); await load(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const withdrawHealth = async () => {
    setMessage(''); setProblem(''); setBusy(true);
    try {
      await citizenApi.withdrawCoffreHealthConsent();
      if (form.category === 'sante') setForm((f) => ({ ...f, category: 'identite' }));
      setMessage(t('compte:coffre_sante.withdrawn_saved', 'Votre accord est retiré. Les documents de santé déjà conservés restent jusqu’à ce que vous les supprimiez.')); await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };

  const upload = async (e) => {
    e.preventDefault(); setMessage(''); setProblem('');
    if (form.category === 'sante' && !healthOk) { setProblem(t('compte:coffre_sante.consent_needed', 'Pour ajouter un document de santé, donnez d’abord votre accord ci-dessous.')); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) { setProblem(t('compte:coffre.choose_file', 'Choisissez un fichier.')); return; }
    if (file.size > MAX) { setProblem(t('compte:coffre.too_big', 'Fichier trop volumineux (3 Mo au plus).')); return; }
    setBusy(true);
    try {
      if (e2e.on) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = sniffType(bytes);
        if (!type) { setProblem(t('compte:coffre.e2e_type_unsupported', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.')); return; }
        const boxes = await encryptDocument(vaultKeyRef.current, { bytes, name: file.name.slice(0, 200), category: form.category, type });
        await citizenApi.uploadCoffre({ ...boxes, expiresAt: form.expiresAt || undefined });
      } else await citizenApi.uploadCoffre({ category: form.category, originalName: file.name, mimeType: file.type || undefined, fileBase64: await fileToBase64(file), expiresAt: form.expiresAt || undefined });
      setMessage(t('compte:coffre.saved', 'Document enregistré dans Mon Coffre.')); if (fileRef.current) fileRef.current.value = ''; await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const remove = async (d) => {
    setMessage(''); setProblem('');
    try { await citizenApi.deleteCoffre(d.id); setMessage(t('compte:coffre.deleted', 'Document supprimé.')); await load(); } catch (err) { setProblem(err.message); }
  };

  // G14-R3: through the HDS service the encrypted document is fetched with a single-use ticket, opened here and saved from memory
  const download = async (d) => {
    setProblem('');
    try {
      const out = await citizenApi.downloadCoffre(d.id);
      if (out?.content) saveBlob(new Blob([await openContent(vaultKeyRef.current, d, out.content)], { type: d.mimeType }), d.name);
    } catch (err) { setProblem(err.message); }
  };
  const protect = async (e) => {
    e.preventDefault(); setMessage(''); setProblem('');
    if (pass.a.length < VAULT_PASSPHRASE_MIN) { setProblem(t('compte:coffre.e2e_too_short', 'La phrase secrète doit contenir au moins {{min}} caractères.', { min: VAULT_PASSPHRASE_MIN })); return; }
    if (pass.a !== pass.b) { setProblem(t('compte:coffre.e2e_mismatch', 'Les deux phrases secrètes ne sont pas identiques.')); return; }
    setBusy(true);
    try { const k = await createKeyring(pass.a); await citizenApi.setCoffreKeyring(k.keyring); vaultKeyRef.current = k.vaultKey; setVaultKey(k.vaultKey); await ensureBoxKey(k.vaultKey).catch(() => null); setPass({ a: '', b: '' }); setRecoveryCode(k.recoveryCode); await load(); }
    catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const unlock = async (e) => {
    e.preventDefault(); setMessage(''); setProblem('');
    setBusy(true);
    try {
      const key = await unlockKeyring(e2e.keyring, pass.a);
      if (!key) { setProblem(t('compte:coffre.e2e_phrase_incorrect', 'Phrase secrète incorrecte.')); return; }
      vaultKeyRef.current = key; setVaultKey(key); await ensureBoxKey(key).catch(() => null); setPass({ a: '', b: '' }); await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };

  // G14-R4: forgotten passphrase → the recovery code opens the same vault key; a new passphrase AND a new code are set (the used code is spent)
  const recover = async (code, next) => {
    setMessage(''); setProblem(''); setBusy(true);
    try {
      const r = await recoverWithCode(e2e.keyring, code, next);
      if (!r) { setProblem(t('compte:recovery.wrong_code', 'Code de secours incorrect.')); return; }
      await citizenApi.replaceCoffreKeyring(r.keyring, r.authToken, 'recovery');
      vaultKeyRef.current = r.vaultKey; setVaultKey(r.vaultKey); setRecovering(false); setRecoveryCode(r.recoveryCode);
      setMessage(t('compte:recovery.recovered', 'Mon Coffre est ouvert avec votre nouvelle phrase secrète. Notez votre nouveau code de secours : l’ancien ne marche plus.'));
      await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const changePass = async (current, next) => {
    setMessage(''); setProblem(''); setBusy(true);
    try {
      const c = await changePassphrase(e2e.keyring, current, next);
      if (!c) { setProblem(t('compte:recovery.wrong_current', 'Phrase secrète actuelle incorrecte.')); return; }
      await citizenApi.replaceCoffreKeyring(c.keyring, c.authToken, 'passphrase_change');
      setMessage(t('compte:recovery.changed', 'Phrase secrète changée. Votre code de secours reste le même.')); await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  const renewCode = async (current) => {
    setMessage(''); setProblem(''); setBusy(true);
    try {
      const r = await renewRecoveryCode(e2e.keyring, current);
      if (!r) { setProblem(t('compte:recovery.wrong_current', 'Phrase secrète actuelle incorrecte.')); return; }
      await citizenApi.replaceCoffreKeyring(r.keyring, r.authToken, e2e.keyring?.recovery ? 'recovery_renewed' : 'recovery_added');
      setRecoveryCode(r.recoveryCode); setMessage(t('compte:recovery.renewed', 'Nouveau code de secours créé. L’ancien ne marche plus.')); await load();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('compte:coffre.chargement_mon_coffre', 'Chargement de Mon Coffre…')}</div>;
  if (state.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8" data-testid="coffre-error">
        <SEO title={t('compte:coffre.mon_coffre', 'Mon Coffre')} noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">{t('compte:coffre.mon_coffre', 'Mon Coffre')}</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>
        {state.auth ? <Button asChild className="mt-4" variant="outline"><Link to="/auth/login?next=/compte/coffre">{t('compte:coffre.connecter', 'Se connecter')}</Link></Button>
          : <Button type="button" className="mt-4" variant="outline" onClick={() => { setState((s) => ({ ...s, loading: true })); load(); }} data-testid="coffre-retry">{t('compte:coffre.reessayer', 'Réessayer')}</Button>}
      </div>
    );
  }
  const q = state.quota;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-coffre">
      <SEO title={t('compte:coffre.mon_coffre', 'Mon Coffre')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:coffre.mon_coffre', 'Mon Coffre')}</h1>
      {e2e.on ? <p className="text-sm text-slate-700" data-testid="coffre-e2e-intro">{t('compte:coffre.e2e_intro_r4', 'Vos documents sont chiffrés dans votre navigateur avant d’être envoyés à un hébergeur certifié pour les données de santé : ni AccèsDirectAide ni l’hébergeur ne peuvent les lire. Si vous oubliez votre phrase secrète, votre code de secours ouvre Mon Coffre. Si vous perdez les deux, vos documents sont perdus.')}</p> : null}
      {e2e.on ? null : <p className="text-sm text-slate-700">{t('compte:coffre.gardez_ici_vos_papiers', 'Gardez ici vos papiers importants. Chaque fichier est chiffré sur le serveur avant d’être conservé ; vous seul y avez accès depuis votre compte.')}</p>}
      {/* G14-R4b: at the HDS service the host IS certified — the notice then says whether health documents are accepted (consent box below) or not yet */}
      {!e2e.on ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-health-notice">{t('compte:coffre.ajoutez_pas_documents_medicaux', 'N’ajoutez pas de documents médicaux (certificat, compte rendu, ordonnance, dossier MDPH avec éléments médicaux) : leur hébergement demande un hébergeur agréé pour les données de santé, qui n’est pas encore en place.')}</p>
        : !healthCategoryOffered(health.category) ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-health-notice">{t('compte:coffre_sante.not_yet', 'Les documents de santé (certificat médical, compte rendu, ordonnance, dossier MDPH avec éléments médicaux) ne sont pas encore acceptés dans Mon Coffre : n’en ajoutez pas pour le moment.')}</p> : null}
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-scan-notice">{t('compte:coffre.les_fichiers_sont_pas', 'Les fichiers ne sont pas encore analysés par un antivirus : n’ajoutez que des documents dont vous connaissez l’origine.')}</p>
      <div aria-live="polite" role="status" data-testid="coffre-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="coffre-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}

      {recoveryCode ? <RecoveryCodePanel code={recoveryCode} onDone={() => setRecoveryCode('')} /> : null}
      {!recoveryCode && e2e.on && !e2e.unlocked && recovering ? (
        <Card data-testid="coffre-recover">
          <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:recovery.forgot', 'J’ai oublié ma phrase secrète')}</CardTitle></CardHeader>
          <CardContent><VaultRecoveryForm busy={busy} onSubmit={recover} onCancel={() => setRecovering(false)} onProblem={setProblem} /></CardContent>
        </Card>
      ) : null}
      {!recoveryCode && e2e.on && !e2e.unlocked && !recovering ? (
        <Card data-testid={e2e.keyring ? 'coffre-unlock' : 'coffre-protect'}>
          <CardHeader><CardTitle as="h2" className="text-lg">{e2e.keyring ? t('compte:coffre.e2e_unlock_title', 'Ouvrir Mon Coffre') : t('compte:coffre.e2e_setup_title', 'Choisissez la phrase secrète de Mon Coffre')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={e2e.keyring ? unlock : protect}>
              <div><label htmlFor="cf-pass" className="block text-sm font-medium text-slate-800">{t('compte:coffre.e2e_passphrase', 'Phrase secrète ({{min}} caractères au moins)', { min: VAULT_PASSPHRASE_MIN })}</label>
                <input id="cf-pass" data-testid="coffre-passphrase" type="password" autoComplete={e2e.keyring ? 'current-password' : 'new-password'} className="mt-1 w-full rounded-md border border-slate-300 p-2" value={pass.a} onChange={(e) => setPass({ ...pass, a: e.target.value })} /></div>
              {e2e.keyring ? null : <div><label htmlFor="cf-pass2" className="block text-sm font-medium text-slate-800">{t('compte:coffre.e2e_passphrase_confirm', 'Confirmez la phrase secrète')}</label>
                <input id="cf-pass2" data-testid="coffre-passphrase-confirm" type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={pass.b} onChange={(e) => setPass({ ...pass, b: e.target.value })} /></div>}
              {e2e.keyring ? null : <p className="text-sm text-slate-700">{t('compte:recovery.setup_hint', 'Après cette étape, vous recevrez un code de secours à garder dans un endroit sûr.')}</p>}
              <div className="flex flex-wrap items-center gap-3"><Button type="submit" data-testid="coffre-passphrase-submit" disabled={busy}>{busy ? t('compte:coffre.e2e_working', 'Chiffrement en cours…') : e2e.keyring ? t('compte:coffre.e2e_unlock_submit', 'Ouvrir') : t('compte:coffre.e2e_setup_submit', 'Protéger Mon Coffre')}</Button>
                {e2e.keyring ? (e2e.keyring.recovery
                  ? <Button type="button" variant="link" onClick={() => { setProblem(''); setRecovering(true); }} data-testid="coffre-forgot">{t('compte:recovery.forgot', 'J’ai oublié ma phrase secrète')}</Button>
                  : <span className="text-sm text-slate-700" data-testid="coffre-no-recovery-code">{t('compte:recovery.no_recovery', 'Ce coffre n’a pas de code de secours : une phrase secrète oubliée ne peut pas être remplacée.')}</span>) : null}</div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {recoveryCode || (e2e.on && !e2e.unlocked) ? null : (<>

      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:coffre.ajouter_document', 'Ajouter un document')}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={upload}>
            <div className="sm:col-span-2"><label htmlFor="cf-file" className="block text-sm font-medium text-slate-800">{t('compte:coffre.fichier_pdf_png_jpeg', 'Fichier (PDF, PNG ou JPEG, 3 Mo au plus)')}</label><input id="cf-file" data-testid="coffre-file" ref={fileRef} type="file" accept={ACCEPT} className="mt-1 block w-full text-sm" /></div>
            <div><label htmlFor="cf-cat" className="block text-sm text-slate-800">{t('compte:coffre.categorie', 'Catégorie')}</label>
              <select id="cf-cat" data-testid="coffre-category" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((v) => <option key={v} value={v}>{COFFRE_CATEGORY_LABELS[v]}</option>)}</select></div>
            <div><label htmlFor="cf-exp" className="block text-sm text-slate-800">{t('compte:coffre.date_fin_validite_facultatif', 'Date de fin de validité (facultatif)')}</label><input id="cf-exp" data-testid="coffre-expires" type="date" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
            <div className="sm:col-span-2"><Button type="submit" data-testid="coffre-upload" disabled={busy}>{busy ? t('compte:coffre.sending', 'Envoi…') : t('compte:coffre.save_document', 'Enregistrer le document')}</Button></div>
          </form>
          {q ? <p className="mt-3 text-xs text-slate-700" data-testid="coffre-quota">{t('compte:coffre.quota', '{{files}} / {{maxFiles}} documents — {{used}} utilisés sur {{max}}', { files: q.files, maxFiles: q.maxFiles, used: formatBytes(q.bytes), max: formatBytes(q.maxBytes) })}</p> : null}
        </CardContent>
      </Card>

      {e2e.on && healthCategoryOffered(health.category) ? <VaultHealthConsent consent={health.consent === health.category.version ? health.consent : null} busy={busy}
        hasHealthDocuments={state.documents.some((d) => d.category === 'sante')} onGive={giveHealth} onWithdraw={withdrawHealth} /> : null}
      {e2e.on ? <VaultSecurityCard busy={busy} hasRecovery={Boolean(e2e.keyring?.recovery)} onChange={changePass} onRenew={renewCode} onProblem={setProblem} /> : null}
      {e2e.on ? <p className="text-sm" data-testid="coffre-dossiers-link"><Link className="text-blue-800 underline" to="/compte/dossiers-chiffres">{t('compte:coffre.e2e_dossiers_link', 'Mes dossiers partagés avec des structures (chiffrés)')}</Link></p> : null}
      <Card>
        <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:coffre.mes_documents', 'Mes documents')}</CardTitle></CardHeader>
        <CardContent>
          {state.documents.length ? (
            <ul className="space-y-2" data-testid="coffre-list">
              {state.documents.map((d) => (
                <li key={d.id} data-testid="coffre-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-slate-900">{d.name}</span> — {COFFRE_CATEGORY_LABELS[d.category]} — {formatBytes(d.byteLength)}
                    {d.expiresAt ? <span className={d.expired ? 'text-red-800' : 'text-slate-700'}> — {d.expired ? t('compte:coffre.expired_on', 'expiré le {{date}}', { date: formatDate(d.expiresAt) }) : t('compte:coffre.valid_until', 'valable jusqu’au {{date}}', { date: formatDate(d.expiresAt) })}</span> : null}
                  </span>
                  <span className="flex gap-2">
                    <Button asChild size="sm" variant="outline"><a href={citizenApi.coffreDownloadUrl(d.id)} onClick={(e) => { if (citizenApi.coffreViaHds()) { e.preventDefault(); download(d); } }} data-testid="coffre-download" aria-label={t('compte:coffre.download_named', 'Télécharger {{name}}', { name: d.name })}>{t('compte:coffre.telecharger', 'Télécharger')}</a></Button>
                    <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-800" data-testid="coffre-delete" aria-label={t('compte:coffre.delete_named', 'Supprimer {{name}}', { name: d.name })} onClick={() => remove(d)}>{t('compte:coffre.supprimer', 'Supprimer')}</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-700" data-testid="coffre-empty">{t('compte:coffre.aucun_document_pour_moment', 'Aucun document pour le moment.')}</p>}
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}
