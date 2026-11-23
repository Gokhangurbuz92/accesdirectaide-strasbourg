// @ts-nocheck
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { formatDate, useT } from '@/i18n';
import { passeportLocalEnabled } from '@/lib/passeport/flag';
import { ACCEPTED_TYPES, AUTO_LOCK_MS, HIDDEN_LOCK_MS, MAX_DOC_BYTES, PACKAGE_EXTENSION, createVault, indexedDbBackend } from '@/lib/passeport/vault';
import { NOTE_MAX, SUMMARY_FIELDS, cleanSummary } from '@/lib/passeport/summary';

/**
 * G14-PS — Passeport Social (/passeport-social), LOCAL-FIRST. The person's documents and situation summary are encrypted in this browser with a key derived
 * from their passphrase and stored ONLY on this device (src/lib/passeport/vault.js). This page makes no request with them: AccesDirectAide never receives,
 * stores or can read them — so nothing is hosted, and no health-data hosting (HDS) applies. Sharing never goes through ADA: show on screen, an encrypted
 * .adapass file opened with a separate one-time code, or a plain PDF summary the person chooses to give. Locks itself after 5 minutes without activity.
 */

const card = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const h2 = 'text-lg font-semibold text-slate-900';
const input = 'mt-1 block w-full rounded-md border border-slate-400 px-3 py-2 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary';

function useLabels(t) {
  return useMemo(() => ({
    fields: {
      household: t('passeport:field.household', 'Composition du foyer'), children: t('passeport:field.children', 'Enfants à charge'),
      housing: t('passeport:field.housing', 'Logement'), work: t('passeport:field.work', 'Activité'), resources: t('passeport:field.resources', 'Ressources'),
      ongoing: t('passeport:field.ongoing', 'Démarches en cours'), languages: t('passeport:field.languages', 'Langues parlées'), contact: t('passeport:field.contact', 'Comment me joindre'),
    },
    options: {
      household: { alone: t('passeport:opt.household.alone', 'Seul ou seule'), couple: t('passeport:opt.household.couple', 'En couple'), single_parent: t('passeport:opt.household.single_parent', 'Parent seul avec enfants'),
        couple_children: t('passeport:opt.household.couple_children', 'En couple avec enfants'), hosted_by_family: t('passeport:opt.household.hosted_by_family', 'Chez de la famille'), other: t('passeport:opt.other', 'Autre') },
      children: { 0: t('passeport:opt.children.0', 'Aucun'), 1: '1', 2: '2', 3: '3', '4_plus': t('passeport:opt.children.4_plus', '4 ou plus') },
      housing: { tenant_private: t('passeport:opt.housing.tenant_private', 'Locataire (privé)'), tenant_social: t('passeport:opt.housing.tenant_social', 'Locataire (HLM)'),
        owner: t('passeport:opt.housing.owner', 'Propriétaire'), hosted: t('passeport:opt.housing.hosted', 'Hébergé ou hébergée'), other: t('passeport:opt.other', 'Autre') },
      work: { employed: t('passeport:opt.work.employed', 'Salarié ou salariée'), job_seeker: t('passeport:opt.work.job_seeker', 'En recherche d’emploi'), training: t('passeport:opt.work.training', 'En formation'),
        student: t('passeport:opt.work.student', 'Étudiant ou étudiante'), retired: t('passeport:opt.work.retired', 'Retraité ou retraitée'), no_activity: t('passeport:opt.work.no_activity', 'Sans activité') },
      resources: { salary: t('passeport:opt.resources.salary', 'Salaire'), unemployment_benefit: t('passeport:opt.resources.unemployment_benefit', 'Allocation chômage'), rsa: t('passeport:opt.resources.rsa', 'RSA'),
        activity_bonus: t('passeport:opt.resources.activity_bonus', 'Prime d’activité'), housing_benefit: t('passeport:opt.resources.housing_benefit', 'Aide au logement (APL)'),
        family_benefit: t('passeport:opt.resources.family_benefit', 'Allocations familiales'), pension: t('passeport:opt.resources.pension', 'Retraite'), scholarship: t('passeport:opt.resources.scholarship', 'Bourse'), none: t('passeport:opt.resources.none', 'Aucune ressource') },
      ongoing: { caf: t('passeport:opt.ongoing.caf', 'Dossier Caf'), france_travail: t('passeport:opt.ongoing.france_travail', 'Inscription France Travail'), social_housing_request: t('passeport:opt.ongoing.social_housing_request', 'Demande de logement social'),
        energy_help: t('passeport:opt.ongoing.energy_help', 'Aide pour l’énergie'), tax: t('passeport:opt.ongoing.tax', 'Impôts'), identity_documents: t('passeport:opt.ongoing.identity_documents', 'Carte d’identité ou passeport'),
        school: t('passeport:opt.ongoing.school', 'École ou cantine'), pension_request: t('passeport:opt.ongoing.pension_request', 'Demande de retraite'), bank_account: t('passeport:opt.ongoing.bank_account', 'Compte bancaire') },
      languages: { fr: 'Français', en: 'English', ar: 'العربية', tr: 'Türkçe', de: 'Deutsch', uk: 'Українська', other: t('passeport:opt.other', 'Autre') },
      contact: { phone: t('passeport:opt.contact.phone', 'Téléphone'), sms: t('passeport:opt.contact.sms', 'SMS'), email: t('passeport:opt.contact.email', 'E-mail'), in_person: t('passeport:opt.contact.in_person', 'Sur place') },
    },
  }), [t]);
}

