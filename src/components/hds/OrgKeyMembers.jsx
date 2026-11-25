// @ts-nocheck -- the shadcn alert-dialog primitives (src/components/ui/alert-dialog.jsx) are untyped, like src/pages/pro/PartagesChiffres.jsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ToneChip } from '@/components/ui/Tone';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TONES } from '@/design/categoryTone';
import { useT } from '@/i18n';

/**
 * R5 — « Membres qui ont une clé » on /pro/partages-chiffres (structure administrator only): each member holding a personal key at the HDS service, whether
 * they can open the active organisation key, whether their ADA Pro account is deactivated, and « Retirer l'accès » (DELETE /v1/pro/org-keys/members, through
 * the professional ticket) behind a confirmation that states the effect and recommends « Changer la clé » afterwards.
 * `members` comes from GET /v1/pro/keys (administrators); an HDS service deployed before R5 does not send it — then every member of the team list is offered
 * (the withdrawal of a member without a key removes nothing).
 * @param {{ members?: Array<{ memberRef: string, hasAccess: boolean }> | null, self: string, team: Array<{ id: string, email?: string, status?: string }> | null,
 *   busy: boolean, onRemove: (memberRef: string) => void }} props
 */
export default function OrgKeyMembers({ members, self, team, busy, onRemove }) {
  const { t } = useT('pro');
  const [confirm, setConfirm] = useState(/** @type {{ memberRef: string, label: string } | null} */ (null));
  const byId = new Map((team || []).map((u) => [String(u.id), u]));
  /** @type {Array<{ memberRef: string, hasAccess: boolean | null }>} */
  const rows = (Array.isArray(members) ? members : (team || []).map((u) => ({ memberRef: String(u.id), hasAccess: null }))).filter((m) => m.memberRef !== self);
  const label = (/** @type {string} */ ref) => byId.get(ref)?.email || t('pro:hds.member_unknown', 'Compte supprimé ou inconnu');
  return (
    <div className="space-y-2" data-testid="pro-hds-members">
      <h3 className="font-semibold text-slate-900">{t('pro:hds.members_title', 'Membres qui ont une clé personnelle')}</h3>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((m) => {
            const user = byId.get(m.memberRef);
            const disabled = Boolean(user && user.status !== 'active');
            return (
              <li key={m.memberRef} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm" data-testid="pro-hds-member">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-all text-slate-900">{label(m.memberRef)}</span>
                  {disabled ? <ToneChip tone={TONES.red}>{t('pro:hds.member_disabled', 'Compte désactivé')}</ToneChip> : null}
                  {m.hasAccess === true ? <ToneChip tone={TONES.emerald}>{t('pro:hds.member_has_access', 'Peut ouvrir les dossiers')}</ToneChip> : null}
                  {m.hasAccess === false ? <ToneChip tone={TONES.amber}>{t('pro:hds.member_no_access', 'Accès pas encore donné')}</ToneChip> : null}
                </span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ memberRef: m.memberRef, label: label(m.memberRef) })}
                  data-testid="pro-hds-member-remove">{t('pro:hds.member_remove', 'Retirer l’accès')}</Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-slate-700">{t('pro:hds.members_empty', 'Aucun autre membre n’a encore créé sa clé personnelle.')}</p>}
      <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent data-testid="pro-hds-member-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pro:hds.member_remove_title', 'Retirer l’accès de {{who}} ?', { who: confirm?.label || '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('pro:hds.member_remove_effect', 'Ce membre ne pourra plus ouvrir les dossiers partagés avec la clé de la structure, et sa clé personnelle est supprimée (il devra en créer une nouvelle si un administrateur lui redonne l’accès). Il a pu garder une copie de la clé dans son navigateur : changez ensuite la clé de la structure avec « Changer la clé de la structure ».')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('pro:hds.cancel', 'Annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const ref = confirm?.memberRef; setConfirm(null); if (ref) onRemove(ref); }} data-testid="pro-hds-member-confirm-remove">
              {t('pro:hds.member_remove_confirm', 'Retirer l’accès')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
