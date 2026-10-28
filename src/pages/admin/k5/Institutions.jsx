// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { Status, Field } from './ui.jsx';

/**
 * PKG-5 / I05 I01 — partner agreements and institutional accounts (/admin/institutions). An agreement is recorded from a REAL signed document (reference,
 * date, signatory); an account can only be activated under a signed agreement and only sees aggregate statistics. Account actions need an elevation.
 * R21: « Nouveau mot de passe provisoire » for a partner who lost theirs or is locked out (shown once, every session of the account ends).
 */
export default function AdminInstitutions() {
  const k = useK5('institutions'); const [f, setF] = useState({}); const v = (x) => f[x] || ''; const set = (x, val) => setF((s) => ({ ...s, [x]: val }));
  const [once, setOnce] = useState(null);
  const d = k.data;
  return (
    <div className="space-y-6 p-4" data-testid="admin-institutions">
      <h1 className="text-2xl font-bold">Partenaires institutionnels</h1>
      <Status msg={k.msg} problem={k.problem || k.error} id="admin-inst" />
      {once ? <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2" data-testid="admin-inst-once">Mot de passe provisoire (affiché une seule fois, à transmettre par un canal séparé ; la personne en choisira un à sa connexion) : <code>{once}</code></p> : null}
      <section className="space-y-2 rounded border p-3" aria-labelledby="in-agr">
        <h2 id="in-agr" className="font-semibold">Conventions</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field id="agr-name" label="Partenaire" value={v('name')} onChange={(x) => set('name', x)} />
          <div className="space-y-1"><label htmlFor="agr-kind" className="block text-sm">Type</label>
            <select id="agr-kind" className="w-full rounded border p-2" value={v('kind') || 'CONVENTION'} onChange={(e) => set('kind', e.target.value)}><option value="CONVENTION">Convention</option><option value="DATA_SHARING">Partage de données</option><option value="OTHER">Autre</option></select></div>
          <Field id="agr-scope" label="Objet" value={v('scope')} onChange={(x) => set('scope', x)} />
        </div>
        <Button size="sm" disabled={k.busy} onClick={() => k.act({ action: 'agreement_create', partnerName: v('name'), kind: v('kind') || 'CONVENTION', scope: v('scope') }, 'Convention enregistrée (brouillon).')}>Enregistrer une convention</Button>
        <ul className="space-y-2">
          {(d?.agreements || []).map((g) => (
            <li key={g.id} className="space-y-1 rounded border p-2 text-sm" data-testid="admin-inst-agreement">
              <p className="font-semibold">{g.partnerName} — {g.status === 'DRAFT' ? 'brouillon' : g.status === 'SIGNED' ? `signée le ${new Date(g.signedAt).toLocaleDateString('fr-FR')} (${g.documentRef})` : 'terminée'}</p>
              {g.status === 'DRAFT' ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field id={`ref-${g.id}`} label="Référence du document signé" value={v(`ref-${g.id}`)} onChange={(x) => set(`ref-${g.id}`, x)} />
                  <Field id={`date-${g.id}`} label="Date de signature" type="date" value={v(`date-${g.id}`)} onChange={(x) => set(`date-${g.id}`, x)} />
                  <Field id={`who-${g.id}`} label="Signataire du partenaire" value={v(`who-${g.id}`)} onChange={(x) => set(`who-${g.id}`, x)} />
                  <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'agreement_sign', id: g.id, documentRef: v(`ref-${g.id}`), signedAt: v(`date-${g.id}`), signedByPartner: v(`who-${g.id}`) }, 'Signature enregistrée.')}>Enregistrer la signature</Button>
                </div>
              ) : g.status === 'SIGNED' ? <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'agreement_end', id: g.id }, 'Convention terminée ; ses comptes sont suspendus.')}>Terminer la convention</Button> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2 rounded border p-3" aria-labelledby="in-acc">
        <h2 id="in-acc" className="font-semibold">Comptes institutionnels (statistiques agrégées seulement)</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field id="acc-email" label="Adresse" value={v('email')} onChange={(x) => set('email', x)} />
          <Field id="acc-org" label="Organisme" value={v('org')} onChange={(x) => set('org', x)} />
          <Field id="acc-terr" label="Territoire" value={v('terr')} onChange={(x) => set('terr', x)} />
          <div className="space-y-1"><label htmlFor="acc-agr" className="block text-sm">Convention</label>
            <select id="acc-agr" className="w-full rounded border p-2" value={v('agr')} onChange={(e) => set('agr', e.target.value)}><option value="">—</option>{(d?.agreements || []).filter((g) => g.status !== 'ENDED').map((g) => <option key={g.id} value={g.id}>{g.partnerName}</option>)}</select></div>
        </div>
        <Button size="sm" disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'account_create', email: v('email'), organisationName: v('org'), territory: v('terr'), agreementId: v('agr') }, 'Compte créé (inactif tant que la convention n’est pas signée et le compte activé).'); if (out?.initialPassword) setOnce(out.initialPassword); }}>Créer le compte</Button>
        <ul className="space-y-2">
          {(d?.accounts || []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm" data-testid="admin-inst-account">
              <span>{a.organisationName} — {a.email} — {a.status === 'ACTIVE' ? 'actif' : a.status === 'SUSPENDED' ? 'suspendu' : 'en attente de convention'}{a.temporaryPassword ? ' — mot de passe provisoire pas encore remplacé' : ''}</span>
              {a.status !== 'ACTIVE' ? <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'account_activate', id: a.id }, 'Compte activé.')}>Activer</Button>
                : <Button size="sm" variant="outline" disabled={k.busy} onClick={() => k.act({ action: 'account_suspend', id: a.id }, 'Compte suspendu.')}>Suspendre</Button>}
              <Button size="sm" variant="outline" disabled={k.busy} aria-label={`Nouveau mot de passe provisoire pour ${a.email}`} onClick={async () => { const out = await k.act({ action: 'account_password_reset', id: a.id }, 'Nouveau mot de passe provisoire créé ; les sessions du compte sont fermées.'); if (out?.initialPassword) setOnce(out.initialPassword); }}>Nouveau mot de passe provisoire</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