const errorText = (t, code) => ({
  TOO_SHORT: t('passeport:err.too_short', 'La phrase secrète doit avoir au moins 10 caractères.'),
  MISMATCH: t('passeport:err.mismatch', 'Les deux phrases secrètes ne sont pas pareilles.'),
  WRONG: t('passeport:err.wrong', 'Phrase secrète incorrecte. Rien n’a été ouvert.'),
  TYPE: t('passeport:err.type', 'Ce type de fichier n’est pas accepté (PDF, JPG, PNG ou WEBP).'),
  SIZE: t('passeport:err.size', 'Le fichier est vide ou trop lourd (10 Mo au plus).'),
  COUNT: t('passeport:err.count', 'Vous avez déjà 60 documents. Supprimez-en un d’abord.'),
  BAD_PACKAGE: t('passeport:err.bad_package', 'Ce fichier n’est pas un passeport social.'),
  BAD_CODE: t('passeport:err.bad_code', 'Code incorrect. Vérifiez le code de 20 caractères.'),
  NO_INDEXEDDB: t('passeport:err.no_storage', 'Votre navigateur ne permet pas d’enregistrer sur cet appareil (navigation privée ?).'),
}[code] || t('passeport:err.generic', 'Une erreur est survenue. Rien n’a été envoyé.'));

