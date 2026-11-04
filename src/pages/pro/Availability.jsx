// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { GridSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { proRdvClient } from '@/api/pro-rdv-client';
import { findInvalidRange } from '@/lib/availabilityRanges';
import i18n, { useT } from '@/i18n';
import { Trans } from 'react-i18next';
import MemberHoursPanel from '@/components/rdv/MemberHoursPanel.jsx';

const daysOf = (t) => [
  { key: 'mon', label: t('pro:availability.day_mon', 'Lundi') },
  { key: 'tue', label: t('pro:availability.day_tue', 'Mardi') },
  { key: 'wed', label: t('pro:availability.day_wed', 'Mercredi') },
  { key: 'thu', label: t('pro:availability.day_thu', 'Jeudi') },
  { key: 'fri', label: t('pro:availability.day_fri', 'Vendredi') },
  { key: 'sat', label: t('pro:availability.day_sat', 'Samedi') },
  { key: 'sun', label: t('pro:availability.day_sun', 'Dimanche') },
];

/** The message the professional should read: the server's own sentence when it sent one, a neutral one otherwise. */
function messageOf(t, err, fallback) {
  const fromServer = err && err.payload && typeof err.payload.error === 'string' ? err.payload.error : '';
  if (err && err.status === 401) return t('pro:availability.session_expired', 'Votre session a expiré. Reconnectez-vous puis réessayez.');
  if (err && err.status === 429) return t('pro:availability.too_many', 'Trop de demandes. Patientez un instant puis réessayez.');
  return fromServer && err.status && err.status < 500 ? fromServer : fallback;
}

export default function ProAvailability() {
  const { t } = useT('pro');
  const DAYS = daysOf(t);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [slots, setSlots] = useState({});
  const [canEdit, setCanEdit] = useState(true);   // R24 (owner decision R18.5): the administrator or a delegated member changes the hours

  const load = useCallback(() => {
    let mounted = true;
    setLoading(true);
    setLoadError('');
    setError('');
    proRdvClient.availability
      .get()
      .then((response) => {
        if (!mounted) return;
        setSlots(response?.slots_json && typeof response.slots_json === 'object' ? response.slots_json : {});
        setCanEdit(response?.canEdit !== false);
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError(messageOf(t, err, t('pro:availability.load_failed', 'Impossible de charger les disponibilités.')));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time

  useEffect(() => load(), [load]);

  const touch = () => {
    setSaved(false);
    setError('');
  };

  const addSlot = (dayKey) => {
    touch();
    setSlots((prev) => {
      const next = { ...prev };
      const daySlots = Array.isArray(next[dayKey]) ? [...next[dayKey]] : [];
      daySlots.push('09:00-12:00');
      next[dayKey] = daySlots;
      return next;
    });
  };

  const updateSlot = (dayKey, index, value) => {
    touch();
    setSlots((prev) => {
      const next = { ...prev };
      const daySlots = Array.isArray(next[dayKey]) ? [...next[dayKey]] : [];
      daySlots[index] = value;
      next[dayKey] = daySlots;
      return next;
    });
  };

  const removeSlot = (dayKey, index) => {
    touch();
    setSlots((prev) => {
      const next = { ...prev };
      const daySlots = Array.isArray(next[dayKey]) ? [...next[dayKey]] : [];
      daySlots.splice(index, 1);
      next[dayKey] = daySlots;
      return next;
    });
  };

  const handleSave = async () => {
    setSaved(false);
    for (const day of DAYS) {
      const problem = findInvalidRange(slots[day.key] || [], day.label);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const response = await proRdvClient.availability.replace({
        slots_json: slots,
        timezone: 'Europe/Paris',
      });
      // show what the server really stored (blank rows are dropped), not what was typed
      if (response?.slots_json && typeof response.slots_json === 'object') setSlots(response.slots_json);
      setSaved(true);
    } catch (err) {
      setError(messageOf(t, err, t('pro:availability.save_failed', 'Impossible d\'enregistrer les disponibilités.')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <GridSkeleton cols={4} rows={7} />;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900">{t('pro:availability.title', 'Disponibilités')}</h2>
        <div role="alert" data-testid="availability-load-error" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{loadError}</div>
        <Button type="button" onClick={load} data-testid="availability-retry">{t('pro:availability.retry', 'Réessayer')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="availability-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">{t('pro:availability.title', 'Disponibilités')}</h2>
        {canEdit ? (
          <Button onClick={handleSave} disabled={saving} data-testid="availability-save">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {t('pro:availability.save', 'Enregistrer')}
          </Button>
        ) : null}
      </div>

      {canEdit ? null : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800" data-testid="availability-readonly">
          {t('pro:availability.readonly', 'Horaires d’ouverture de la structure, en lecture seule : seuls l’administrateur ou un membre qu’il a désigné pour gérer le planning peuvent les modifier. Vous pouvez déclarer vos propres absences dans l’onglet Absences.')}
        </p>
      )}

      <p className="text-sm text-slate-600">
        <Trans i18n={i18n} i18nKey="pro:availability.format_hint" defaults="Format attendu : <0>HH:MM-HH:MM</0> (par exemple <1>09:00-12:00</1>). Les fermetures de la structure (onglet Absences) bloquent les créneaux ; l’absence d’un seul membre ne ferme pas la structure." components={[<code key="0" />, <code key="1" />]} />
      </p>

      <div aria-live="polite" role="status" data-testid="availability-status">
        {saved ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('pro:availability.saved', 'Disponibilités enregistrées.')}</p> : null}
      </div>

      {error ? (
        <div role="alert" data-testid="availability-error" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-4">
        {DAYS.map((day) => (
          <Card key={day.key}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
              <div className="w-32 pt-1 text-sm font-semibold text-slate-700">{day.label}</div>
              <div className="flex-1 space-y-2">
                {(slots[day.key] || []).map((slot, idx) => (
                  <div key={`${day.key}-${idx}`} className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-700" aria-hidden="true" />
                    <Input
                      value={slot}
                      readOnly={!canEdit}
                      onChange={(event) => updateSlot(day.key, idx, event.target.value)}
                      className="max-w-[200px]"
                      aria-label={t('pro:availability.slot_label', '{{day}}, plage {{n}} (HH:MM-HH:MM)', { day: day.label, n: idx + 1 })}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    {canEdit ? <Button type="button" variant="ghost" size="icon" onClick={() => removeSlot(day.key, idx)} aria-label={t('pro:availability.slot_remove', 'Supprimer la plage {{n}} du {{day}}', { n: idx + 1, day: day.label.toLowerCase() })}>
                      <Trash2 className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    </Button> : null}
                  </div>
                ))}
                {(!slots[day.key] || slots[day.key].length === 0) && (
                  <p className="text-sm italic text-slate-600">{t('pro:availability.closed', 'Fermé')}</p>
                )}
              </div>
              {canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => addSlot(day.key)} aria-label={t('pro:availability.slot_add', 'Ajouter une plage le {{day}}', { day: day.label.toLowerCase() })}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('pro:availability.add', 'Ajouter')}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* R42-CDGG: each professional's own weekly hours and dated exceptions (inside the structure's opening hours) */}
      <Card>
        <CardContent className="p-4">
          <MemberHoursPanel />
        </CardContent>
      </Card>
    </div>
  );
}
