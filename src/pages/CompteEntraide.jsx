// @ts-nocheck
/**
 * X03 (expansion) — Entraide (/compte/entraide). ⚠ A dedicated AIPD is mandatory before any opening (closed by default: 503 → « not open yet »).
 * The SAFETY GUIDANCE is always shown (public places, never money, emergency numbers). Step 1, JOIN: a pseudonym (never prefilled, different from the story
 * pseudonym) and the charter — marked « projet » — accepted with a box never pre-ticked. Then: BROWSE anonymous offers by category and area (no volunteer, no
 * score) and ask on ONE offer with an optional logistics note (health / sensitive-data warning linked to the field); OFFER help (closed category and area);
 * the volunteer ACCEPTS → only then both pseudonyms appear and each side MAY show an e-mail address (box never pre-ticked, revocable). No messaging.
 * Report (closed reasons) and block (both ways) from an offer or a request; leave Entraide (everything erased).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { AREAS, CATEGORIES, CHARTER_VERSION, CONTACT_VERSION, NOTE_MAX, REASONS, areaLabel, categoryLabel, offerStatusLabel, problemLabel, reasonLabel, requestStatusLabel } from '@/lib/entraide';

const field = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm';
const box = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4';
const fail = (err, t) => problemLabel(err?.code, t) || err?.message || t('entraide:failed', 'Action refusée.');

export function SafetyGuidance() {
  const { t } = useT('entraide');
  return (
    <section aria-labelledby="entraide-safety-title" data-testid="entraide-safety" className="space-y-2 rounded-xl border border-blue-300 bg-blue-50 p-4 text-blue-950">
      <h2 id="entraide-safety-title" className="text-lg font-semibold">{t('entraide:safety.title', 'Votre sécurité d’abord')}</h2>
      <ul className="list-disc space-y-1 ps-5 text-sm">
        <li>{t('entraide:safety.public', 'Pour une première rencontre, choisissez un lieu public (médiathèque, café, hall de mairie) — jamais votre domicile.')}</li>
        <li>{t('entraide:safety.money', 'Ne donnez jamais d’argent, de cadeau, de coordonnées bancaires, de papiers d’identité, de code ni de mot de passe. L’entraide est gratuite.')}</li>
        <li>{t('entraide:safety.private', 'Ne parlez pas de votre santé, d’un handicap ou de votre situation administrative : ce n’est pas nécessaire pour un coup de main.')}</li>
        <li>{t('entraide:safety.stop', 'Vous pouvez arrêter à tout moment, sans vous justifier, signaler ou bloquer une personne.')}</li>
      </ul>
      <p className="text-sm font-semibold">{t('entraide:safety.emergency', 'En cas de danger :')}</p>
      <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="entraide-emergency">
        <li><span dir="ltr">112</span> — {t('entraide:safety.n112', 'numéro d’urgence européen')}</li>
        <li><span dir="ltr">17</span> — {t('entraide:safety.n17', 'police ou gendarmerie')}</li>
        <li><span dir="ltr">114</span> — {t('entraide:safety.n114', 'urgence par SMS (personnes sourdes, malentendantes ou ne pouvant pas parler)')}</li>
        <li><span dir="ltr">3919</span> — {t('entraide:safety.n3919', 'Violences Femmes Info, gratuit et anonyme')}</li>
        <li><span dir="ltr">119</span> — {t('entraide:safety.n119', 'Allô Enfance en Danger, si un enfant est en danger')}</li>
      </ul>
    </section>
  );
}

function CharterText() {
  const { t } = useT('entraide');
  return (
    <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900" data-testid="entraide-charter">
      <p className="font-semibold">{t('entraide:charter.title', 'Charte de l’entraide — PROJET (texte non encore validé, version {{v}})', { v: CHARTER_VERSION })}</p>
      <ul className="list-disc space-y-1 ps-5">
        <li>{t('entraide:charter.free', 'L’entraide est gratuite et bénévole : je ne demande ni ne donne d’argent, de cadeau ou de service en échange.')}</li>
        <li>{t('entraide:charter.public', 'La première rencontre a lieu dans un lieu public ; je n’entre pas au domicile d’une personne que je ne connais pas.')}</li>
        <li>{t('entraide:charter.privacy', 'Je ne demande pas et ne communique pas d’informations sur la santé, un handicap, la situation administrative ou la vie privée ; je ne garde aucun papier ni code d’une autre personne.')}</li>
        <li>{t('entraide:charter.respect', 'Je reste respectueux ; chacun peut arrêter à tout moment. Je ne garde pas d’enfant et n’accompagne pas un mineur seul.')}</li>
        <li>{t('entraide:charter.limits', 'L’entraide ne remplace pas un professionnel (travailleur social, médecin, avocat) et ne promet aucune aide ni décision.')}</li>
        <li>{t('entraide:charter.moderation', 'Je signale tout comportement inquiétant ; la modération peut suspendre un pseudonyme.')}</li>
      </ul>
    </div>
  );
}

/** @param {{ id: string, value: string, onChange: (v: string) => void }} props */
function NoteField({ id, value, onChange }) {
  const { t } = useT('entraide');
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-900">{t('entraide:note.label', 'Note pratique (facultative)')}</label>
      <p id={`${id}-warning`} data-testid="entraide-note-warning" className="mt-1 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950">
        {t('entraide:note.warning', 'Seulement des informations pratiques (jour, moment, langue parlée). N’écrivez rien sur votre santé, un handicap, votre situation administrative ou familiale, ni aucune coordonnée, aucun lien ni aucun montant.')}
      </p>
      <textarea id={id} rows={3} maxLength={NOTE_MAX} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-warning ${id}-count`} className={field} />
      <p id={`${id}-count`} className="text-xs text-slate-700">{t('entraide:note.count', '{{n}} caractères sur {{max}}', { n: value.length, max: NOTE_MAX })}</p>
    </div>
  );
}

/** report + block from an offer or a request @param {{ target: Record<string, string>, onDone: (text: string, error?: boolean) => void }} props */
function ReportBlock({ target, onDone }) {
  const { t } = useT('entraide');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const run = async (body, ok) => { try { await citizenApi.entraideAction({ ...body, ...target }); onDone(ok); } catch (e) { onDone(fail(e, t), true); } };
  return (
    <div className="flex flex-wrap items-end gap-2">
      {!open ? <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{t('entraide:report.open', 'Signaler')}</Button> : (
        <div className="flex flex-wrap items-end gap-2" data-testid="entraide-report-form">
          <div>
            <label htmlFor={`${uid}-reason`} className="block text-sm font-semibold text-slate-900">{t('entraide:report.reason', 'Motif du signalement')}</label>
            <select id={`${uid}-reason`} className="mt-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('entraide:report.choose', 'Choisir un motif')}</option>
              {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" disabled={!reason} onClick={() => run({ action: 'report', reason }, t('entraide:report.done', 'Merci : la modération examinera ce signalement. La personne ne saura pas qui l’a signalée.'))}>{t('entraide:report.send', 'Envoyer le signalement')}</Button>
        </div>
      )}
      {!confirmBlock ? <Button type="button" size="sm" variant="outline" onClick={() => setConfirmBlock(true)}>{t('entraide:block.open', 'Bloquer')}</Button> : (
        <Button type="button" size="sm" variant="destructive" onClick={() => run({ action: 'block' }, t('entraide:block.done', 'Personne bloquée : vous ne voyez plus ses offres et elle ne peut plus vous écrire de demande.'))}>{t('entraide:block.confirm', 'Confirmer le blocage')}</Button>
      )}
    </div>
  );
}

/** the e-mail one side MAY show after mutual acceptance @param {{ request: any, onDone: (text: string, error?: boolean) => void }} props */
function ContactBox({ request, onDone }) {
  const { t } = useT('entraide');
  const uid = useId();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const mine = request.contacts?.mine; const theirs = request.contacts?.theirs;
  const share = async (e) => {
    e.preventDefault();
    if (!consent || !email.trim()) return;
    try { await citizenApi.entraideAction({ action: 'contact_share', requestId: request.id, email: email.trim(), consent: true, consentVersion: CONTACT_VERSION }); setEmail(''); setConsent(false); onDone(t('entraide:contact.shared', 'Votre adresse est maintenant visible par cette personne. Vous pouvez la retirer à tout moment.')); }
    catch (err) { onDone(fail(err, t), true); }
  };
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="entraide-contact">
      <p className="text-sm text-slate-900">{theirs ? t('entraide:contact.theirs', 'Adresse communiquée par {{p}} : {{e}}', { p: request.partner, e: theirs }) : t('entraide:contact.none', '{{p}} n’a pas communiqué d’adresse.', { p: request.partner })}</p>
      {mine ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-900">{t('entraide:contact.mine', 'Vous avez communiqué : {{e}}', { e: mine })}</p>
          <Button type="button" size="sm" variant="outline" onClick={async () => { try { await citizenApi.entraideAction({ action: 'contact_revoke', requestId: request.id }); onDone(t('entraide:contact.revoked', 'Votre adresse n’est plus visible.')); } catch (err) { onDone(fail(err, t), true); } }}>{t('entraide:contact.revoke', 'Retirer mon adresse')}</Button>
        </div>
      ) : (
        <form onSubmit={share} className="space-y-2" noValidate>
          <label htmlFor={`${uid}-email`} className="block text-sm font-semibold text-slate-900">{t('entraide:contact.label', 'Adresse e-mail à communiquer (facultatif)')}</label>
          <input id={`${uid}-email`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} max-w-sm`} />
          <label className="flex items-start gap-2 text-sm text-slate-900">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>{t('entraide:contact.consent', 'Je choisis de montrer cette adresse à {{p}}, pour cette demande seulement. Je peux la retirer à tout moment.', { p: request.partner })}</span>
          </label>
          <Button type="submit" size="sm" disabled={!consent || !email.trim()}>{t('entraide:contact.share', 'Communiquer mon adresse')}</Button>
        </form>
      )}
    </div>
  );
}

