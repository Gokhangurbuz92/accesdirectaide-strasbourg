// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ListSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { proRdvClient } from '@/api/pro-rdv-client';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} dateValue
 * @param {'start' | 'end'} kind
 * @returns {string}
 */
function toDayIso(dateValue, kind) {
  const normalized = String(dateValue || '').trim();
  if (!normalized) return '';
  const suffix = kind === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
  return `${normalized}${suffix}`;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function formatSlot(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

export default function ProRdvNew() {
  const navigate = useNavigate();
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [services, setServices] = useState([]);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [form, setForm] = useState({
    serviceId: '',
    fromDate: todayIsoDate(),
    toDate: todayIsoDate(),
    beneficiaryName: '',
    beneficiaryPhone: '',
    notes: '',
    mode: 'IN_PERSON',
    personConsent: false,
  });

  useEffect(() => {
    let mounted = true;
    setLoadingServices(true);
    setError('');

    proRdvClient.services
      .list()
      .then((items) => {
        if (!mounted) return;
        const activeServices = Array.isArray(items) ? items.filter((item) => item.isActive !== false) : [];
        setServices(activeServices);
        setForm((prev) => (prev.serviceId || !activeServices[0]?.id ? prev : { ...prev, serviceId: activeServices[0].id }));
      })
      .catch(() => {
        if (!mounted) return;
        setError('Impossible de charger les services.');
      })
      .finally(() => {
        if (mounted) setLoadingServices(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.serviceId) || null,
    [services, form.serviceId],
  );

  const handleLoadSlots = async () => {
    setError('');
    setSuccessMessage('');
    setSelectedSlot(null);
    if (!form.serviceId) {
      setError('Selectionnez un service.');
      return;
    }
    if (!form.fromDate || !form.toDate) {
      setError('Selectionnez une periode de recherche.');
      return;
    }

    const from = toDayIso(form.fromDate, 'start');
    const to = toDayIso(form.toDate, 'end');
    if (!from || !to) {
      setError('Periode invalide.');
      return;
    }

    setLoadingSlots(true);
    try {
      const response = await proRdvClient.slots.list({
        serviceId: form.serviceId,
        from,
        to,
        mode: form.mode,
      });
      const nextSlots = Array.isArray(response?.slots) ? response.slots : [];
      setSlots(nextSlots);
      if (nextSlots.length === 0) {
        setError('Aucun creneau disponible sur cette periode.');
      }
    } catch (requestError) {
      const status = Number(requestError?.status || 0);
      setError(status === 400 ? 'Parametres invalides pour la recherche de creneaux.' : 'Impossible de charger les creneaux.');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleCreateAppointment = async () => {
    setError('');
    setSuccessMessage('');

    if (!selectedSlot) {
      setError('Selectionnez un creneau.');
      return;
    }
    if (!form.beneficiaryName.trim()) {
      setError('Le nom du beneficiaire est requis.');
      return;
    }
    if (!form.personConsent) {
      setError('Confirmez que la personne est d’accord pour ce rendez-vous et pour l’enregistrement de ses coordonnées.');
      return;
    }

    setSaving(true);
    try {
      await proRdvClient.appointments.create({
        serviceId: form.serviceId,
        startAt: selectedSlot.startAt,
        beneficiaryName: form.beneficiaryName.trim(),
        beneficiaryPhone: form.beneficiaryPhone.trim() || undefined,
        notes: form.notes.trim() || undefined,
        mode: form.mode,
        personConsent: true,
      });
      setSuccessMessage('Rendez-vous cree avec succes.');
      setTimeout(() => navigate('/pro/rdv/agenda'), 500);
    } catch (requestError) {
      const status = Number(requestError?.status || 0);
      if (status === 409) {
        setError("Ce creneau n'est plus disponible. Rechargez les creneaux.");
      } else {
        setError('Impossible de creer le rendez-vous.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau rendez-vous</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Service</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.serviceId}
              onChange={(event) => setForm((prev) => ({ ...prev, serviceId: event.target.value }))}
              disabled={loadingServices}
            >
              <option value="">Selectionner</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.durationMinutes} min)
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Date de debut</span>
            <Input
              type="date"
              value={form.fromDate}
              onChange={(event) => setForm((prev) => ({ ...prev, fromDate: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Date de fin</span>
            <Input
              type="date"
              value={form.toDate}
              onChange={(event) => setForm((prev) => ({ ...prev, toDate: event.target.value }))}
            />
          </label>

          <div className="flex items-end">
            <Button type="button" onClick={handleLoadSlots} disabled={loadingServices || loadingSlots || !form.serviceId}>
              {loadingSlots ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Charger les creneaux
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Creneaux disponibles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingSlots ? (
            <ListSkeleton count={4} title={false} />
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-600">Aucun creneau charge.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {slots.map((slot) => {
                const active = selectedSlot?.startAt === slot.startAt;
                return (
                  <button
                    key={slot.startAt}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${active ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'
                      }`}
                  >
                    <div className="font-medium">{formatSlot(slot.startAt)}</div>
                    <div className="text-xs text-slate-700">Fin: {formatSlot(slot.endAt)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Informations beneficiaire</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="beneficiary-name">Nom</Label>
              <Input
                id="beneficiary-name"
                value={form.beneficiaryName}
                onChange={(event) => setForm((prev) => ({ ...prev, beneficiaryName: event.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="beneficiary-phone">Telephone (optionnel)</Label>
              <Input
                id="beneficiary-phone"
                value={form.beneficiaryPhone}
                onChange={(event) => setForm((prev) => ({ ...prev, beneficiaryPhone: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="beneficiary-notes">Notes (optionnel)</Label>
            <Textarea
              id="beneficiary-notes"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>

          {selectedService ? (
            <p className="text-xs text-slate-700">
              Service selectionne: {selectedService.name} ({selectedService.durationMinutes} min)
            </p>
          ) : null}

          {selectedService ? (
            <fieldset className="space-y-1 text-sm" data-testid="pro-new-mode">
              <legend className="font-medium text-slate-800">Modalité</legend>
              {(Array.isArray(selectedService.modes) && selectedService.modes.length ? selectedService.modes : ['IN_PERSON']).map((m) => (
                <label key={m} className="mr-4 inline-flex items-center gap-2">
                  <input type="radio" name="pro-new-mode" value={m} data-testid={`pro-new-mode-${m}`} checked={form.mode === m} onChange={() => { setForm((prev) => ({ ...prev, mode: m })); setSlots([]); setSelectedSlot(null); }} />
                  {m === 'VIDEO' ? 'À distance (visio)' : 'En présentiel'}
                </label>
              ))}
            </fieldset>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" data-testid="pro-new-consent" checked={form.personConsent} onChange={(event) => setForm((prev) => ({ ...prev, personConsent: event.target.checked }))} />
            <span>La personne est d’accord pour ce rendez-vous et pour que son nom et son téléphone soient enregistrés pour ce rendez-vous.</span>
          </label>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}

          <Button type="button" onClick={handleCreateAppointment} disabled={saving || !selectedSlot}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirmer le rendez-vous
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
