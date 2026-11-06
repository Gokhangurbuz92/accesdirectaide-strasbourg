// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { ListSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { proRdvClient } from '@/api/pro-rdv-client';
import { formatDate, useT } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { parisWallValue, parisWallToIso } from '@/lib/parisCalendar';

// R47: the fields are Paris wall time (as every time of the agenda), not the device's time zone
const toDateTimeLocalValue = (raw) => (raw ? parisWallValue(raw) : '');
const toIsoFromDateTimeLocal = (localValue) => parisWallToIso(localValue);

function formatDateTime(raw) {
  if (!raw) return '-';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return '-';
  // in the interface language (French: unchanged), Paris time
  return formatDate(date, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }) || '-';
}

export default function ProRdvAbsences() {
  const { t } = useT('pro');
  const fr = useFrAttrs();   // R47: the reason the team wrote stays as written (French: lang="fr" outside French)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [overlap, setOverlap] = useState([]);   // R12 (B11): appointments already booked inside the new absence
  const [editingId, setEditingId] = useState('');
  // R24 (owner decision R18.5): every member records their own absence; the administrator or a delegated member also closes the structure or records a colleague's
  const [canManageOthers, setCanManageOthers] = useState(false);
  const [members, setMembers] = useState([]);
  const [target, setTarget] = useState('structure');
  const [form, setForm] = useState({
    startAt: '',
    endAt: '',
    reason: '',
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await proRdvClient.timeoff.list();
      setItems(Array.isArray(response?.items) ? response.items : []);
      setCanManageOthers(response?.canManageOthers === true);
      setMembers(Array.isArray(response?.members) ? response.members : []);
    } catch {
      setError(t('pro:rdv_absences.load_error', 'Impossible de charger les absences.'));
    } finally {
      setLoading(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const resetForm = () => {
    setEditingId('');
    setForm({ startAt: '', endAt: '', reason: '' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);

    // R7: an empty or inverted range is said as such before any request (it read « Impossible de sauvegarder » because the conversion threw without a status)
    const startMs = Date.parse(form.startAt); const endMs = Date.parse(form.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setError(t('pro:rdv_absences.range_inverted', 'Intervalle invalide : la fin doit être après le début.')); setSaving(false); return;
    }
    const payload = {
      startAt: toIsoFromDateTimeLocal(form.startAt),
      endAt: toIsoFromDateTimeLocal(form.endAt),
      reason: form.reason.trim(),
    };
    if (!editingId && canManageOthers) {
      if (target === 'structure') payload.scope = 'structure';
      else { payload.scope = 'member'; if (target !== 'self') payload.proUserId = target; }
    }

    try {
      if (editingId) {
        await proRdvClient.timeoff.update(editingId, payload);
      } else {
        const created = await proRdvClient.timeoff.create(payload);
        setOverlap(Array.isArray(created?.overlappingAppointments) ? created.overlappingAppointments : []);
      }
      resetForm();
      await loadItems();
    } catch (requestError) {
      const status = Number(requestError?.status || 0);
      setError(status === 400 ? t('pro:rdv_absences.range_invalid', 'Intervalle invalide.')
        : status === 403 ? t('pro:rdv_absences.forbidden', 'Seuls l’administrateur ou un membre désigné pour gérer le planning peuvent fermer la structure ou modifier l’absence d’un collègue.')
        : t('pro:rdv_absences.save_error', 'Impossible de sauvegarder l\'absence.'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({
      startAt: toDateTimeLocalValue(item.startAt),
      endAt: toDateTimeLocalValue(item.endAt),
      reason: item.reason || '',
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('pro:rdv_absences.confirm_delete', 'Supprimer cette absence ?'))) return;
    setError('');
    try {
      await proRdvClient.timeoff.remove(id);
      await loadItems();
    } catch {
      setError(t('pro:rdv_absences.delete_error', 'Impossible de supprimer cette absence.'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? t('pro:rdv_absences.edit_title', 'Modifier une absence') : t('pro:rdv_absences.add_title', 'Ajouter une absence')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-slate-600" data-testid="pro-timeoff-scope-help">
            {canManageOthers
              ? t('pro:rdv_absences.help_manager', 'Vous gérez le planning de la structure : une fermeture de la structure retire les créneaux proposés au public ; l’absence d’un membre ne ferme pas la structure.')
              : t('pro:rdv_absences.help_member', 'Vous déclarez ici votre propre absence. Seuls l’administrateur ou un membre désigné ferment la structure ou modifient l’absence d’un collègue.')}
          </p>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            {canManageOthers && !editingId ? (
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="timeoff-target">{t('pro:rdv_absences.target', 'Concerne')}</Label>
                <select id="timeoff-target" data-testid="pro-timeoff-target" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" value={target} onChange={(event) => setTarget(event.target.value)}>
                  <option value="structure">{t('pro:rdv_absences.target_structure', 'Toute la structure (fermeture : plus de créneaux en ligne)')}</option>
                  <option value="self">{t('pro:rdv_absences.target_self', 'Moi-même')}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                </select>
              </div>
            ) : null}
            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">{t('pro:rdv_absences.start', 'Début')}</span>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setForm((prev) => ({ ...prev, startAt: event.target.value }))}
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-slate-700">{t('pro:rdv_absences.end', 'Fin')}</span>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) => setForm((prev) => ({ ...prev, endAt: event.target.value }))}
              />
            </label>

            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="timeoff-reason">{t('pro:rdv_absences.reason', 'Raison (optionnel)')}</Label>
              <Input
                id="timeoff-reason"
                value={form.reason}
                onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              />
            </div>

            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingId ? t('pro:rdv_absences.update', 'Mettre à jour') : t('pro:rdv_absences.add', 'Ajouter')}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t('pro:rdv_absences.cancel', 'Annuler')}
                </Button>
              ) : null}
            </div>
          </form>

          {error ? <p className="mt-3 text-sm text-rose-700" role="alert" data-testid="pro-timeoff-error">{error}</p> : null}
          {overlap.length ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="pro-timeoff-overlap">
              <p>{t('pro:rdv_absences.overlap', { count: overlap.length, defaultValue_one: '{{count}} rendez-vous déjà pris pendant cette absence reste maintenu : annulez-les ou déplacez-les depuis l’agenda (la personne sera prévenue).', defaultValue_other: '{{count}} rendez-vous déjà pris pendant cette absence restent maintenus : annulez-les ou déplacez-les depuis l’agenda (la personne sera prévenue).' })}</p>
              <ul className="mt-1 list-disc pl-5">{overlap.map((a) => <li key={a.id}>{formatDate(new Date(a.startAt), { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' })}</li>)}</ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('pro:rdv_absences.list_title', 'Absences configurées')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ListSkeleton count={3} />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Pencil className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-600">
                {t('pro:rdv_absences.empty', 'Aucune absence configurée.')}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {t('pro:rdv_absences.empty_hint', 'Utilisez le formulaire ci-dessus pour déclarer vos indisponibilités.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-slate-900">
                      {formatDateTime(item.startAt)} - {formatDateTime(item.endAt)}
                    </p>
                    <p className="text-slate-600" {...(item.reason ? fr : {})}>{item.reason || t('pro:rdv_absences.no_reason', 'Sans raison précisée')}</p>
                    <p className="text-xs text-slate-700" data-testid="pro-timeoff-owner">
                      {item.scope === 'structure' ? t('pro:rdv_absences.owner_structure', 'Fermeture de toute la structure') : item.mine ? t('pro:rdv_absences.owner_mine', 'Mon absence') : t('pro:rdv_absences.owner_member', 'Absence de {{who}}', { who: item.memberEmail || t('pro:rdv_absences.a_member', 'un membre') })}
                    </p>
                  </div>
                  {item.canEdit === false ? null : <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)}>
                      <Pencil className="mr-1 h-4 w-4" />
                      {t('pro:rdv_absences.edit', 'Modifier')}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => handleDelete(item.id)}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t('pro:rdv_absences.delete', 'Supprimer')}
                    </Button>
                  </div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
