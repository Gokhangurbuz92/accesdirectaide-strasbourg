// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { AGE_BANDS } from '@/lib/ageBandOptions';
import { applyAccountAccessibility } from '@/lib/accountAccessibility';
import DevicePush from '@/components/DevicePush';

// launch-readiness item 59 / R11 (N04): no « push » column in the table — notifications on this device have their own card (DevicePush: the browser's permission and subscription)
// R12 (C20): no « Dans l’application » column — no in-app inbox exists for citizens, so that choice did nothing
const CHANNELS = [['email', 'E-mail'], ['sms', 'SMS']];
const CATEGORIES = [['service', 'Service (rendez-vous, messages)'], ['reminder', 'Rappels'], ['marketing', 'Informations et nouveautés (facultatif)']];
const RELATIONS = [['partner', 'Conjoint·e / partenaire'], ['child', 'Enfant'], ['parent', 'Parent'], ['sibling', 'Frère / sœur'], ['other', 'Autre personne du foyer']];
const NEEDS_CONSENT = (channel, category) => category === 'marketing' || channel === 'sms' || channel === 'push';
const relationLabel = (v) => (RELATIONS.find((r) => r[0] === v) || [v, v])[1];
const bandLabel = (v) => (AGE_BANDS.find((b) => b[0] === v) || [v, 'Non précisé'])[1];

/**
 * PKG-1 / K0 — "Mon profil": the account profile (age BAND, never a birth date), household, server-enforced notification preferences, and the dossiers attached to the account.
 * Route: /compte/profil (cookie session). Every change is saved on the server; SMS, push and every optional-information channel need an explicit, separate consent.
 */