/** @param {{ r: any, side: 'sent' | 'received', onDone: (text: string, error?: boolean) => void }} props */
function RequestCard({ r, side, onDone }) {
  const { t } = useT('entraide');
  const act = async (action, ok) => { try { await citizenApi.entraideAction({ action, id: r.id }); onDone(ok); } catch (e) { onDone(fail(e, t), true); } };
  const active = ['pending', 'accepted'].includes(r.status);
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">{categoryLabel(r.category, t)} — {areaLabel(r.area, t)}</p>
      <p className="text-sm text-slate-800" data-testid="entraide-request-status">{requestStatusLabel(r.status, t)} — <time dateTime={r.createdAt}>{formatDate(r.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
      {r.note && <p className="whitespace-pre-line text-sm text-slate-900">{r.note}</p>}
      {r.status === 'accepted' && r.partner && <p className="text-sm text-slate-900" data-testid="entraide-partner">{t('entraide:request.partner', 'Pseudonyme de l’autre personne : {{p}}', { p: r.partner })}</p>}
      {r.status === 'pending' && side === 'received' && <p className="text-sm text-slate-700">{t('entraide:request.anonymous', 'Le pseudonyme de la personne n’apparaît qu’après votre accord.')}</p>}
      {r.status === 'accepted' && <ContactBox request={r} onDone={onDone} />}
      <div className="flex flex-wrap gap-2">
        {r.status === 'pending' && side === 'received' && (
          <>
            <Button type="button" size="sm" onClick={() => act('request_accept', t('entraide:request.accepted', 'Demande acceptée : vous voyez maintenant le pseudonyme de la personne.'))}>{t('entraide:request.accept', 'Accepter')}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => act('request_decline', t('entraide:request.declined', 'Demande non retenue.'))}>{t('entraide:request.decline', 'Ne pas donner suite')}</Button>
          </>
        )}
        {((r.status === 'pending' && side === 'sent') || r.status === 'accepted') && (
          <Button type="button" size="sm" variant="outline" onClick={() => act('request_end', t('entraide:request.ended', 'Demande terminée ; les adresses communiquées sont effacées.'))}>{r.status === 'pending' ? t('entraide:request.withdraw', 'Retirer ma demande') : t('entraide:request.end', 'Terminer')}</Button>
        )}
      </div>
      {active && <ReportBlock target={{ requestId: r.id }} onDone={onDone} />}
    </li>
  );
}

