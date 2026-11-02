// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { downloadText, explain, useK5 } from './helpers.js';
import { Field, Status } from './ui.jsx';
import { useT } from '@/i18n';

const pc = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')} %`);
const empty = { participantCode: '', journeyCode: 'J1_AIDE_LOGEMENT', environment: 'PRODUCTION', deviceType: 'TELEPHONE', assistiveTech: 'AUCUNE', outcome: 'REUSSI', assistance: 'AUCUNE',
  durationSeconds: '', errorCount: '0', clarity: '', accessibilityIssues: [], observation: '', consentRecorded: false, explicitConsent: false };

function Select({ id, label, value, onChange, options }) {
  return (
    <div className="space-y-1"><label htmlFor={id} className="block text-sm">{label}</label>
      <select id={id} className="w-full rounded border p-2" value={value} onChange={(e) => onChange(e.target.value)}>{Object.entries(options || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
  );
}

/**
 * Q14 (R31) — Mesures du pilote (/admin/pilote). Technical indicators are measured from the product now; pilot outcomes come only from observed sessions
 * with consenting participants (protocol docs/pilot/PROTOCOLE_PILOTE.md) and are shown only as aggregates, hidden below the suppression threshold.
 */
export default function AdminPilot() {
  const { t } = useT('admin');
  const k = useK5('pilot'); const d = k.data; const v = d?.vocab || {};
  const [s, setS] = useState(empty); const set = (x, val) => setS((o) => ({ ...o, [x]: val }));
  const [problem, setProblem] = useState('');
  const draw = async () => { setProblem(''); try { const out = await apiClient.admin.k5('pilot?code=new'); set('participantCode', out.participantCode); } catch (e) { setProblem(explain(e)); } };
  const csv = async () => { setProblem(''); try { const out = await apiClient.admin.k5('pilot?csv=1'); downloadText(out.csv, out.filename); } catch (e) { setProblem(explain(e)); } };
  return (
    <div className="space-y-6 p-4" data-testid="admin-pilot">
      <h1 className="text-2xl font-bold">{t('admin:k5.pilot.title', 'Mesures du pilote')}</h1>
      <p className="text-sm text-slate-700">{t('admin:k5.pilot.intro', 'Aucune mesure d’audience : rien n’est collecté auprès des visiteurs. Les résultats du pilote viennent seulement des séances observées avec des personnes volontaires qui ont signé le formulaire de consentement ; ils ne sont affichés qu’au-delà de {{k}} séances par parcours.', { k: d?.k ?? 5 })}</p>
      <p className="text-sm text-slate-700">{t('admin:k5.pilot.pseudonymised', 'Les séances ne sont pas anonymes : le code participant renvoie au formulaire papier qui porte le nom. Ce sont des données personnelles pseudonymisées, réservées aux administrateurs ; seul le jour de la séance est gardé, pas l’heure.')}</p>
      <Status msg={k.msg} problem={k.problem || k.error || problem} id="admin-pilot" />

      {d ? (
        <section className="space-y-2 rounded border p-3" aria-labelledby="pi-tech" data-testid="pilot-technical">
          <h2 id="pi-tech" className="font-semibold">{t('admin:k5.pilot.technical', 'Indicateurs techniques (mesurés le {{date}})', { date: new Date(d.technical.measuredAt).toLocaleString('fr-FR') })}</h2>
          <table className="w-full text-sm"><thead><tr className="text-left"><th>{t('admin:k5.pilot.col.content', 'Contenu')}</th><th>{t('admin:k5.pilot.col.visible', 'Publiés et vérifiés')}</th><th>{t('admin:k5.pilot.col.current', 'Vérifiés depuis moins de 90 jours')}</th><th>{t('admin:k5.pilot.col.held', 'Publiés mais retenus')}</th><th>{t('admin:k5.pilot.col.oldest', 'Vérification la plus ancienne')}</th></tr></thead>
            <tbody>{d.technical.catalogue.map((c) => <tr key={c.kind}><td>{c.label}</td><td>{c.visible}</td><td>{c.current} ({pc(c.currentShare)})</td><td>{c.heldBack}</td><td>{t('admin:k5.pilot.days', '{{n}} j', { n: c.oldestVerificationDays ?? '—' })}</td></tr>)}</tbody></table>
          <p className="text-sm">{t('admin:k5.pilot.news_line', 'Actualités publiées après vérification : {{published}} (gardées non publiées : {{kept}}) — guides publiés : {{guides}}.', { published: d.technical.news.published, kept: d.technical.news.keptUnpublished, guides: d.technical.guides.published })}</p>
        </section>
      ) : null}

      {d ? (
        <section className="space-y-2 rounded border p-3" aria-labelledby="pi-res" data-testid="pilot-results">
          <h2 id="pi-res" className="font-semibold">{t('admin:k5.pilot.results', 'Résultats du pilote — protocole {{version}} ({{sessions}} séance(s), {{participants}} participant(s))', { version: d.protocolVersion, sessions: d.sessions, participants: d.participants })}</h2>
          {d.sessions ? null : <p className="text-sm" data-testid="pilot-none">{t('admin:k5.pilot.none', 'Aucune séance enregistrée : aucun résultat n’existe encore.')}</p>}
          <ul className="space-y-2 text-sm">
            {d.journeys.map((j) => (
              <li key={j.journeyCode} className="rounded border p-2">
                <p className="font-medium">{j.label}</p>
                {j.suppressed || !j.sessions ? <p>{t('admin:k5.pilot.suppressed', '{{sessions}} séance(s) — {{reason}}.', { sessions: j.sessions, reason: j.reason })}</p> : (
                  <p>{t('admin:k5.pilot.journey_line', '{{sessions}} séances, {{participants}} participants — réussi sans aide {{alone}}, avec aide {{withHelp}}, échec ou abandon {{failure}} — durée médiane {{duration}} s — erreurs médianes {{errors}}', { sessions: j.sessions, participants: j.participants, alone: pc(j.successAlone), withHelp: pc(j.successWithHelp), failure: pc(j.failure), duration: j.medianDurationSeconds ?? '—', errors: j.medianErrors ?? '—' })}{j.clarity ? t('admin:k5.pilot.clarity', ' — clarté {{mean}}/5 ({{n}} réponses)', { mean: String(j.clarity.mean).replace('.', ','), n: j.clarity.n }) : ''}{j.accessibilityIssues.length ? t('admin:k5.pilot.issues', ' — difficultés : {{list}}', { list: j.accessibilityIssues.map((x) => `${x.label} (${x.suppressed ? t('admin:k5.pilot.below_k', 'moins de {{k}} séances', { k: d.k }) : x.sessions})`).join(', ') }) : ''}</p>
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={csv}>{t('admin:k5.pilot.download', 'Télécharger les agrégats (CSV)')}</Button>
        </section>
      ) : null}

      <section className="space-y-3 rounded border p-3" aria-labelledby="pi-new" data-testid="pilot-record">
        <h2 id="pi-new" className="font-semibold">{t('admin:k5.pilot.record_heading', 'Enregistrer une séance observée')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field id="pi-code" label={t('admin:k5.pilot.code', 'Code participant (reporté sur le formulaire de consentement)')} value={s.participantCode} onChange={(x) => set('participantCode', x)} />
          <Button type="button" size="sm" variant="outline" onClick={draw}>{t('admin:k5.pilot.draw', 'Tirer un nouveau code')}</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select id="pi-journey" label={t('admin:k5.pilot.journey', 'Parcours')} value={s.journeyCode} onChange={(x) => set('journeyCode', x)} options={v.journeys} />
          <Select id="pi-env" label={t('admin:k5.pilot.environment', 'Environnement')} value={s.environment} onChange={(x) => set('environment', x)} options={v.environments} />
          <Select id="pi-device" label={t('admin:k5.pilot.device', 'Appareil')} value={s.deviceType} onChange={(x) => set('deviceType', x)} options={v.devices} />
          <Select id="pi-at" label={t('admin:k5.pilot.assistive', 'Aide technique utilisée')} value={s.assistiveTech} onChange={(x) => set('assistiveTech', x)} options={v.assistive} />
          <Select id="pi-outcome" label={t('admin:k5.pilot.outcome', 'Résultat')} value={s.outcome} onChange={(x) => set('outcome', x)} options={v.outcomes} />
          <Select id="pi-help" label={t('admin:k5.pilot.help', 'Aide apportée par l’animateur')} value={s.assistance} onChange={(x) => set('assistance', x)} options={v.assistance} />
          <Field id="pi-duration" label={t('admin:k5.pilot.duration', 'Durée (secondes)')} type="number" value={s.durationSeconds} onChange={(x) => set('durationSeconds', x)} />
          <Field id="pi-errors" label={t('admin:k5.pilot.errors', 'Erreurs ou retours en arrière')} type="number" value={s.errorCount} onChange={(x) => set('errorCount', x)} />
          <Select id="pi-clarity" label={t('admin:k5.pilot.clarity_label', 'Clarté dite par la personne (1 à 5)')} value={s.clarity} onChange={(x) => set('clarity', x)} options={{ '': t('admin:k5.pilot.not_asked', 'Non demandée'), 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }} />
        </div>
        <fieldset className="space-y-1"><legend className="text-sm">{t('admin:k5.pilot.issues_legend', 'Difficultés observées')}</legend>
          <div className="grid gap-1 sm:grid-cols-3">{Object.entries(v.issues || {}).map(([c, l]) => (
            <label key={c} className="flex min-h-11 items-center gap-2 text-sm" htmlFor={`pi-i-${c}`}><input id={`pi-i-${c}`} type="checkbox" className="h-5 w-5" checked={s.accessibilityIssues.includes(c)}
              onChange={(e) => set('accessibilityIssues', e.target.checked ? [...s.accessibilityIssues, c] : s.accessibilityIssues.filter((x) => x !== c))} />{l}</label>
          ))}</div></fieldset>
        <Field id="pi-obs" label={t('admin:k5.pilot.observation', 'Observation sur le site (ni nom, ni adresse, ni numéro, ni santé, handicap ou situation de la personne)')} rows={3} value={s.observation} onChange={(x) => set('observation', x)} />
        <label className="flex min-h-11 items-center gap-2 text-sm" htmlFor="pi-consent"><input id="pi-consent" type="checkbox" className="h-5 w-5" checked={s.consentRecorded} onChange={(e) => set('consentRecorded', e.target.checked)} />
          {t('admin:k5.pilot.consent', 'La personne a signé le formulaire de consentement de ce protocole, qui porte ce code.')}</label>
        {(s.assistiveTech && s.assistiveTech !== 'AUCUNE') || s.accessibilityIssues.includes('LECTEUR_ECRAN') ? (
          <label className="flex min-h-11 items-center gap-2 text-sm" htmlFor="pi-explicit"><input id="pi-explicit" type="checkbox" className="h-5 w-5" checked={s.explicitConsent} onChange={(e) => set('explicitConsent', e.target.checked)} />
            {t('admin:k5.pilot.explicit', 'La personne a aussi coché l’accord séparé pour noter l’aide technique qu’elle utilise (cette information peut révéler un handicap). Sans cet accord, choisissez « Aucune ».')}</label>
        ) : null}
        <Button disabled={k.busy} onClick={async () => { const out = await k.act({ action: 'record', ...s, accessibilityIssues: s.accessibilityIssues }, t('admin:k5.pilot.recorded', 'Séance enregistrée.')); if (out) setS({ ...empty, participantCode: s.participantCode }); }}>{t('admin:k5.pilot.record', 'Enregistrer la séance')}</Button>
      </section>

      {d?.recent?.length ? (
        <section className="space-y-2 rounded border p-3 text-sm" aria-labelledby="pi-recent">
          <h2 id="pi-recent" className="font-semibold">{t('admin:k5.pilot.recent', 'Dernières séances (corrections et retraits de consentement)')}</h2>
          <ul>{d.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">{new Date(r.conductedAt).toLocaleDateString('fr-FR')} — {r.participantCode} — {v.journeys?.[r.journeyCode]} — {v.outcomes?.[r.outcome]}
              <Button size="sm" variant="outline" onClick={() => k.act({ action: 'delete', id: r.id }, t('admin:k5.pilot.deleted', 'Séance supprimée.'))}>{t('admin:k5.pilot.delete', 'Supprimer')}</Button>
              <Button size="sm" variant="outline" onClick={() => k.act({ action: 'delete', participantCode: r.participantCode }, (o) => t('admin:k5.pilot.withdrawn', '{{n}} séance(s) de {{code}} supprimée(s).', { n: o?.deleted ?? 0, code: r.participantCode }))}>{t('admin:k5.pilot.withdraw', 'Retrait du consentement')}</Button></li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}
