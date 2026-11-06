// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { Status, Field } from './ui.jsx';
import { useT, DATE_SHORT, formatDate } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * PKG-5 / I05 I01 — partner agreements and institutional accounts (/admin/institutions). An agreement is recorded from a REAL signed document (reference,
 * date, signatory); an account can only be activated under a signed agreement and only sees aggregate statistics. Account actions need an elevation.
 * R21: « Nouveau mot de passe provisoire » for a partner who lost theirs or is locked out (shown once, every session of the account ends).
 */
export default function AdminInstitutions() {
  const { t } = useT('admin');
  const fr = useFrAttrs();   // R47: the partners' names stay French (lang="fr" outside French)
  const k = useK5('institutions'); const [f, setF] = useState({}); const v = (x) => f[x] || ''; const set = (x, val) => setF((s) => ({ ...s, [x]: val }));
  const [once, setOnce] = useState(null);
  const d = k.data;
  return (
    <div className="space-y-6 p-4" data-testid="admin-institutions">
      <h1 className="text-2xl font-bold">{t('admin:k5.institutions.title', 'Partenaires institutionnels')}</h1>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-inst" />
      {once ? <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2" data-testid="admin-inst-once">{t('admin:k5.institutions.once', 'Mot de passe provisoire (affiché une seule fois, à transmettre par un canal séparé ; la personne en choisira un à sa connexion) : ')}<code>{once}</code></p> : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="in-agr">
        <h2 id="in-agr" className="font-semibold">{t('admin:k5.institutions.agreements', 'Conventions')}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field id="agr-name" label={t('admin:k5.institutions.partner', 'Partenaire')} value={v('name')} onChange={(x) => set('name', x)} />
          <div className="space-y-1"><label htmlFor="agr-kind" className="block text-sm">{t('admin:k5.institutions.type', 'Type')}</label>
            <select id="agr-kind" className="w-full rounded border p-2" value={v('kind') || 'CONVENTION'} onChange={(e) => set('kind', e.target.value)}><option value="CONVENTION">{t('admin:k5.institutions.kind.convention', 'Convention')}</option><option value="DATA_SHARING">{t('admin:k5.institutions.kind.data_sharing', 'Partage de données')}</option><option value="OTHER">{t('admin:k5.institutions.kind.other', 'Autre')}</option></select></div>
          <Field id="agr-scope" label={t('admin:k5.institutions.scope', 'Objet')} value={v('scope')} onChange={(x) => set('scope', x)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'agreement_create', partnerName: v('name'), kind: v('kind') || 'CONVENTION', scope: v('scope') }, t('admin:k5.institutions.agreement_saved', 'Convention enregistrée (brouillon).'))}>{t('admin:k5.institutions.agreement_create', 'Enregistrer une convention')}</Button>
        <ul className="space-y-2">
          {(d?.agreements || []).map((g) => (
            <li key={g.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-inst-agreement">
              <p className="font-semibold"><span {...fr}>{g.partnerName}</span> — {g.status === 'DRAFT' ? t('admin:k5.institutions.draft', 'brouillon') : g.status === 'SIGNED' ? t('admin:k5.institutions.signed_on', 'signée le {{date}} ({{ref}})', { date: formatDate(g.signedAt, DATE_SHORT), ref: g.documentRef }) : t('admin:k5.institutions.ended', 'terminée')}</p>
              {g.status === 'DRAFT' ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field id={`ref-${g.id}`} label={t('admin:k5.institutions.doc_ref', 'Référence du document signé')} value={v(`ref-${g.id}`)} onChange={(x) => set(`ref-${g.id}`, x)} />
                  <Field id={`date-${g.id}`} label={t('admin:k5.institutions.sign_date', 'Date de signature')} type="date" value={v(`date-${g.id}`)} onChange={(x) => set(`date-${g.id}`, x)} />
                  <Field id={`who-${g.id}`} label={t('admin:k5.institutions.signatory', 'Signataire du partenaire')} value={v(`who-${g.id}`)} onChange={(x) => set(`who-${g.id}`, x)} />
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'agreement_sign', id: g.id, documentRef: v(`ref-${g.id}`), signedAt: v(`date-${g.id}`), signedByPartner: v(`who-${g.id}`) }, t('admin:k5.institutions.signature_saved', 'Signature enregistrée.'))}>{t('admin:k5.institutions.save_signature', 'Enregistrer la signature')}</Button>
                </div>
              ) : g.status === 'SIGNED' ? <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'agreement_end', id: g.id }, t('admin:k5.institutions.agreement_ended', 'Convention terminée ; ses comptes sont suspendus.'))}>{t('admin:k5.institutions.end_agreement', 'Terminer la convention')}</Button> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="in-acc">
        <h2 id="in-acc" className="font-semibold">{t('admin:k5.institutions.accounts', 'Comptes institutionnels (statistiques agrégées seulement)')}</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field id="acc-email" label={t('admin:k5.institutions.email', 'Adresse')} value={v('email')} onChange={(x) => set('email', x)} />
          <Field id="acc-org" label={t('admin:k5.institutions.org', 'Organisme')} value={v('org')} onChange={(x) => set('org', x)} />
          <Field id="acc-terr" label={t('admin:k5.institutions.territory', 'Territoire')} value={v('terr')} onChange={(x) => set('terr', x)} />
          <div className="space-y-1"><label htmlFor="acc-agr" className="block text-sm">{t('admin:k5.institutions.agreement', 'Convention')}</label>
            <select id="acc-agr" className="w-full rounded border p-2" value={v('agr')} onChange={(e) => set('agr', e.target.value)}><option value="">—</option>{(d?.agreements || []).filter((g) => g.status !== 'ENDED').map((g) => <option key={g.id} value={g.id} {...fr}>{g.partnerName}</option>)}</select></div>
        </div>
        <Button size="sm" disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'account_create', email: v('email'), organisationName: v('org'), territory: v('terr'), agreementId: v('agr') }, t('admin:k5.institutions.account_created', 'Compte créé (inactif tant que la convention n’est pas signée et le compte activé).')); if (out?.initialPassword) setOnce(out.initialPassword); }}>{t('admin:k5.institutions.create_account', 'Créer le compte')}</Button>
        <ul className="space-y-2">
          {(d?.accounts || []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm" data-testid="admin-inst-account">
              <span><span {...fr}>{a.organisationName}</span> — {a.email} — {a.status === 'ACTIVE' ? t('admin:k5.institutions.active', 'actif') : a.status === 'SUSPENDED' ? t('admin:k5.institutions.suspended', 'suspendu') : t('admin:k5.institutions.awaiting', 'en attente de convention')}{a.temporaryPassword ? t('admin:k5.institutions.temp_password', ' — mot de passe provisoire pas encore remplacé') : ''}</span>
              {a.status !== 'ACTIVE' ? <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'account_activate', id: a.id }, t('admin:k5.institutions.activated', 'Compte activé.'))}>{t('admin:k5.institutions.activate', 'Activer')}</Button>
                : <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'account_suspend', id: a.id }, t('admin:k5.institutions.suspended_ok', 'Compte suspendu.'))}>{t('admin:k5.institutions.suspend', 'Suspendre')}</Button>}
              <Button size="sm" variant="outline" disabled={k.busy} aria-label={t('admin:k5.institutions.reset_aria', 'Nouveau mot de passe provisoire pour {{email}}', { email: a.email })} onClick={async () => { const out = await k.act({ action: 'account_password_reset', id: a.id }, t('admin:k5.institutions.reset_done', 'Nouveau mot de passe provisoire créé ; les sessions du compte sont fermées.')); if (out?.initialPassword) setOnce(out.initialPassword); }}>{t('admin:k5.institutions.reset', 'Nouveau mot de passe provisoire')}</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
