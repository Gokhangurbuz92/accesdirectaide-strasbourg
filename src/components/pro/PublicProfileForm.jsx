// R47 — a professional's PUBLIC display name and title (PUT /api/pro/profile). What a person sees when the structure makes this professional selectable for a
// booking (never the e-mail). Self-service (no memberId) or the structure administrator for a member (memberId). The server validates again (length,
// characters: no HTML, no e-mail address, no link) and journals the change without the text.
import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';

const NAME_MAX = 60;
const TITLE_MAX = 80;
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’\-()&/]*$/u;

/** @param {string} v */
const clean = (v) => v.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** @param {{ memberId?: string | null, idPrefix?: string, initial?: { displayName: string | null, jobTitle: string | null } | null, onSaved?: (p: { displayName: string | null, jobTitle: string | null }) => void, label?: string }} props */
export default function PublicProfileForm({ memberId = null, idPrefix = 'pro-profile', initial = null, onSaved = () => {}, label = '' }) {
  const { t } = useT('pro');
  const [name, setName] = useState(initial?.displayName || '');
  const [title, setTitle] = useState(initial?.jobTitle || '');
  const [loaded, setLoaded] = useState(Boolean(initial));
  const [errors, setErrors] = useState(/** @type {{ displayName?: string, jobTitle?: string, form?: string }} */ ({}));
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const titleRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;

  useEffect(() => {
    if (initial) return;
    let gone = false;
    fetch(`/api/pro/profile${memberId ? `?memberId=${encodeURIComponent(memberId)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!gone && d?.profile) { setName(d.profile.displayName || ''); setTitle(d.profile.jobTitle || ''); } })
      .catch(() => {})
      .finally(() => { if (!gone) setLoaded(true); });
    return () => { gone = true; };
  }, [memberId]);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once per member

  const invalidText = t('pro:public_profile.invalid_r47', 'Utilisez seulement des lettres, des chiffres, des espaces et . , \' - ( ) & / — sans balise, adresse e-mail ni lien.');
  const messageOf = (/** @type {string} */ code) => ({
    DISPLAYNAME_TOO_SHORT: t('pro:public_profile.name_short_r47', 'Le nom affiché doit compter au moins 2 caractères.'),
    DISPLAYNAME_TOO_LONG: t('pro:public_profile.name_long_r47', 'Le nom affiché ne peut pas dépasser 60 caractères.'),
    JOBTITLE_TOO_LONG: t('pro:public_profile.title_long_r47', 'La fonction ne peut pas dépasser 80 caractères.'),
  })[code] || invalidText;

  /** client check (the server decides) */
  const check = () => {
    /** @type {{ displayName?: string, jobTitle?: string }} */
    const out = {};
    const n = clean(name); const j = clean(title);
    if (n && [...n].length < 2) out.displayName = messageOf('DISPLAYNAME_TOO_SHORT');
    else if (n && (!ALLOWED.test(n) || /https?:|www\.|@/i.test(n))) out.displayName = invalidText;
    if (j && (!ALLOWED.test(j) || /https?:|www\.|@/i.test(j))) out.jobTitle = invalidText;
    return out;
  };

  const submit = async (/** @type {import('react').FormEvent} */ e) => {
    e.preventDefault();
    setSaved('');
    const found = check();
    setErrors(found);
    if (found.displayName) { nameRef.current?.focus(); return; }
    if (found.jobTitle) { titleRef.current?.focus(); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/pro/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...getCsrfHeaders() },
        body: JSON.stringify({ ...(memberId ? { memberId } : {}), displayName: clean(name), jobTitle: clean(title) }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.profile) {
        setName(body.profile.displayName || ''); setTitle(body.profile.jobTitle || '');
        setSaved(body.profile.displayName ? t('pro:public_profile.saved_r47', 'Nom public enregistré.') : t('pro:public_profile.removed_r47', 'Nom public retiré : ce membre ne peut plus être choisi par son nom.'));
        onSaved(body.profile);
      } else if (res.status === 400 && body?.field) {
        setErrors({ [body.field]: messageOf(body.code) });
        (body.field === 'jobTitle' ? titleRef : nameRef).current?.focus();
      } else {
        setErrors({ form: res.status === 403 ? t('pro:public_profile.forbidden_r47', 'Seul l’administrateur de la structure peut modifier le nom public d’un autre membre.') : t('pro:public_profile.failed_r47', 'Le nom public n’a pas pu être enregistré. Réessayez.') });
      }
    } catch {
      setErrors({ form: t('pro:public_profile.failed_r47', 'Le nom public n’a pas pu être enregistré. Réessayez.') });
    } finally {
      setBusy(false);
    }
  };

  const nameId = `${idPrefix}-display-name`; const titleId = `${idPrefix}-job-title`;
  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-testid={`${idPrefix}-form`} aria-label={label || t('pro:public_profile.form_label_r47', 'Nom public')} aria-busy={!loaded || busy}>
      <div className="space-y-1">
        <Label htmlFor={nameId}>{t('pro:public_profile.name_label_r47', 'Nom affiché aux personnes')}</Label>
        <Input id={nameId} ref={nameRef} value={name} maxLength={NAME_MAX} autoComplete="name" dir="auto" disabled={!loaded}
          onChange={(e) => setName(e.target.value)} aria-invalid={errors.displayName ? 'true' : undefined}
          aria-describedby={`${nameId}-hint${errors.displayName ? ` ${nameId}-error` : ''}`} data-testid={`${idPrefix}-display-name`} />
        <p id={`${nameId}-hint`} className="text-xs text-slate-700">{t('pro:public_profile.name_hint_r47', 'De 2 à 60 caractères, par exemple « Camille D. ». Il apparaît seulement quand la structure vous rend choisissable pour la prise de rendez-vous. Laissez vide pour ne pas être choisi par votre nom.')}</p>
        {errors.displayName ? <p id={`${nameId}-error`} className="text-sm text-red-800" data-testid={`${idPrefix}-display-name-error`}>{errors.displayName}</p> : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={titleId}>{t('pro:public_profile.title_label_r47', 'Fonction (facultatif)')}</Label>
        <Input id={titleId} ref={titleRef} value={title} maxLength={TITLE_MAX} autoComplete="organization-title" dir="auto" disabled={!loaded}
          onChange={(e) => setTitle(e.target.value)} aria-invalid={errors.jobTitle ? 'true' : undefined}
          aria-describedby={errors.jobTitle ? `${titleId}-error` : undefined} data-testid={`${idPrefix}-job-title`} />
        {errors.jobTitle ? <p id={`${titleId}-error`} className="text-sm text-red-800" data-testid={`${idPrefix}-job-title-error`}>{errors.jobTitle}</p> : null}
      </div>
      {errors.form ? <p role="alert" className="text-sm text-red-800" data-testid={`${idPrefix}-error`}>{errors.form}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!loaded || busy} data-testid={`${idPrefix}-save`}>{t('pro:public_profile.save_r47', 'Enregistrer le nom public')}</Button>
        <p role="status" className="text-sm text-emerald-800" data-testid={`${idPrefix}-status`}>{saved}</p>
      </div>
    </form>
  );
}

PublicProfileForm.propTypes = {
  memberId: PropTypes.string,
  idPrefix: PropTypes.string,
  initial: PropTypes.shape({ displayName: PropTypes.string, jobTitle: PropTypes.string }),
  onSaved: PropTypes.func,
  label: PropTypes.string,
};
