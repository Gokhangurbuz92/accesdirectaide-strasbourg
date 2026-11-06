// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCsrfHeaders, csrfFetch } from '@/lib/csrf';
import { OWNER_HEADER } from '@/lib/shareOwner';
import { AlertTriangle, Check, Copy, Lock, Search, ShieldCheck, Trash2 } from 'lucide-react';
import i18n, { useT } from '@/i18n';
import { Trans } from 'react-i18next';
import { formatDateTime } from '@/i18n';

/**
 * CitizenSharingPanel - "Mon partage": four DISTINCT actions in plain language (never one ambiguous "revoke").
 *   1. Partager avec UNE structure vérifiée (invitation liée à cette structure, 72 h, une seule fois)
 *   2. Retirer l'accès d'UNE structure  /  annuler une invitation
 *   3. Arrêter de partager avec TOUT LE MONDE (les données restent chez vous)
 *   4. Demander la suppression de mes données (définitif)
 * Everything is authorized by the private OWNER secret; the panel never shows or logs it.  Tokens, grants and audit stay invisible to the citizen.
 * Props: shareId, ownerSecret, onErased()
 */
const messagesOf = (t) => ({
  404: t('messaging:sharing.err_404', 'Action impossible : ce dossier n\'est plus accessible (lien privé invalide ou dossier expiré).'),
  409: t('messaging:sharing.err_409', 'Ce dossier est déjà partagé avec cette structure.'),
  410: t('messaging:sharing.err_410', 'Ce dossier a expiré. Faites un nouveau diagnostic pour le partager.'),
  429: t('messaging:sharing.err_429', 'Trop d\'essais. Patientez quelques minutes, puis réessayez.'),
});
const fmt = (d) => formatDateTime(d, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default function CitizenSharingPanel({ shareId, ownerSecret, onErased }) {
  const { t } = useT('messaging');
  const MESSAGES = messagesOf(t);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState({ kind: 'info', text: '' });
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(null);       // { kind: 'revoke' | 'stop' | 'erase', structureId?, name? }
  const [busy, setBusy] = useState(false);
  const statusRef = useRef(null);

  const call = useCallback(async (action, extra = {}) => {
    try {
      // R12B: the first call of a page opened from a link (no CSRF cookie yet) obtains the cookie first instead of being refused 403
      const res = await csrfFetch('/api/public/dossier-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(ownerSecret ? { [OWNER_HEADER]: ownerSecret } : {}) },
        body: JSON.stringify({ shareId, action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }, [shareId, ownerSecret]);

  const say = (kind, text) => {
    setStatus({ kind, text });
    requestAnimationFrame(() => statusRef.current?.focus());
  };
  // R8: the server's own French reason when it gives one (the processing limitation is a 409 too: it is not « déjà partagé »; too many pending invitations)
  const fail = (r) => say('error', (['PROCESSING_RESTRICTED', 'too_many_invites'].includes(r.body?.error) && r.body?.message) || MESSAGES[r.status] || t('messaging:sharing.err_network', 'Connexion impossible. Rien n\'a été perdu : vous pouvez réessayer.'));

  const refresh = useCallback(async () => {
    const r = await call('list');
    if (r.ok) { setData(r.body); setLoadError(''); } else setLoadError(MESSAGES[r.status] || t('messaging:sharing.load_failed', 'Impossible de charger vos partages. Réessayez.'));
  }, [call]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time

  useEffect(() => { refresh(); }, [refresh]);

  // The citizen hands the invitation over and keeps this page open: when the organization redeems it, the invitation becomes an active access
  // (with its "retirer l'accès" control).  Without a refresh that control never appears and the citizen cannot withdraw it.  Refresh when the
  // tab regains focus and every 8 s while it is visible (read-only `list`, owner header, CSRF pair; never while an action is running).
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible' && !busyRef.current) refresh(); };
    const timer = setInterval(tick, 8000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [refresh]);

  // search (debounced); typing never loses the selection of an already chosen organization
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    setSearching(true);
    const timer = setTimeout(async () => {
      const r = await call('find_organizations', { q: q.trim() });
      setSearching(false);
      if (r.ok) setResults(r.body.organizations || []); else fail(r);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, call]);

  const sendInvite = async () => {
    setBusy(true);
    const r = await call('invite', { structureId: picked.id });
    setBusy(false);
    if (!r.ok) { fail(r); return; }
    setInvite({ ...r.body, organization: picked });
    setPicked(null); setQ(''); setResults([]);
    say('success', t('messaging:sharing.invite_ready_status', 'Invitation prête pour {{name}}. Remettez-lui le lien ou le QR code.', { name: r.body.organization?.nom || t('messaging:sharing.the_structure', 'la structure') }));
    refresh();
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${invite.proUrl}`); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { say('error', t('messaging:sharing.copy_failed', 'Copie impossible : sélectionnez le lien et copiez-le à la main.')); }
  };

  const run = async (action, extra, doneText) => {
    setBusy(true);
    const r = await call(action, extra);
    setBusy(false); setConfirm(null);
    if (!r.ok) { fail(r); return; }
    say('success', doneText);
    refresh();
  };

  const erase = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/public/dossier-revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ownerSecret ? { [OWNER_HEADER]: ownerSecret } : {}), ...getCsrfHeaders() }, body: JSON.stringify({ shareId }) });
      if (res.ok) { onErased?.(); return; }
      fail({ status: res.status });
    } catch { fail({ status: 0 }); } finally { setBusy(false); setConfirm(null); }
  };

  const active = (data?.grants || []).filter((g) => !g.revoked);
  const pending = (data?.invites || []).filter((i) => i.status === 'pending');

  return (
    <section aria-labelledby="mon-partage-title" className="space-y-4">
      <h2 id="mon-partage-title" className="text-base font-bold text-slate-900 flex items-center gap-2"><ShieldCheck size={16} aria-hidden="true" /> {t('messaging:sharing.title', 'Mon partage')}</h2>
      <p className="text-sm text-slate-600">{t('messaging:sharing.intro', 'Vous décidez qui peut voir votre dossier. Vous pouvez changer d\'avis à tout moment.')}</p>

      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="sharing-status"
        className={`rounded-lg p-3 text-sm outline-none ${status.text ? (status.kind === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200') : 'sr-only'}`}>
        {status.text}
      </div>
      {loadError && <p role="alert" data-testid="sharing-load-error" className="text-sm text-red-700">{loadError} <button type="button" className="underline" data-testid="sharing-retry" onClick={refresh}>{t('messaging:sharing.retry', 'Réessayer')}</button></p>}

      {/* R8: a dossier that could not be read offers no action (sharing, revoking or erasing an inaccessible dossier only fails) */}
      {loadError && !data ? null : <>
      {/* 1. share with ONE verified organization */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">{t('messaging:sharing.share_title', 'Partager avec une structure')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!picked && !invite && (
            <>
              <label htmlFor="org-search" className="block text-sm font-medium text-slate-800">{t('messaging:sharing.search_label', 'Nom ou ville de la structure (ex. « CCAS Strasbourg »)')}</label>
              <div className="flex items-center gap-2">
                <Search size={16} aria-hidden="true" className="text-slate-500" />
                <input id="org-search" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 min-h-[44px] rounded-md border border-slate-300 px-3 text-base" aria-describedby="org-search-help" />
              </div>
              <p id="org-search-help" className="text-xs text-slate-500">{t('messaging:sharing.search_help', 'Seules les structures vérifiées apparaissent. Tapez au moins 2 lettres.')}</p>
              <div aria-live="polite" className="text-xs text-slate-500">{searching ? t('messaging:sharing.searching', 'Recherche…') : (q.trim().length >= 2 && results.length === 0 ? t('messaging:sharing.no_result', 'Aucune structure vérifiée trouvée.') : '')}</div>
              {results.length > 0 && (
                <ul className="space-y-2" aria-label={t('messaging:sharing.results_label', 'Structures trouvées')}>
                  {results.map((o) => (
                    <li key={o.id}>
                      <button type="button" onClick={() => setPicked(o)} className="w-full min-h-[44px] text-left rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                        <span className="font-semibold text-slate-900">{o.nom}</span>
                        <span className="block text-xs text-slate-500">{[o.codePostal, o.ville].filter(Boolean).join(' ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {picked && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3" data-testid="share-summary">
              <h3 className="font-bold text-slate-900">{t('messaging:sharing.before_confirm', 'Avant de confirmer')}</h3>
              <dl className="text-sm text-slate-800 space-y-1">
                <div><dt className="inline font-semibold">{t('messaging:sharing.with_whom', 'Avec qui :')} </dt><dd className="inline">{picked.nom}{picked.ville ? ` (${picked.ville})` : ''}</dd></div>
                <div><dt className="inline font-semibold">{t('messaging:sharing.what', 'Ce qui est partagé :')} </dt><dd className="inline">{t('messaging:sharing.what_value', 'votre diagnostic (votre situation et vos droits estimés).')}</dd></div>
                <div><dt className="inline font-semibold">{t('messaging:sharing.why', 'Pourquoi :')} </dt><dd className="inline">{t('messaging:sharing.why_value', 'pour que cette structure puisse vous accompagner.')}</dd></div>
                <div><dt className="inline font-semibold">{t('messaging:sharing.how_long', 'Combien de temps :')} </dt><dd className="inline">{data?.expiresAt ? t('messaging:sharing.how_long_value_date', 'jusqu\'à l\'expiration du dossier ({{date}}), ou jusqu\'à ce que vous retiriez l\'accès.', { date: fmt(data.expiresAt) }) : t('messaging:sharing.how_long_value', 'jusqu\'à l\'expiration du dossier, ou jusqu\'à ce que vous retiriez l\'accès.')}</dd></div>
              </dl>
              <p className="text-xs text-slate-600"><Trans i18n={i18n} i18nKey="messaging:sharing.ai_not_included" defaults="L&apos;analyse automatisée par IA n&apos;est PAS incluse. Vous pourrez l&apos;autoriser séparément." /></p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setPicked(null)} disabled={busy}>{t('messaging:sharing.change', 'Changer')}</Button>
                <Button type="button" className="flex-1 min-h-[44px]" onClick={sendInvite} disabled={busy}>{busy ? t('messaging:sharing.wait', 'Un instant…') : t('messaging:sharing.confirm_share', 'Confirmer le partage')}</Button>
              </div>
            </div>
          )}

          {invite && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3" data-testid="invite-ready">
              <h3 className="font-bold text-slate-900">{t('messaging:sharing.invite_ready', 'Invitation prête pour {{name}}', { name: invite.organization?.nom })}</h3>
              <p className="text-sm text-slate-800">{invite.expiresAt ? t('messaging:sharing.invite_help_date', 'Remettez ce lien (ou ce QR code) à un professionnel de cette structure. Il ne fonctionne que pour elle, une seule fois, pendant 72 heures (jusqu’au {{date}}).', { date: fmt(invite.expiresAt) }) : t('messaging:sharing.invite_help', 'Remettez ce lien (ou ce QR code) à un professionnel de cette structure. Il ne fonctionne que pour elle, une seule fois, pendant 72 heures.')}</p>
              <div className="flex justify-center rounded-lg bg-white p-3"><QRCode value={`${window.location.origin}${invite.proUrl}`} size={144} level="M" /></div>
              <div className="flex items-center gap-2">
                <input readOnly aria-label={t('messaging:sharing.invite_link', 'Lien d\'invitation')} value={`${window.location.origin}${invite.proUrl}`} className="flex-1 min-h-[44px] rounded-md border border-slate-300 px-2 text-xs font-mono" onFocus={(e) => e.target.select()} />
                <Button type="button" variant="outline" className="min-h-[44px]" onClick={copyLink}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}<span className="ml-1">{copied ? t('messaging:sharing.copied', 'Copié') : t('messaging:sharing.copy', 'Copier')}</span></Button>
              </div>
              <p className="text-xs text-slate-600">{t('messaging:sharing.scan_hint', 'Accompagné(e) sur place (France Services, travailleur social) ? Le professionnel peut scanner ce code. Sur un appareil partagé, fermez cette page ensuite.')}</p>
              <Button type="button" variant="outline" className="w-full min-h-[44px]" onClick={() => setInvite(null)}>{t('messaging:sharing.done', 'J\'ai terminé')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. who has access / pending */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">{t('messaging:sharing.access_title', 'Qui a accès à mon dossier')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data && active.length === 0 && pending.length === 0 && <p className="text-sm text-slate-600">{t('messaging:sharing.nobody', 'Personne pour l\'instant.')}</p>}
          {active.map((g) => {
            const ai = g.purposes.includes('PURP-05'); const siao = g.purposes.includes('PURP-07');

            return (
              <div key={g.structureId} className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid="grant-row">
                <p className="font-semibold text-slate-900">{g.structureName} <span className="font-normal text-xs text-slate-500">· {t('messaging:sharing.since', 'depuis le {{date}}', { date: fmt(g.grantedAt) })}</span></p>
                <label className="flex items-start gap-2 text-sm text-slate-800 min-h-[44px]">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={ai} disabled={busy} onChange={(e) => run('set_purposes', { structureId: g.structureId, purposes: e.target.checked ? ['PURP-06', 'PURP-05'] : ['PURP-06'] }, e.target.checked ? t('messaging:sharing.ai_on', 'Analyse IA autorisée pour {{name}}.', { name: g.structureName }) : t('messaging:sharing.ai_off', 'Analyse IA retirée pour {{name}}.', { name: g.structureName }))} />
                  <span>{t('messaging:sharing.ai_label', 'Autoriser l\'analyse automatisée par IA de mon dossier pour cette structure (modèle exécuté par AccesDirectAide, aucun service externe ; le résumé reste un brouillon marqué « non relu » tant qu\'une personne de la structure ne l\'a pas relu)')}<span className="block text-xs text-slate-500">{t('messaging:sharing.off_by_default', 'Désactivé par défaut. Vous pouvez le retirer à tout moment.')}</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-800 min-h-[44px]">
                  <input type="checkbox" className="mt-1 h-5 w-5" data-testid="grant-siao" checked={siao} disabled={busy} onChange={(e) => run('set_siao', { structureId: g.structureId, siao: e.target.checked }, e.target.checked ? t('messaging:sharing.siao_on', 'Transmission au SIAO autorisée pour {{name}}.', { name: g.structureName }) : t('messaging:sharing.siao_off', 'Transmission au SIAO retirée pour {{name}}.', { name: g.structureName }))} />
                  <span>{t('messaging:sharing.siao_label', 'Autoriser cette structure à transmettre ma demande d\'hébergement au SIAO du Bas-Rhin (service intégré d\'accueil et d\'orientation)')}<span className="block text-xs text-slate-500">{t('messaging:sharing.siao_help', 'Désactivé par défaut. Seuls les éléments utiles à la demande sont transmis, sous un identifiant pseudonymisé. Vous pouvez le retirer à tout moment. La transmission n\'est pas encore ouverte : elle attend la convention avec l\'opérateur du SIAO.')}</span></span>
                </label>
                {confirm?.kind === 'revoke' && confirm.structureId === g.structureId ? (
                  <div role="group" aria-label={t('messaging:sharing.confirm_revoke', 'Confirmer le retrait de {{name}}', { name: g.structureName })} className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setConfirm(null)}>{t('messaging:sharing.keep_access', 'Garder l\'accès')}</Button>
                    <Button type="button" className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700" disabled={busy} onClick={() => run('revoke', { structureId: g.structureId }, t('messaging:sharing.revoked', 'L\'accès de {{name}} est retiré.', { name: g.structureName }))}>{t('messaging:sharing.yes_revoke', 'Oui, retirer l\'accès')}</Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="w-full min-h-[44px]" onClick={() => setConfirm({ kind: 'revoke', structureId: g.structureId })}><Trans i18n={i18n} i18nKey="messaging:sharing.revoke" defaults="Retirer l&apos;accès de cette structure" /></Button>
                )}
              </div>
            );
          })}
          {pending.map((i) => (
            <div key={i.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-2" data-testid="invite-row">
              <p className="text-sm text-slate-800">{t('messaging:sharing.pending', 'Invitation en attente :')} <strong>{i.structureName}</strong><span className="block text-xs text-slate-500">{t('messaging:sharing.expires', 'expire le {{date}}', { date: fmt(i.expiresAt) })}</span></p>
              <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => run('revoke_invite', { inviteId: i.id }, t('messaging:sharing.invite_cancelled', 'Invitation annulée.'))}>{t('messaging:sharing.cancel', 'Annuler')}</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 3. stop sharing */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-bold flex items-center gap-2"><Lock size={14} aria-hidden="true" /> {t('messaging:sharing.stop_title', 'Arrêter de partager')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-slate-700">{t('messaging:sharing.stop_text', 'Plus personne n\'a accès et les liens ne marchent plus. Vos données restent conservées chez vous.')}</p>
          {confirm?.kind === 'stop' ? (
            <div role="group" aria-label={t('messaging:sharing.confirm_stop', 'Confirmer l\'arrêt du partage')} className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setConfirm(null)}>{t('messaging:sharing.cancel', 'Annuler')}</Button>
              <Button type="button" className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700" disabled={busy} onClick={() => run('stop_sharing', {}, t('messaging:sharing.stopped', 'Le partage est arrêté. Plus personne n\'a accès.'))}>{t('messaging:sharing.yes_stop', 'Oui, arrêter le partage')}</Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full min-h-[44px]" onClick={() => setConfirm({ kind: 'stop' })}>{t('messaging:sharing.stop_all', 'Arrêter de partager avec tout le monde')}</Button>
          )}
        </CardContent>
      </Card>

      {/* 4. erasure */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-bold flex items-center gap-2"><Trash2 size={14} aria-hidden="true" /> {t('messaging:sharing.erase_title', 'Supprimer mes données')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-slate-700">{t('messaging:sharing.erase_text', 'Supprime définitivement ce dossier partagé (situation, résultats, messages, documents). Certaines traces techniques (journal d\'accès) peuvent être conservées pour respecter la loi. Cette action ne peut pas être annulée.')}</p>
          {confirm?.kind === 'erase' ? (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl space-y-3" role="group" aria-label={t('messaging:sharing.confirm_erase', 'Confirmer la suppression')}>
              <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5"><AlertTriangle size={14} aria-hidden="true" /> {t('messaging:sharing.erase_warning', 'Vous allez tout supprimer.')}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setConfirm(null)}>{t('messaging:sharing.no_keep', 'Non, garder')}</Button>
                <Button type="button" className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700" disabled={busy} onClick={erase}>{t('messaging:sharing.yes_erase', 'Oui, tout supprimer')}</Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full min-h-[44px] text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirm({ kind: 'erase' })}>{t('messaging:sharing.erase_title', 'Supprimer mes données')}</Button>
          )}
        </CardContent>
      </Card>
      </>}
    </section>
  );
}
