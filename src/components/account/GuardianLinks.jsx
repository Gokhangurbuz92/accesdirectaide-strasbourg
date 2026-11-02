import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { useT } from '@/i18n';

const statusLabels = (/** @type {(k: string, d: string) => string} */ t) => ({
  DECLARED: t('compte:guardian.status.declared', 'En attente : le représentant légal doit accepter depuis son espace.'),
  EMAIL_VERIFIED: t('compte:guardian.status.email_verified', 'Accepté par le représentant légal. La vérification renforcée n’est pas encore faite.'),
  STRONGER_VERIFICATION_REQUIRED: t('compte:guardian.status.stronger_required', 'Vérification renforcée demandée : une personne habilitée doit la faire.'),
  VERIFIED_STRONG: t('compte:guardian.status.verified', 'Lien vérifié.'),
});

/**
 * C05 (R30) — « Représentant légal » in the account space: a minor names a guardian by e-mail (the answer is the same whatever the address),
 * the guardian accepts from their own space, either person withdraws the link at any time. Nothing here proves a guardianship: the strong check
 * is made by a verifier with a method the DPO-validated policy names, and until then the link has no effect on the account.
 */
export default function GuardianLinks({ ageBand = null }) {
  const { t } = useT('compte');
  const STATUS = statusLabels(t);
  const [data, setData] = useState(/** @type {any} */ (null));
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  // an unreadable list (outage, older client) shows no card rather than a broken one
  const load = useCallback(() => Promise.resolve().then(() => citizenApi.listGuardians()).then(setData, () => setData({ guardianships: [], error: true })), []);
  useEffect(() => { load(); }, [load]);
  const act = async (/** @type {Record<string, unknown>} */ body, /** @type {string} */ ok) => {
    setNote('');
    try { const out = await citizenApi.guardianAction(body); setNote(out?.message || ok); await load(); } catch (e) { setNote(/** @type {any} */ (e)?.message || t('compte:guardian.action_failed', 'Action impossible pour le moment.')); }
  };
  if (!data || data.error) return null;
  const mine = data.guardianships || [];
  const asGuardian = mine.filter((/** @type {any} */ g) => g.role === 'guardian');
  const asMinor = mine.filter((/** @type {any} */ g) => g.role === 'minor');
  if (ageBand !== 'moins-de-18' && asGuardian.length === 0) return null;
  const pendingPolicy = data.policy?.strongVerification !== 'CONFIGURED';
  return (
    <Card data-testid="guardian-links">
      <CardHeader><CardTitle className="text-lg">{t('compte:guardian.representant_legal', 'Représentant légal')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-800">
        <p>
          {t('compte:guardian.les_informations_publiques_restent', 'Les informations publiques restent accessibles à tout âge. Ce lien ne sert qu’aux fonctions de compte réservées aux mineurs accompagnés ;')}
          {' '}{pendingPolicy ? t('compte:guardian.policy_pending', 'la façon de vérifier un représentant légal n’est pas encore fixée, le lien n’a donc pas encore d’effet.') : t('compte:guardian.policy_ready', 'il prend effet une fois vérifié.')}
        </p>
        <div aria-live="polite" role="status">{note ? <p className="rounded-md border border-slate-200 bg-slate-50 p-3">{note}</p> : null}</div>
        {asMinor.map((/** @type {any} */ g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3">
            <span>{g.other || t('compte:guardian.representant_legal', 'Représentant légal')} — {STATUS[/** @type {keyof typeof STATUS} */ (g.status)]}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => act({ action: 'revoke', id: g.id }, t('compte:guardian.removed', 'Lien retiré.'))}>{t('compte:guardian.retirer_lien', 'Retirer ce lien')}</Button>
          </div>
        ))}
        {asGuardian.map((/** @type {any} */ g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3">
            <span>{t('compte:guardian.request_from', 'Demande de {{who}}', { who: g.other || t('compte:guardian.a_minor', 'une personne mineure') })} — {STATUS[/** @type {keyof typeof STATUS} */ (g.status)]}</span>
            <span className="flex flex-wrap gap-2">
              {g.status === 'DECLARED' && <Button type="button" size="sm" onClick={() => act({ action: 'confirm', id: g.id }, t('compte:guardian.accepted', 'Demande acceptée.'))}>{t('compte:guardian.accepte_etre_son_representant', 'J’accepte d’être son représentant légal')}</Button>}
              {g.status === 'EMAIL_VERIFIED' && !pendingPolicy && <Button type="button" size="sm" variant="outline" onClick={() => act({ action: 'request-strong', id: g.id }, t('compte:guardian.verification_requested', 'Vérification demandée.'))}>{t('compte:guardian.demander_verification', 'Demander la vérification')}</Button>}
              <Button type="button" size="sm" variant="outline" onClick={() => act({ action: 'revoke', id: g.id }, t('compte:guardian.removed', 'Lien retiré.'))}>{t('compte:guardian.refuser_retirer', 'Refuser ou retirer')}</Button>
            </span>
          </div>
        ))}
        {ageBand === 'moins-de-18' && asMinor.length < 2 && (
          <form className="flex flex-wrap items-end gap-2" data-testid="guardian-declare" onSubmit={(e) => { e.preventDefault(); act({ action: 'declare', guardianEmail: email.trim() }, ''); setEmail(''); }}>
            <label className="flex flex-col gap-1">
              <span>{t('compte:guardian.adresse_mail_votre_representant', 'Adresse e-mail de votre représentant légal (il doit avoir son propre compte)')}</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-11 rounded-md border border-slate-300 px-3" autoComplete="off" />
            </label>
            <Button type="submit">{t('compte:guardian.envoyer_demande', 'Envoyer la demande')}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
GuardianLinks.propTypes = { ageBand: PropTypes.string };
