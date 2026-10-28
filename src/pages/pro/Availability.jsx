// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { GridSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { proRdvClient } from '@/api/pro-rdv-client';
import { findInvalidRange } from '@/lib/availabilityRanges';

const DAYS = [
  { key: 'mon', label: 'Lundi' },
  { key: 'tue', label: 'Mardi' },
  { key: 'wed', label: 'Mercredi' },
  { key: 'thu', label: 'Jeudi' },
  { key: 'fri', label: 'Vendredi' },
  { key: 'sat', label: 'Samedi' },
  { key: 'sun', label: 'Dimanche' },
];

/** The message the professional should read: the server's own sentence when it sent one, a neutral one otherwise. */
function messageOf(err, fallback) {
  const fromServer = err && err.payload && typeof err.payload.error === 'string' ? err.payload.error : '';
  if (err && err.status === 401) return 'Votre session a expiré. Reconnectez-vous puis réessayez.';
  if (err && err.status === 429) return 'Trop de demandes. Patientez un instant puis réessayez.';
  return fromServer && err.status && err.status < 500 ? fromServer : fallback;
}

export default function ProAvailability() {
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
        setLoadError(messageOf(err, 'Impossible de charger les disponibilités.'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
      setError(messageOf(err, "Impossible d'enregistrer les disponibilités."));
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
        <h2 className="text-xl font-bold text-slate-900">Disponibilités</h2>
        <div role="alert" data-testid="availability-load-error" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{loadError}</div>
        <Button type="button" onClick={load} data-testid="availability-retry">Réessayer</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="availability-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Disponibilités</h2>
        {canEdit ? (
          <Button onClick={handleSave} disabled={saving} data-testid="availability-save">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
        ) : null}
      </div>

      {canEdit ? null : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800" data-testid="availability-readonly">
          Horaires d’ouverture de la structure, en lecture seule : seuls l’administrateur ou un membre qu’il a désigné pour gérer le planning peuvent les modifier. Vous pouvez déclarer vos propres absences dans l’onglet Absences.
        </p>
      )}

      <p className="text-sm text-slate-600">
        Format attendu : <code>HH:MM-HH:MM</code> (par exemple <code>09:00-12:00</code>). Les fermetures de la structure (onglet Absences) bloquent les créneaux ; l’absence d’un seul membre ne ferme pas la structure.
      </p>

      <div aria-live="polite" role="status" data-testid="availability-status">
        {saved ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Disponibilités enregistrées.</p> : null}
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
                      aria-label={`${day.label}, plage ${idx + 1} (HH:MM-HH:MM)`}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    {canEdit ? <Button type="button" variant="ghost" size="icon" onClick={() => removeSlot(day.key, idx)} aria-label={`Supprimer la plage ${idx + 1} du ${day.label.toLowerCase()}`}>
                      <Trash2 className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    </Button> : null}
                  </div>
                ))}
                {(!slots[day.key] || slots[day.key].length === 0) && (
                  <p className="text-sm italic text-slate-600">Fermé</p>
                )}
              </div>
              {canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => addSlot(day.key)} aria-label={`Ajouter une plage le ${day.label.toLowerCase()}`}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Ajouter
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