export default function CompteProfil() {
  const [state, setState] = useState({ loading: true, error: '', account: null });
  const [shares, setShares] = useState([]);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ displayName: '', ageBand: '', departement: '', prefillConsent: false, falc: false, highContrast: false, textScale: 'normal' });
  const [member, setMember] = useState({ relation: 'partner', ageBand: '', label: '' });
  const [claim, setClaim] = useState({ shareId: '', ownerSecret: '' });
  const [consents, setConsents] = useState({});
  const [pendingPrefs, setPendingPrefs] = useState({});   // { 'sms.service': true } while the server has not answered for that option

  const load = useCallback(async () => {
    setState((s) => (s.account ? s : { ...s, loading: true, error: '' }));   // a refresh after an action keeps the screen (and the keyboard focus) in place
    try {
      const account = await citizenApi.getProfile();
      const owned = await citizenApi.listShares();
      setShares(owned.shares || []);
      const p = account.profile;
      applyAccountAccessibility(p.accessibilityPrefs);   // K0 / C04: the saved preferences apply to the whole site, not only to this form
      setForm({ displayName: p.displayName || '', ageBand: p.ageBand || '', departement: p.departement || '', prefillConsent: Boolean(p.prefillConsent), falc: Boolean(p.accessibilityPrefs?.falc), highContrast: Boolean(p.accessibilityPrefs?.highContrast), textScale: p.accessibilityPrefs?.textScale || 'normal' });
      setState({ loading: false, error: '', account });
    } catch (err) {
      setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour accéder à votre profil.' : err.message, account: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, okMessage) => {
    setMessage(''); setProblem('');
    try { await fn(); if (okMessage) setMessage(okMessage); await load(); } catch (err) { setProblem(err.message); }
  };

  const saveProfile = (e) => {
    e.preventDefault();
    return run(() => citizenApi.saveProfile({
      displayName: form.displayName.trim() || null, ageBand: form.ageBand || null, departement: form.departement.trim() || null, prefillConsent: form.prefillConsent,
      accessibilityPrefs: { falc: form.falc, highContrast: form.highContrast, textScale: form.textScale },
    }), 'Profil enregistré.');
  };

  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">Chargement de votre profil…</div>;
  if (state.error || !state.account) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8" data-testid="compte-profil-error">
        <SEO title="Mon profil" noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Mon profil</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error || 'Profil indisponible.'}</p>
        <div className="mt-4 flex gap-3">
          <Button onClick={load} data-testid="profil-retry">Réessayer</Button>
          <Button asChild variant="outline"><Link to="/login">Se connecter</Link></Button>
        </div>
      </div>
    );
  }
  const { account } = state;
  const prefs = account.preferences;
  const pending = account.agePolicy && !account.agePolicy.allowed;

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-profil">
      <SEO title="Mon profil" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mon profil</h1>
      <p className="text-sm text-slate-700">Ces informations restent facultatives. Elles servent uniquement à votre confort et, si vous l’acceptez, à préremplir vos démarches. Vous pouvez les modifier ou les effacer à tout moment depuis <Link className="underline" to="/compte/parametres">vos paramètres</Link>.</p>

      <div aria-live="polite" role="status" data-testid="profil-status">{message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{message}</p> : null}</div>
      {problem ? <p role="alert" data-testid="profil-error" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{problem}</p> : null}
      {pending ? (
        <p data-testid="age-policy-notice" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
          Les informations publiques restent accessibles à tout âge. Pour les personnes de moins de 18 ans, certaines fonctions du compte (partage de dossier, foyer, SMS) sont suspendues
          tant que le cadre de consentement n’est pas validé juridiquement. Votre tranche d’âge est déclarative et n’est pas vérifiée.
        </p>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-lg">Informations personnelles</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div>
              <label htmlFor="pf-name" className="block text-sm font-medium text-slate-800">Nom affiché (facultatif)</label>
              <input id="pf-name" data-testid="pf-name" className="mt-1 w-full rounded-md border border-slate-300 p-2" maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </div>
            <div>
              <label htmlFor="pf-band" className="block text-sm font-medium text-slate-800">Tranche d’âge (déclarative, facultative)</label>
              <select id="pf-band" data-testid="pf-band" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={form.ageBand} onChange={(e) => setForm({ ...form, ageBand: e.target.value })}>
                <option value="">Je ne souhaite pas le préciser</option>
                {AGE_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pf-dep" className="block text-sm font-medium text-slate-800">Département (facultatif)</label>
              <input id="pf-dep" data-testid="pf-dep" className="mt-1 w-32 rounded-md border border-slate-300 p-2" inputMode="text" maxLength={3} placeholder="67" value={form.departement} onChange={(e) => setForm({ ...form, departement: e.target.value.toUpperCase() })} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Accessibilité</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="pf-falc" checked={form.falc} onChange={(e) => setForm({ ...form, falc: e.target.checked })} /> Préférer les textes en français facile (FALC)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="pf-contrast" checked={form.highContrast} onChange={(e) => setForm({ ...form, highContrast: e.target.checked })} /> Contraste renforcé</label>
              <div>
                <label htmlFor="pf-scale" className="block text-sm text-slate-800">Taille du texte</label>
                <select id="pf-scale" data-testid="pf-scale" className="mt-1 rounded-md border border-slate-300 p-2" value={form.textScale} onChange={(e) => setForm({ ...form, textScale: e.target.value })}>
                  <option value="normal">Normale</option><option value="large">Grande</option><option value="xlarge">Très grande</option>
                </select>
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" data-testid="pf-prefill" className="mt-1" checked={form.prefillConsent} onChange={(e) => setForm({ ...form, prefillConsent: e.target.checked })} />
              <span>J’accepte que ces informations préremplissent mes démarches (je peux retirer mon accord à tout moment).</span>
            </label>
            <Button type="submit" data-testid="profil-save">Enregistrer</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Mon foyer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {account.household.length === 0 ? <p data-testid="household-empty" className="text-sm text-slate-700">Aucune personne ajoutée.</p> : (
            <ul className="space-y-2" data-testid="household-list">
              {account.household.map((m) => (
                <li key={m.id} data-testid="household-item" className="flex items-center justify-between rounded-md border border-slate-200 p-2 text-sm">
                  <span>{relationLabel(m.relation)}{m.label ? ` — ${m.label}` : ''} ({bandLabel(m.ageBand)})</span>
                  <Button type="button" variant="outline" size="sm" aria-label={`Retirer ${relationLabel(m.relation)}${m.label ? ' ' + m.label : ''}`} onClick={() => run(() => citizenApi.removeMember(m.id), 'Personne retirée du foyer.')}>Retirer</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => { e.preventDefault(); run(() => citizenApi.addMember({ relation: member.relation, ageBand: member.ageBand || null, label: member.label.trim() || null }), 'Personne ajoutée au foyer.'); }} className="grid gap-3 sm:grid-cols-4">
            <div><label htmlFor="hm-rel" className="block text-sm text-slate-800">Lien</label>
              <select id="hm-rel" data-testid="hm-rel" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={member.relation} onChange={(e) => setMember({ ...member, relation: e.target.value })}>{RELATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label htmlFor="hm-band" className="block text-sm text-slate-800">Tranche d’âge</label>
              <select id="hm-band" data-testid="hm-band" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={member.ageBand} onChange={(e) => setMember({ ...member, ageBand: e.target.value })}><option value="">Non précisé</option>{AGE_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label htmlFor="hm-label" className="block text-sm text-slate-800">Prénom ou repère (facultatif)</label>
              <input id="hm-label" data-testid="hm-label" className="mt-1 w-full rounded-md border border-slate-300 p-2" maxLength={30} value={member.label} onChange={(e) => setMember({ ...member, label: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit" data-testid="household-add">Ajouter</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Mes notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">Chaque réglage est appliqué par le serveur. Les SMS et les informations facultatives ne sont jamais activés sans votre accord explicite, distinct de l’acceptation du service.</p>
          {/* PKG-9 / M04: `relative` contains the absolutely positioned screen-reader texts of the cells; without it they escaped the scroll box and widened the page by 21 px at 390 px */}
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm" data-testid="prefs-table">
              <caption className="sr-only">Préférences de notification par canal et par catégorie</caption>
              <thead><tr><th scope="col" className="p-2 text-left">Catégorie</th>{CHANNELS.map(([c, l]) => <th key={c} scope="col" className="p-2 text-left">{l}</th>)}</tr></thead>
              <tbody>
                {CATEGORIES.map(([cat, catLabel]) => (
                  <tr key={cat} className="border-t border-slate-200">
                    <th scope="row" className="p-2 text-left font-medium">{catLabel}</th>
                    {CHANNELS.map(([ch, chLabel]) => {
                      const key = `${ch}.${cat}`;
                      const on = prefs[key] === true; const needs = NEEDS_CONSENT(ch, cat);
                      // the box follows the click at once and says it is being saved; the server's answer then decides (a refusal puts the saved value back)
                      const saving = key in pendingPrefs;
                      return (
                        <td key={ch} className="p-2 align-top">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" className="h-6 w-6 shrink-0" data-testid={`pref-${ch}-${cat}`} checked={saving ? pendingPrefs[key] : on} aria-label={`${chLabel} — ${catLabel}`} aria-busy={saving || undefined}
                              onChange={(e) => {
                                if (saving) return;   // one request per option at a time: no double submit
                                const enabled = e.target.checked;
                                if (enabled && needs && !consents[key]) { setProblem('Cochez d’abord « Je consens » pour cette option.'); return; }
                                const settle = () => setPendingPrefs(({ [key]: _done, ...rest }) => rest);
                                setPendingPrefs((p) => ({ ...p, [key]: enabled }));
                                run(async () => {
                                  const out = await citizenApi.setPreference({ channel: ch, category: cat, enabled, consentGiven: enabled && needs ? true : undefined });
                                  // the server's own answer is shown at once (the option is usable again right away); the reload that follows confirms it
                                  if (out && out.preferences) { setState((s) => (s.account ? { ...s, account: { ...s.account, preferences: out.preferences } } : s)); settle(); }
                                }, 'Préférence enregistrée.').finally(settle);
                              }} />
                            <span className={saving ? 'text-xs text-slate-700' : 'sr-only'} data-testid={`pref-state-${ch}-${cat}`}>{saving ? 'Enregistrement…' : on ? 'Activé' : 'Désactivé'}</span>
                          </label>
                          {needs && !on ? (
                            <label className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                              <input type="checkbox" className="h-6 w-6 shrink-0" data-testid={`consent-${ch}-${cat}`} checked={Boolean(consents[`${ch}.${cat}`])} onChange={(e) => setConsents({ ...consents, [`${ch}.${cat}`]: e.target.checked })} /> Je consens
                            </label>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-700" data-testid="prefs-no-inapp">Il n’existe pas encore de messages dans l’application : les informations et rappels vous parviennent par e-mail (et par SMS seulement si vous l’activez).</p>
        </CardContent>
      </Card>

      <DevicePush />

      <Card id="mes-dossiers" tabIndex={-1} ref={(el) => { if (el && typeof window !== 'undefined' && window.location.hash === '#mes-dossiers' && !el.dataset.focused) { el.dataset.focused = '1'; el.scrollIntoView(); el.focus({ preventScroll: true }); } }}>   {/* R18: the « Mes dossiers partagés » tile lands here */}
        <CardHeader><CardTitle className="text-lg">Mes dossiers partagés</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {shares.length === 0 ? <p data-testid="shares-empty" className="text-sm text-slate-700">Aucun dossier n’est rattaché à votre compte.</p> : (
            <ul className="space-y-2" data-testid="shares-list">
              {shares.map((s) => (
                <li key={s.id} data-testid="share-item" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <span>Dossier du {new Date(s.createdAt).toLocaleDateString('fr-FR')} — {s.expired ? 'expiré' : `expire le ${new Date(s.expiresAt).toLocaleDateString('fr-FR')}`} — {s.activeOrganizations} structure(s) avec accès</span>
                  <Button asChild size="sm" variant="outline"><Link to={`/compte/partages/${encodeURIComponent(s.id)}`} data-testid="share-manage">Gérer</Link></Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await citizenApi.claimShare(claim.shareId.trim(), claim.ownerSecret.trim()); setClaim({ shareId: '', ownerSecret: '' }); }, 'Dossier rattaché à votre compte.'); }} className="space-y-2">
            <p className="text-sm text-slate-700">Rattacher un dossier créé sans compte : il faut son identifiant et le lien privé « passeport » (le code qui suit <code>#owner=</code>).</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="cl-id" className="block text-sm text-slate-800">Identifiant du dossier</label><input id="cl-id" data-testid="claim-id" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={claim.shareId} onChange={(e) => setClaim({ ...claim, shareId: e.target.value })} /></div>
              <div><label htmlFor="cl-secret" className="block text-sm text-slate-800">Code privé du passeport</label><input id="cl-secret" data-testid="claim-secret" type="password" autoComplete="off" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={claim.ownerSecret} onChange={(e) => setClaim({ ...claim, ownerSecret: e.target.value })} /></div>
            </div>
            <Button type="submit" data-testid="claim-submit" disabled={!claim.shareId.trim() || !claim.ownerSecret.trim()}>Rattacher ce dossier</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