const download = (bytes, name, type) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export default function PasseportSocial() {
  const { t } = useT('passeport');
  const L = useLabels(t);
  const enabled = passeportLocalEnabled();
  const vault = useMemo(() => createVault(indexedDbBackend()), []);
  const [phase, setPhase] = useState('loading');   // loading | none | locked | open
  const [problem, setProblem] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState([]); const [summary, setSummary] = useState(cleanSummary({}));
  const [show, setShow] = useState(null);   // { url, name, type } | 'summary'
  const [exported, setExported] = useState(null);
  const ids = { p1: useId(), p2: useId(), unlock: useId(), file: useId(), imp: useId(), code: useId(), note: useId() };
  const fail = (e) => setProblem(errorText(t, e?.code));
  const closeRef = useRef(null);
  useEffect(() => { if (show) closeRef.current?.focus(); }, [show]);   // the « show on screen » view takes the focus (Escape closes it)
  useEffect(() => { if (!show) return undefined; const k = (e) => { if (e.key === 'Escape') setShow(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [show]);

  useEffect(() => {
    if (!enabled) return;
    vault.exists().then((x) => setPhase(x ? 'locked' : 'none')).catch((e) => { setPhase('none'); fail(e); });
  }, [enabled, vault]);   // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => { setDocs(await vault.listDocuments()); setSummary(cleanSummary((await vault.getSummary()) || {})); }, [vault]);
  const lock = useCallback(() => { vault.lock(); setDocs([]); setSummary(cleanSummary({})); setShow(null); setExported(null); setPhase((p) => (p === 'open' ? 'locked' : p)); }, [vault]);

  // auto-lock: 5 minutes without activity, or the page hidden for more than a minute
  const timer = useRef(null); const hiddenAt = useRef(0);
  useEffect(() => {
    if (phase !== 'open') return undefined;
    const arm = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { lock(); setMessage(t('passeport:msg.auto_locked', 'Le passeport s’est verrouillé après 5 minutes sans activité.')); }, AUTO_LOCK_MS); };
    const onVis = () => { if (document.hidden) hiddenAt.current = Date.now(); else if (hiddenAt.current && Date.now() - hiddenAt.current > HIDDEN_LOCK_MS) lock(); };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true })); document.addEventListener('visibilitychange', onVis); arm();
    return () => { clearTimeout(timer.current); evs.forEach((e) => window.removeEventListener(e, arm)); document.removeEventListener('visibilitychange', onVis); };
  }, [phase, lock, t]);

  const run = async (fn) => { setBusy(true); setProblem(''); setMessage(''); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); } };

  if (!enabled) {
    return (
      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-8" data-testid="passeport-closed">
        <SEO title={t('passeport:title', 'Mon passeport social')} noindex />
        <h1 className="text-2xl font-bold text-slate-900">{t('passeport:title', 'Mon passeport social')}</h1>
        <p className="text-slate-700">{t('passeport:closed', 'Cette fonction n’est pas encore ouverte.')}</p>
      </div>
    );
  }

  const create = (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const a = String(f.get('p1') || ''); const b = String(f.get('p2') || '');
    if (a !== b) { setProblem(errorText(t, 'MISMATCH')); return; }
    run(async () => { await vault.create(a); await refresh(); setPhase('open'); setMessage(t('passeport:msg.created', 'Votre passeport est créé. Il est seulement sur cet appareil.')); }); };
  const unlock = (e) => { e.preventDefault(); const p = String(new FormData(e.currentTarget).get('pass') || '');
    run(async () => { if (!(await vault.unlock(p))) { setProblem(errorText(t, 'WRONG')); return; } await refresh(); setPhase('open'); }); };
  const addFiles = (e) => { const files = [...(e.target.files || [])]; e.target.value = '';
    run(async () => { for (const f of files) await vault.addDocument({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }); await refresh(); setMessage(t('passeport:msg.added', 'Document ajouté et chiffré sur cet appareil.')); }); };
  const view = (d) => run(async () => { const full = await vault.getDocument(d.id); if (full) setShow({ url: URL.createObjectURL(new Blob([full.bytes], { type: full.type })), name: full.name, type: full.type }); });
  const closeShow = () => { if (show && show.url) URL.revokeObjectURL(show.url); setShow(null); };
  const remove = (d) => { if (!window.confirm(t('passeport:confirm.delete_doc', 'Supprimer ce document de cet appareil ?'))) return; run(async () => { await vault.deleteDocument(d.id); await refresh(); }); };
  const saveSummary = (e) => { e.preventDefault(); run(async () => { await vault.saveSummary(cleanSummary(summary)); setMessage(t('passeport:msg.saved', 'Votre situation est enregistrée sur cet appareil.')); }); };
  const toggle = (k, o) => setSummary((s) => ({ ...s, [k]: s[k].includes(o) ? s[k].filter((x) => x !== o) : [...s[k], o] }));
  const exportPkg = () => run(async () => { const p = await vault.exportPackage(); download(p.bytes, p.fileName, 'application/octet-stream'); setExported({ code: p.code, fileName: p.fileName }); });
  const importPkg = (e) => { e.preventDefault(); const form = e.currentTarget; const file = form.elements.namedItem('pkg').files?.[0]; const code = String(new FormData(form).get('code') || '');
    if (!file) return; run(async () => { const r = await vault.importPackage(new Uint8Array(await file.arrayBuffer()), code); await refresh(); form.reset(); setMessage(t('passeport:msg.imported', '{{n}} document(s) importé(s).', { n: r.documents })); }); };
  const pdf = () => run(async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF(); let y = 18;
    const line = (s, size = 11) => { doc.setFontSize(size); for (const part of doc.splitTextToSize(s, 180)) { if (y > 280) { doc.addPage(); y = 18; } doc.text(part, 15, y); y += size * 0.55; } y += 2; };
    line(t('passeport:title', 'Mon passeport social'), 16);
    line(t('passeport:pdf.intro', 'Résumé donné par la personne elle-même. Il n’a pas été vérifié par AccesDirectAide.'), 9);
    for (const [k, def] of Object.entries(SUMMARY_FIELDS)) {
      const v = summary[k]; const vals = def.multi ? v : (v ? [v] : []);
      if (vals.length) line(`${L.fields[k]} : ${vals.map((o) => L.options[k][o] || o).join(', ')}`);
    }
    download(new Uint8Array(doc.output('arraybuffer')), `resume-passeport-social-${new Date().toISOString().slice(0, 10)}.pdf`, 'application/pdf');
    setMessage(t('passeport:msg.pdf', 'Le résumé PDF est sur votre appareil. Votre note personnelle n’y est pas.'));
  });
  const wipe = () => { if (!window.confirm(t('passeport:confirm.wipe', 'Tout effacer de cet appareil ? Sans fichier de sauvegarde, rien ne pourra être récupéré.'))) return;
    run(async () => { await vault.deleteAll(); setDocs([]); setSummary(cleanSummary({})); setExported(null); setPhase('none'); setMessage(t('passeport:msg.wiped', 'Tout est effacé de cet appareil.')); }); };

  const status = (
    <>
      {problem ? <p role="alert" data-testid="passeport-problem" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      <div role="status" aria-live="polite">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
    </>
  );

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="passeport-social">
      <SEO title={t('passeport:title', 'Mon passeport social')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('passeport:title', 'Mon passeport social')}</h1>
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-slate-800" data-testid="passeport-local-notice">
        <p className="font-semibold">{t('passeport:local.title', 'Vos papiers restent sur votre appareil.')}</p>
        <ul className="ms-5 list-disc space-y-1 text-sm">
          <li>{t('passeport:local.1', 'Vos documents sont chiffrés avec votre phrase secrète.')}</li>
          <li>{t('passeport:local.2', 'Rien n’est envoyé à AccesDirectAide. Nous ne pouvons pas lire vos documents.')}</li>
          <li>{t('passeport:local.3', 'Si vous perdez votre téléphone ou votre phrase secrète, vos documents sont perdus. Faites une sauvegarde.')}</li>
        </ul>
      </div>
      {status}
      {phase === 'loading' ? <p role="status">{t('passeport:loading', 'Chargement…')}</p> : null}

      {phase === 'none' ? (
        <section className={card} aria-labelledby="ps-create">
          <h2 id="ps-create" className={h2}>{t('passeport:create.title', 'Créer mon passeport sur cet appareil')}</h2>
          <p className="text-sm text-slate-700">{t('passeport:create.help', 'Choisissez une phrase secrète d’au moins 10 caractères. Notez-la dans un endroit sûr : personne ne peut la retrouver pour vous.')}</p>
          <form onSubmit={create} className="space-y-3">
            <div><label htmlFor={ids.p1} className="font-medium text-slate-900">{t('passeport:create.pass', 'Phrase secrète')}</label>
              <input id={ids.p1} name="p1" type="password" autoComplete="new-password" minLength={10} required className={input} /></div>
            <div><label htmlFor={ids.p2} className="font-medium text-slate-900">{t('passeport:create.pass2', 'Écrivez-la encore une fois')}</label>
              <input id={ids.p2} name="p2" type="password" autoComplete="new-password" minLength={10} required className={input} /></div>
            <Button type="submit" disabled={busy}>{t('passeport:create.submit', 'Créer mon passeport')}</Button>
          </form>
        </section>
      ) : null}

      {phase === 'locked' ? (
        <section className={card} aria-labelledby="ps-unlock">
          <h2 id="ps-unlock" className={h2}>{t('passeport:unlock.title', 'Ouvrir mon passeport')}</h2>
          <form onSubmit={unlock} className="space-y-3">
            <div><label htmlFor={ids.unlock} className="font-medium text-slate-900">{t('passeport:create.pass', 'Phrase secrète')}</label>
              <input id={ids.unlock} name="pass" type="password" autoComplete="current-password" required className={input} /></div>
            <Button type="submit" disabled={busy}>{t('passeport:unlock.submit', 'Ouvrir')}</Button>
          </form>
          <Button type="button" variant="outline" onClick={wipe} disabled={busy}>{t('passeport:wipe.button', 'Tout effacer de cet appareil')}</Button>
        </section>
      ) : null}

      {phase === 'open' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { lock(); setMessage(t('passeport:msg.locked', 'Passeport verrouillé.')); }}>{t('passeport:lock', 'Verrouiller maintenant')}</Button>
            <Button type="button" variant="outline" onClick={() => setShow('summary')}>{t('passeport:show.summary', 'Montrer ma situation à l’écran')}</Button>
          </div>

          <section className={card} aria-labelledby="ps-docs">
            <h2 id="ps-docs" className={h2}>{t('passeport:docs.title', 'Mes documents')}</h2>
            <div>
              <label htmlFor={ids.file} className="font-medium text-slate-900">{t('passeport:docs.add', 'Ajouter un document (PDF ou photo, 10 Mo au plus)')}</label>
              <input id={ids.file} type="file" accept={ACCEPTED_TYPES.join(',')} multiple onChange={addFiles} disabled={busy} className="mt-1 block text-base" data-max-bytes={MAX_DOC_BYTES} />
            </div>
            {docs.length ? (
              <ul className="divide-y divide-slate-200" data-testid="passeport-docs">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="break-all text-slate-900">{d.name} <span className="text-sm text-slate-600">· {formatDate(d.addedAt)}</span></span>
                    <span className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => view(d)} aria-label={t('passeport:docs.show_named', 'Montrer {{name}} à l’écran', { name: d.name })}>{t('passeport:docs.show', 'Montrer')}</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => remove(d)} aria-label={t('passeport:docs.delete_named', 'Supprimer {{name}}', { name: d.name })}>{t('passeport:docs.delete', 'Supprimer')}</Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-700">{t('passeport:docs.empty', 'Aucun document pour le moment.')}</p>}
          </section>

          <section className={card} aria-labelledby="ps-sit">
            <h2 id="ps-sit" className={h2}>{t('passeport:summary.title', 'Ma situation')}</h2>
            <p className="text-sm text-slate-700">{t('passeport:summary.help', 'Choisissez dans les listes. Ce résumé aide un professionnel à comprendre votre situation plus vite.')}</p>
            <form onSubmit={saveSummary} className="space-y-4">
              {Object.entries(SUMMARY_FIELDS).map(([k, def]) => (
                <fieldset key={k} className="space-y-1">
                  <legend className="font-medium text-slate-900">{L.fields[k]}</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {def.options.map((o) => (
                      <label key={o} className="inline-flex items-center gap-2 text-slate-800">
                        {def.multi
                          ? <input type="checkbox" checked={summary[k].includes(o)} onChange={() => toggle(k, o)} />
                          : <input type="radio" name={`ps-${k}`} checked={summary[k] === o} onChange={() => setSummary((s) => ({ ...s, [k]: o }))} />}
                        {L.options[k][o] || o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div>
                <label htmlFor={ids.note} className="font-medium text-slate-900">{t('passeport:summary.note', 'Ma note personnelle (reste sur cet appareil)')}</label>
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" id={`${ids.note}-w`} data-testid="passeport-health-warning">
                  {t('passeport:summary.note_warning', 'Ne mettez pas d’informations de santé si vous partagez votre passeport.')}</p>
                <textarea id={ids.note} aria-describedby={`${ids.note}-w`} maxLength={NOTE_MAX} rows={3} value={summary.note} onChange={(e) => setSummary((s) => ({ ...s, note: e.target.value }))} className={input} />
              </div>
              <Button type="submit" disabled={busy}>{t('passeport:summary.save', 'Enregistrer ma situation')}</Button>
            </form>
          </section>

          <section className={card} aria-labelledby="ps-share">
            <h2 id="ps-share" className={h2}>{t('passeport:share.title', 'Partager (sans passer par AccesDirectAide)')}</h2>
            <ul className="ms-5 list-disc space-y-1 text-sm text-slate-700">
              <li>{t('passeport:share.screen', 'Montrer à l’écran : le professionnel regarde votre écran, rien n’est envoyé.')}</li>
              <li>{t('passeport:share.file', 'Fichier chiffré .adapass : il s’ouvre seulement avec un code de 20 caractères. Donnez le code séparément.')}</li>
              <li>{t('passeport:share.pdf', 'Résumé PDF : un fichier simple, sans vos documents ni votre note. Vous choisissez à qui le donner.')}</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={exportPkg} disabled={busy}>{t('passeport:share.export', 'Créer le fichier chiffré')}</Button>
              <Button type="button" variant="outline" onClick={pdf} disabled={busy}>{t('passeport:share.pdf_button', 'Télécharger le résumé PDF')}</Button>
            </div>
            {exported ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="passeport-export-code">
                <p>{t('passeport:share.code_intro', 'Code pour ouvrir {{file}} (il ne sera plus affiché) :', { file: exported.fileName })}</p>
                <p className="font-mono text-xl tracking-wider" dir="ltr">{exported.code}</p>
                <p className="text-sm">{t('passeport:share.code_keep', 'Notez ce code. Ne l’envoyez pas avec le fichier.')}</p>
              </div>
            ) : null}
          </section>

          <section className={card} aria-labelledby="ps-backup">
            <h2 id="ps-backup" className={h2}>{t('passeport:backup.title', 'Sauvegarde, autre appareil et suppression')}</h2>
            <p className="text-sm text-slate-700">{t('passeport:backup.help', 'Il n’y a pas de copie ailleurs. Pour ne rien perdre : créez le fichier chiffré, gardez-le sur une clé USB ou un autre appareil, et notez le code sur papier.')}</p>
            <form onSubmit={importPkg} className="space-y-3">
              <div><label htmlFor={ids.imp} className="font-medium text-slate-900">{t('passeport:backup.import_file', 'Fichier .adapass à importer')}</label>
                <input id={ids.imp} name="pkg" type="file" accept={PACKAGE_EXTENSION} required className="mt-1 block text-base" /></div>
              <div><label htmlFor={ids.code} className="font-medium text-slate-900">{t('passeport:backup.import_code', 'Code de 20 caractères')}</label>
                <input id={ids.code} name="code" type="text" autoComplete="off" spellCheck={false} required className={input} dir="ltr" /></div>
              <Button type="submit" variant="outline" disabled={busy}>{t('passeport:backup.import', 'Importer')}</Button>
            </form>
            <Button type="button" variant="destructive" onClick={wipe} disabled={busy}>{t('passeport:wipe.button', 'Tout effacer de cet appareil')}</Button>
          </section>
        </>
      ) : null}

      {show ? (
        <div role="dialog" aria-modal="true" aria-labelledby="ps-show-title" className="fixed inset-0 z-50 overflow-auto bg-white p-4" data-testid="passeport-show">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="ps-show-title" className={h2}>{show === 'summary' ? t('passeport:summary.title', 'Ma situation') : show.name}</h2>
              <Button type="button" onClick={closeShow} ref={closeRef}>{t('passeport:show.close', 'Fermer')}</Button>
            </div>
            {show === 'summary' ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {Object.entries(SUMMARY_FIELDS).map(([k, def]) => {
                  const v = summary[k]; const vals = def.multi ? v : (v ? [v] : []);
                  return <div key={k}><dt className="font-medium text-slate-900">{L.fields[k]}</dt><dd className="text-slate-800">{vals.length ? vals.map((o) => L.options[k][o] || o).join(', ') : '—'}</dd></div>;
                })}
              </dl>
            ) : show.type === 'application/pdf'
              ? <object data={show.url} type="application/pdf" className="h-[75vh] w-full" aria-label={show.name}><p>{show.name}</p></object>
              : <img src={show.url} alt={show.name} className="max-h-[80vh] w-auto" />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
