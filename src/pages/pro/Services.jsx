// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertTriangle, Edit, ExternalLink, Loader2, Plus, Power, Save, Trash2 } from 'lucide-react';
import { FormSkeleton, ListSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { proRdvClient } from '@/api/pro-rdv-client';

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export default function ProServices() {
  const { user, rdvReadiness } = useOutletContext();
  const canEdit = user?.role === 'STRUCTURE_ADMIN' || user?.role === 'SUPERADMIN';
  const readinessOk = rdvReadiness?.status === 200 && rdvReadiness?.payload?.ok === true;
  const readinessMissingTables = Array.isArray(rdvReadiness?.payload?.missingTables)
    ? rdvReadiness.payload.missingTables
    : [];
  const structureSlug = String(user?.structure?.slug || '').trim();

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsNotice, setSettingsNotice] = useState('');
  const [settingsForm, setSettingsForm] = useState({
    isPublished: false,
    bookingMode: 'IN_PERSON',
    contactEmail: '',
    contactPhone: '',
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    durationMinutes: '30',
    bufferBeforeMinutes: '0',
    bufferAfterMinutes: '0',
    isActive: true,
  });

  const publicRdvUrl = useMemo(() => {
    if (!structureSlug) return '';
    if (typeof window === 'undefined' || !window.location?.origin) {
      return `https://www.accesdirectaide.fr/rdv/${encodeURIComponent(structureSlug)}`;
    }
    return `${window.location.origin}/rdv/${encodeURIComponent(structureSlug)}`;
  }, [structureSlug]);

  const hydrateSettings = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    setSettingsForm({
      isPublished: Boolean(payload.isPublished ?? payload.is_published),
      bookingMode: String(payload.bookingMode || payload.booking_mode || 'IN_PERSON'),
      contactEmail: String(payload.contactEmail || payload.contact_email || ''),
      contactPhone: String(payload.contactPhone || payload.contact_phone || ''),
    });
  };

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await proRdvClient.services.list();
      setServices(Array.isArray(response) ? response : []);
    } catch {
      setError('Impossible de charger les services.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const response = await proRdvClient.settings.get();
      hydrateSettings(response);
    } catch {
      setSettingsError('Impossible de charger les parametres de publication RDV.');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
    fetchSettings();
  }, [fetchServices, fetchSettings]);

  const saveSettings = async (event) => {
    event.preventDefault();
    if (!canEdit) return;

    setSettingsSaving(true);
    setSettingsError('');
    setSettingsNotice('');
    try {
      const payload = {
        isPublished: Boolean(settingsForm.isPublished),
        bookingMode: String(settingsForm.bookingMode || 'IN_PERSON'),
        contactEmail: String(settingsForm.contactEmail || '').trim() || null,
        contactPhone: String(settingsForm.contactPhone || '').trim() || null,
      };

      const updated = await proRdvClient.settings.update(payload);
      hydrateSettings(updated);
      setSettingsNotice('Parametres RDV enregistres.');
    } catch (requestError) {
      if (requestError && typeof requestError === 'object' && requestError.status === 409) {
        setSettingsError('Impossible de publier: la base RDV n est pas prete sur cet environnement.');
      } else {
        setSettingsError('Impossible de sauvegarder les parametres RDV.');
      }
    } finally {
      setSettingsSaving(false);
    }
  };

  const openCreate = () => {
    setEditingService(null);
    setFormData({
      name: '',
      durationMinutes: '30',
      bufferBeforeMinutes: '0',
      bufferAfterMinutes: '0',
      isActive: true,
      modes: ['IN_PERSON'],
    });
    setIsDialogOpen(true);
  };

  const openEdit = (service) => {
    setEditingService(service);
    setFormData({
      name: service.name || '',
      durationMinutes: String(service.durationMinutes || 30),
      bufferBeforeMinutes: String(service.bufferBeforeMinutes || 0),
      bufferAfterMinutes: String(service.bufferAfterMinutes || 0),
      isActive: Boolean(service.isActive),
      modes: Array.isArray(service.modes) && service.modes.length ? service.modes : ['IN_PERSON'],
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      name: String(formData.name || '').trim(),
      durationMinutes: toPositiveInt(formData.durationMinutes, 30),
      bufferBeforeMinutes: toNonNegativeInt(formData.bufferBeforeMinutes, 0),
      bufferAfterMinutes: toNonNegativeInt(formData.bufferAfterMinutes, 0),
      isActive: Boolean(formData.isActive),
      modes: Array.isArray(formData.modes) && formData.modes.length ? formData.modes : ['IN_PERSON'],
    };

    if (!payload.name) {
      setSaving(false);
      setError('Le nom du service est requis.');
      return;
    }

    try {
      if (editingService?.id) {
        await proRdvClient.services.update(editingService.id, payload);
      } else {
        await proRdvClient.services.create(payload);
      }
      setIsDialogOpen(false);
      await fetchServices();
    } catch {
      setError("Impossible d'enregistrer le service.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (service) => {
    try {
      await proRdvClient.services.update(service.id, { isActive: !service.isActive });
      await fetchServices();
    } catch {
      setError('Impossible de changer le statut du service.');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce service ?')) return;
    try {
      await proRdvClient.services.remove(id);
      await fetchServices();
    } catch {
      setError('Suppression impossible (des rendez-vous actifs peuvent exister).');
    }
  };

  return (
    <div className="space-y-6">
      <Card data-testid="pro-rdv-settings-card">
        <CardHeader>
          <CardTitle>Publication de la prise de RDV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* owner usefulness pass: only once the check answered (it flashed while loading), in plain words */}
          {!readinessOk && rdvReadiness?.status != null ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Publication impossible pour l’instant : les rendez-vous ne sont pas encore installés sur ce serveur.</p>
                  {readinessMissingTables.length > 0 ? (
                    <p className="text-xs">Détail technique pour ADA : tables manquantes ({readinessMissingTables.join(', ')}).</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {settingsError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {settingsError}
            </div>
          ) : null}
          {settingsNotice ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {settingsNotice}
            </div>
          ) : null}

          {settingsLoading ? (
            <FormSkeleton fields={3} />
          ) : (
            <form className="space-y-4" onSubmit={saveSettings}>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settingsForm.isPublished}
                  disabled={!canEdit || (!readinessOk && !settingsForm.isPublished)}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, isPublished: event.target.checked }))
                  }
                />
                Publier la prise de RDV en ligne
              </label>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Mode de reservation</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={settingsForm.bookingMode}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, bookingMode: event.target.value }))
                    }
                  >
                    <option value="IN_PERSON">Presentiel</option>
                    <option value="VIDEO">Visio</option>
                    <option value="BOTH">Presentiel + visio</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Email contact (optionnel)</span>
                  <Input
                    type="email"
                    value={settingsForm.contactEmail}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, contactEmail: event.target.value }))
                    }
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Telephone contact (optionnel)</span>
                  <Input
                    type="text"
                    value={settingsForm.contactPhone}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, contactPhone: event.target.value }))
                    }
                  />
                </label>
              </div>

              {settingsForm.isPublished && publicRdvUrl ? (
                <p className="text-sm text-slate-600">
                  URL publique:{' '}
                  <a
                    href={publicRdvUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                    aria-label="Ouvrir la page publique de prise de rendez-vous"
                  >
                    {publicRdvUrl}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </p>
              ) : null}

              {canEdit ? (
                <Button type="submit" disabled={settingsSaving}>
                  {settingsSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Enregistrer les parametres
                </Button>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Services</h2>
        {canEdit ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouveau service
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      ) : null}

      {loading ? (
        <ListSkeleton count={3} />
      ) : services.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Plus className="h-12 w-12 text-slate-300 mb-4" />
            <p className="text-sm font-medium text-slate-600">
              Aucun service configuré.
            </p>
            <p className="text-xs text-slate-600 mt-1 max-w-xs">
              Ajoutez vos services pour permettre la prise de rendez-vous en ligne par vos bénéficiaires.
            </p>
            {canEdit ? (
              <Button size="sm" variant="outline" className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-3 w-3" /> Ajouter un service
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <Card key={service.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{service.name}</span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${service.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}
                  >
                    {service.isActive ? 'Actif' : 'Inactif'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <p>Duree: {service.durationMinutes} min</p>
                <p>Buffers: -{service.bufferBeforeMinutes} min / +{service.bufferAfterMinutes} min</p>
                <p data-testid="pro-service-modes">Modalités : {(Array.isArray(service.modes) && service.modes.length ? service.modes : ['IN_PERSON']).map((m) => (m === 'VIDEO' ? 'À distance (visio)' : 'En présentiel')).join(' · ')}</p>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(service)}>
                      <Edit className="mr-1 h-4 w-4" />
                      Modifier
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleToggleActive(service)}>
                      <Power className="mr-1 h-4 w-4" />
                      {service.isActive ? 'Desactiver' : 'Activer'}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(service.id)}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      Supprimer
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingService ? 'Modifier le service' : 'Creer un service'}</DialogTitle>
            <DialogDescription>Configuration minimale d'un motif de rendez-vous.</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <Label htmlFor="service-name">Nom</Label>
              <Input
                id="service-name"
                value={formData.name}
                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Duree (min)</span>
                <Input
                  type="number"
                  min={5}
                  value={formData.durationMinutes}
                  onChange={(event) => setFormData((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Buffer avant</span>
                <Input
                  type="number"
                  min={0}
                  value={formData.bufferBeforeMinutes}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, bufferBeforeMinutes: event.target.value }))
                  }
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Buffer apres</span>
                <Input
                  type="number"
                  min={0}
                  value={formData.bufferAfterMinutes}
                  onChange={(event) => setFormData((prev) => ({ ...prev, bufferAfterMinutes: event.target.value }))}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(event) => setFormData((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Service actif
            </label>

            <fieldset className="space-y-1 text-sm text-slate-700" data-testid="pro-service-modes-field">
              <legend className="font-medium">Modalités proposées (au moins une)</legend>
              {[['IN_PERSON', 'En présentiel'], ['VIDEO', 'À distance (visio)']].map(([m, label]) => (
                <label key={m} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid={`pro-service-mode-${m}`}
                    checked={(formData.modes || ['IN_PERSON']).includes(m)}
                    onChange={(event) => setFormData((prev) => {
                      const cur = prev.modes || ['IN_PERSON'];
                      const next = event.target.checked ? [...new Set([...cur, m])] : cur.filter((x) => x !== m);
                      return { ...prev, modes: next.length ? next : cur };
                    })}
                  />
                  {label}
                </label>
              ))}
              <p className="text-xs text-slate-700">La visio n’est proposée aux personnes que si la structure l’accepte (mode de réservation) et si le service vidéo est activé.</p>
            </fieldset>

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