/** @param {{ onDone: (text: string, error?: boolean) => void }} props */
function Browse({ onDone }) {
  const { t } = useT('entraide');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [items, setItems] = useState(null);
  const [asking, setAsking] = useState('');
  const [note, setNote] = useState('');
  const search = async (e) => {
    e?.preventDefault();
    try { setItems((await citizenApi.browseEntraide(category, area)).items || []); } catch (err) { onDone(fail(err, t), true); }
  };
  const ask = async (offerId) => {
    try { await citizenApi.entraideAction({ action: 'request_create', offerId, ...(note.trim() ? { note: note.trim() } : {}) }); setAsking(''); setNote(''); onDone(t('entraide:browse.asked', 'Demande envoyée. La personne bénévole ne voit pas votre pseudonyme tant qu’elle n’a pas accepté.')); search(); }
    catch (err) { onDone(fail(err, t), true); }
  };
  return (
    <section aria-labelledby="entraide-browse" className={box}>
      <h2 id="entraide-browse" className="text-lg font-semibold text-slate-900">{t('entraide:browse.title', 'Trouver un coup de main')}</h2>
      <p className="text-sm text-slate-700">{t('entraide:browse.intro', 'Les offres sont anonymes et classées de la plus récente à la plus ancienne. Aucun classement automatique : c’est vous qui choisissez.')}</p>
      <form onSubmit={search} className="flex flex-wrap items-end gap-3" data-testid="entraide-browse-form">
        <div>
          <label htmlFor="entraide-filter-category" className="block text-sm font-semibold text-slate-900">{t('entraide:field.category', 'Type d’aide')}</label>
          <select id="entraide-filter-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('entraide:filter.all_categories', 'Tous les types d’aide')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="entraide-filter-area" className="block text-sm font-semibold text-slate-900">{t('entraide:field.area', 'Secteur')}</label>
          <select id="entraide-filter-area" className={field} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">{t('entraide:filter.all_areas', 'Tous les secteurs')}</option>
            {AREAS.map((a) => <option key={a} value={a}>{areaLabel(a, t)}</option>)}
          </select>
        </div>
        <Button type="submit">{t('entraide:browse.search', 'Afficher les offres')}</Button>
      </form>
      {items && items.length === 0 && <p className="text-sm text-slate-700" data-testid="entraide-browse-empty">{t('entraide:browse.empty', 'Aucune offre pour ces critères pour le moment.')}</p>}
      {items && items.length > 0 && (
        <ul className="space-y-3" data-testid="entraide-offers">
          {items.map((o) => (
            <li key={o.id} className="space-y-2 rounded-md border border-slate-200 p-3">
              <p className="font-semibold text-slate-900">{categoryLabel(o.category, t)}</p>
              <p className="text-sm text-slate-800">{areaLabel(o.area, t)} — <time dateTime={o.createdOn}>{formatDate(o.createdOn, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
              {o.note && <p className="whitespace-pre-line text-sm text-slate-900">{o.note}</p>}
              {o.requested ? <p className="text-sm text-slate-700">{t('entraide:browse.already', 'Vous avez déjà une demande en cours sur cette offre.')}</p>
                : asking === o.id ? (
                  <div className="space-y-2">
                    <NoteField id={`entraide-ask-${o.id}`} value={note} onChange={setNote} />
                    <Button type="button" size="sm" onClick={() => ask(o.id)}>{t('entraide:browse.send', 'Envoyer ma demande')}</Button>
                  </div>
                ) : <Button type="button" size="sm" onClick={() => { setAsking(o.id); setNote(''); }}>{t('entraide:browse.ask', 'Demander ce coup de main')}</Button>}
              <ReportBlock target={{ offerId: o.id }} onDone={(m, e) => { onDone(m, e); if (!e) search(); }} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** @param {{ onDone: (text: string, error?: boolean) => void }} props */
function OfferForm({ onDone }) {
  const { t } = useT('entraide');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!category || !area) return;
    try { await citizenApi.entraideAction({ action: 'offer_create', category, area, ...(note.trim() ? { note: note.trim() } : {}) }); setCategory(''); setArea(''); setNote(''); onDone(t('entraide:offer.created', 'Votre offre est visible, sans votre pseudonyme.')); }
    catch (err) { onDone(fail(err, t), true); }
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="entraide-offer-form" noValidate>
      <h3 className="font-semibold text-slate-900">{t('entraide:offer.new', 'Proposer un coup de main')}</h3>
      <div>
        <label htmlFor="entraide-offer-category" className="block text-sm font-semibold text-slate-900">{t('entraide:field.category', 'Type d’aide')}</label>
        <select id="entraide-offer-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('entraide:field.choose', 'Choisir')}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="entraide-offer-area" className="block text-sm font-semibold text-slate-900">{t('entraide:field.area', 'Secteur')}</label>
        <select id="entraide-offer-area" className={field} value={area} onChange={(e) => setArea(e.target.value)} aria-describedby="entraide-offer-area-help">
          <option value="">{t('entraide:field.choose', 'Choisir')}</option>
          {AREAS.map((a) => <option key={a} value={a}>{areaLabel(a, t)}</option>)}
        </select>
        <p id="entraide-offer-area-help" className="text-xs text-slate-700">{t('entraide:field.area_help', 'Un quartier ou une commune seulement : jamais votre adresse.')}</p>
      </div>
      <NoteField id="entraide-offer-note" value={note} onChange={setNote} />
      <Button type="submit" disabled={!category || !area}>{t('entraide:offer.submit', 'Publier mon offre')}</Button>
    </form>
  );
}

export default function CompteEntraide() {
  const { t } = useT('entraide');
  const [state, setState] = useState({ loading: true, error: '', closed: false, data: null });
  const [message, setMessage] = useState({ text: '', error: false });
  const [pseudonym, setPseudonym] = useState('');
  const [charter, setCharter] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await citizenApi.myEntraide();
      setState({ loading: false, error: '', closed: r.available === false, data: r });
    } catch (err) {
      setState({ loading: false, closed: err.status === 503, error: err.status === 401 ? t('entraide:login_required', 'Connectez-vous pour participer à l’entraide.') : err.status === 503 ? '' : err.message, data: null });
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const done = (text, error = false) => { setMessage({ text, error }); load(); };
  const action = async (body, ok) => { try { await citizenApi.entraideAction(body); done(ok); } catch (e) { done(fail(e, t), true); } };
  const title = t('entraide:title', 'Entraide');
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('entraide:loading', 'Chargement…')}</div>;
  const d = state.data; const m = d?.member;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-entraide">
      <SEO title={title} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-700">{t('entraide:intro', 'Des coups de main pratiques entre personnes majeures, sous un pseudonyme. Pas de messagerie : une adresse e-mail n’est montrée que si vous le choisissez, après l’accord des deux personnes.')}</p>
      <SafetyGuidance />
      {state.closed && <p role="status" data-testid="entraide-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('entraide:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera seulement après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>}
      <div aria-live="polite" role="status">{message.text && <p className={`rounded-md border p-3 ${message.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}</div>
      {d && !state.closed && !m && (
        <form className={box} data-testid="entraide-join-form" noValidate onSubmit={(e) => { e.preventDefault(); if (pseudonym.trim().length >= 3 && charter) action({ action: 'join', pseudonym: pseudonym.trim(), charter: true, charterVersion: CHARTER_VERSION }, t('entraide:join.done', 'Bienvenue dans l’entraide.')); }}>
          <h2 className="text-lg font-semibold text-slate-900">{t('entraide:join.title', 'Rejoindre l’entraide')}</h2>
          <p className="text-sm text-slate-700">{t('entraide:join.adult', 'Réservé aux personnes de 18 ans ou plus.')}</p>
          <label htmlFor="entraide-pseudonym" className="block text-sm font-semibold text-slate-900">{t('entraide:join.label', 'Pseudonyme')}</label>
          <p id="entraide-pseudonym-help" className="text-sm text-slate-700">{t('entraide:join.help', 'Le seul nom montré, et seulement après l’accord des deux personnes. Ni votre nom, ni votre adresse e-mail, ni le pseudonyme de vos histoires. Il ne pourra pas être modifié.')}</p>
          <input id="entraide-pseudonym" type="text" autoComplete="off" maxLength={24} value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} aria-describedby="entraide-pseudonym-help" className={`${field} max-w-sm`} />
          <CharterText />
          <label className="flex items-start gap-2 text-sm text-slate-900" data-testid="entraide-charter-consent">
            <input type="checkbox" checked={charter} onChange={(e) => setCharter(e.target.checked)} className="mt-1" />
            <span>{t('entraide:join.charter', 'J’ai lu la charte de l’entraide et je m’engage à la respecter.')}</span>
          </label>
          <Button type="submit" disabled={pseudonym.trim().length < 3 || !charter}>{t('entraide:join.submit', 'Rejoindre l’entraide')}</Button>
        </form>
      )}
      {m && (
        <>
          <section aria-labelledby="entraide-member" className={box}>
            <h2 id="entraide-member" className="text-lg font-semibold text-slate-900">{t('entraide:member.title', 'Votre pseudonyme')}</h2>
            <p className="text-slate-900" data-testid="entraide-pseudonym">{m.pseudonym}</p>
            {m.status === 'suspended' && <p role="alert" data-testid="entraide-suspended" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900">{t('entraide:member.suspended', 'Votre participation est suspendue par la modération. Motif : {{r}}', { r: reasonLabel(m.suspensionReason, t) })}</p>}
            {!m.charterCurrent && (
              <form className="space-y-2" noValidate onSubmit={(e) => { e.preventDefault(); if (charter) action({ action: 'accept_charter', charter: true, charterVersion: CHARTER_VERSION }, t('entraide:charter.accepted', 'Charte acceptée.')); }}>
                <p className="text-sm text-slate-900">{t('entraide:charter.changed', 'La charte a changé : lisez-la et acceptez-la de nouveau pour continuer.')}</p>
                <CharterText />
                <label className="flex items-start gap-2 text-sm text-slate-900"><input type="checkbox" checked={charter} onChange={(e) => setCharter(e.target.checked)} className="mt-1" /><span>{t('entraide:join.charter', 'J’ai lu la charte de l’entraide et je m’engage à la respecter.')}</span></label>
                <Button type="submit" size="sm" disabled={!charter}>{t('entraide:charter.accept', 'Accepter la charte')}</Button>
              </form>
            )}
            <p className="text-sm text-slate-700">{t('entraide:member.leave_help', 'Quitter l’entraide efface vos offres, vos demandes, les adresses communiquées, vos signalements et vos blocages.')}</p>
            {!confirmLeave ? <Button type="button" size="sm" variant="outline" onClick={() => setConfirmLeave(true)}>{t('entraide:member.leave', 'Quitter l’entraide')}</Button> : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="destructive" onClick={() => { setConfirmLeave(false); action({ action: 'leave' }, t('entraide:member.left', 'Vous avez quitté l’entraide : tout a été effacé.')); }}>{t('entraide:member.leave_confirm', 'Confirmer : quitter et tout effacer')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>{t('entraide:cancel', 'Annuler')}</Button>
              </div>
            )}
          </section>
          {m.status === 'active' && m.charterCurrent && <Browse onDone={done} />}
          <section aria-labelledby="entraide-my-offers" className={box}>
            <h2 id="entraide-my-offers" className="text-lg font-semibold text-slate-900">{t('entraide:offer.title', 'Mes offres')}</h2>
            {d.offers.length > 0 && (
              <ul className="space-y-2" data-testid="entraide-my-offers-list">
                {d.offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3">
                    <span className="text-sm text-slate-900">{categoryLabel(o.category, t)} — {areaLabel(o.area, t)} — {offerStatusLabel(o.status, t)}</span>
                    {o.status === 'open' && <Button type="button" size="sm" variant="outline" onClick={() => action({ action: 'offer_pause', id: o.id }, t('entraide:offer.paused', 'Offre en pause.'))}>{t('entraide:offer.pause', 'Mettre en pause')}</Button>}
                    {o.status === 'paused' && <Button type="button" size="sm" variant="outline" onClick={() => action({ action: 'offer_reopen', id: o.id }, t('entraide:offer.reopened', 'Offre de nouveau visible.'))}>{t('entraide:offer.reopen', 'Rendre visible')}</Button>}
                    {o.status !== 'closed' && <Button type="button" size="sm" variant="destructive" onClick={() => action({ action: 'offer_close', id: o.id }, t('entraide:offer.closed', 'Offre fermée ; les demandes en cours sont terminées.'))}>{t('entraide:offer.close', 'Fermer')}</Button>}
                  </li>
                ))}
              </ul>
            )}
            {m.status === 'active' && m.charterCurrent && <OfferForm onDone={done} />}
          </section>
          {d.received.length > 0 && (
            <section aria-labelledby="entraide-received" className="space-y-2">
              <h2 id="entraide-received" className="text-lg font-semibold text-slate-900">{t('entraide:received.title', 'Demandes reçues')}</h2>
              <ul className="space-y-3" data-testid="entraide-received">{d.received.map((r) => <RequestCard key={r.id} r={r} side="received" onDone={done} />)}</ul>
            </section>
          )}
          {d.sent.length > 0 && (
            <section aria-labelledby="entraide-sent" className="space-y-2">
              <h2 id="entraide-sent" className="text-lg font-semibold text-slate-900">{t('entraide:sent.title', 'Mes demandes')}</h2>
              <ul className="space-y-3" data-testid="entraide-sent">{d.sent.map((r) => <RequestCard key={r.id} r={r} side="sent" onDone={done} />)}</ul>
            </section>
          )}
          {d.blocks.length > 0 && (
            <section aria-labelledby="entraide-blocks" className={box}>
              <h2 id="entraide-blocks" className="text-lg font-semibold text-slate-900">{t('entraide:blocks.title', 'Personnes bloquées')}</h2>
              <ul className="space-y-2">
                {d.blocks.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-900">{t('entraide:blocks.item', 'Blocage du {{d}}', { d: formatDate(b.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }) })}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => action({ action: 'unblock', id: b.id }, t('entraide:blocks.lifted', 'Blocage levé.'))}>{t('entraide:blocks.lift', 'Lever le blocage')}</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
