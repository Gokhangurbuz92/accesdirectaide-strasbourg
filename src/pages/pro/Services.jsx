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
import BookingConfigPanel from '@/components/rdv/BookingConfigPanel.jsx';
import ChannelStatusPanel from '@/components/rdv/ChannelStatusPanel.jsx';
import { useT } from '@/i18n';

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
  const { t } = useT('pro');
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

  const [channels, setChannels] = useState(null);   // R46: the honest state of each notification channel (server-computed, no secret)
  const hydrateSettings = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.channels)) setChannels(payload.channels);
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
      setError(t('pro:services.load_error', 'Impossible de charger les services.'));
    } finally {
      setLoading(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; the message follows the language at load time

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const response = await proRdvClient.settings.get();
      hydrateSettings(response);
    } catch {
      setSettingsError(t('pro:services.settings_load_error', 'Impossible de charger les parametres de publication RDV.'));
    } finally {
      setSettingsLoading(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; the message follows the language at load time

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
      setSettingsNotice(t('pro:services.settings_saved', 'Parametres RDV enregistres.'));
    } catch (requestError) {
      if (requestError && typeof requestError === 'object' && requestError.status === 409) {
        setSettingsError(t('pro:services.settings_not_ready', 'Impossible de publier: la base RDV n est pas prete sur cet environnement.'));
      } else {
        setSettingsError(t('pro:services.settings_save_error', 'Impossible de sauvegarder les parametres RDV.'));
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
      setError(t('pro:services.name_required', 'Le nom du service est requis.'));
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
      setError(t('pro:services.save_error', 'Impossible d\'enregistrer le service.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (service) => {
    try {
      await proRdvClient.services.update(service.id, { isActive: !service.isActive });
      await fetchServices();
    } catch {
      setError(t('pro:services.toggle_error', 'Impossible de changer le statut du service.'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('pro:services.delete_confirm', 'Supprimer ce service ?'))) return;
    try {
      await proRdvClient.services.remove(id);
      await fetchServices();
    } catch {
      setError(t('pro:services.delete_error', 'Suppression impossible (des rendez-vous actifs peuvent exister).'));
    }
  };

  return (
    <div className="space-y-6">
      <Card data-testid="pro-rdv-settings-card">
        <CardHeader>
          <CardTitle>{t('pro:services.settings_title', 'Publication de la prise de RDV')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* owner usefulness pass: only once the check answered (it flashed while loading), in plain words */}
          {!readinessOk && rdvReadiness?.status != null ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{t('pro:services.not_installed', 'Publication impossible pour l’instant : les rendez-vous ne sont pas encore installés sur ce serveur.')}</p>
                  {readinessMissingTables.length > 0 ? (
                    <p className="text-xs">{t('pro:services.missing_tables', 'Détail technique pour ADA : tables manquantes ({{tables}}).', { tables: readinessMissingTables.join(', ') })}</p>
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
                {t('pro:services.publish_online', 'Publier la prise de RDV en ligne')}
              </label>
              {/* R42: the R38 account-free opt-in is retired; how requests are confirmed and who can be chosen is set below */}
              <BookingConfigPanel canEdit={canEdit} />

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">{t('pro:services.booking_mode', 'Mode de reservation')}</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={settingsForm.bookingMode}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, bookingMode: event.target.value }))
                    }
                  >
                    <option value="IN_PERSON">{t('pro:services.mode_in_person', 'Presentiel')}</option>
                    <option value="VIDEO">{t('pro:services.mode_video', 'Visio')}</option>
                    <option value="BOTH">{t('pro:services.mode_both', 'Presentiel + visio')}</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">{t('pro:services.contact_email', 'Email contact (optionnel)')}</span>
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
                  <span className="text-sm font-medium text-slate-700">{t('pro:services.contact_phone', 'Telephone contact (optionnel)')}</span>
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
                  {t('pro:services.public_url', 'URL publique:')}{' '}
                  <a
                    href={publicRdvUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                    aria-label={t('pro:services.open_public_page', 'Ouvrir la page publique de prise de rendez-vous')}
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
                  {t('pro:services.save_settings', 'Enregistrer les parametres')}
                </Button>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>

      <ChannelStatusPanel channels={channels} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">{t('pro:services.heading', 'Services')}</h2>
        {canEdit ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('pro:services.new', 'Nouveau service')}
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
              {t('pro:services.empty', 'Aucun service configuré.')}
            </p>
            <p className="text-xs text-slate-600 mt-1 max-w-xs">
              {t('pro:services.empty_hint', 'Ajoutez vos services pour permettre la prise de rendez-vous en ligne par vos bénéficiaires.')}
            </p>
            {canEdit ? (
              <Button size="sm" variant="outline" className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-3 w-3" /> {t('pro:services.add', 'Ajouter un service')}
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
                    {service.isActive ? t('pro:services.active', 'Actif') : t('pro:services.inactive', 'Inactif')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <p>{t('pro:services.duration_line', 'Duree: {{n}} min', { n: service.durationMinutes })}</p>
                <p>{t('pro:services.buffers_line', 'Buffers: -{{before}} min / +{{after}} min', { before: service.bufferBeforeMinutes, after: service.bufferAfterMinutes })}</p>
                <p data-testid="pro-service-modes">{t('pro:services.modes_line', 'Modalités : {{modes}}', { modes: (Array.isArray(service.modes) && service.modes.length ? service.modes : ['IN_PERSON']).map((m) => (m === 'VIDEO' ? t('pro:services.modality_video', 'À distance (visio)') : t('pro:services.modality_in_person', 'En présentiel'))).join(' · ') })}</p>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(service)}>
                      <Edit className="mr-1 h-4 w-4" />
                      {t('pro:services.edit', 'Modifier')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleToggleActive(service)}>
                      <Power className="mr-1 h-4 w-4" />
                      {service.isActive ? t('pro:services.deactivate', 'Desactiver') : t('pro:services.activate', 'Activer')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(service.id)}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t('pro:services.delete', 'Supprimer')}
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
            <DialogTitle>{editingService ? t('pro:services.dialog_edit', 'Modifier le service') : t('pro:services.dialog_create', 'Creer un service')}</DialogTitle>
            <DialogDescription>{t('pro:services.dialog_description', 'Configuration minimale d\'un motif de rendez-vous.')}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <Label htmlFor="service-name">{t('pro:services.name', 'Nom')}</Label>
              <Input
                id="service-name"
                value={formData.name}
                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">{t('pro:services.duration', 'Duree (min)')}</span>
                <Input
                  type="number"
                  min={5}
                  value={formData.durationMinutes}
                  onChange={(event) => setFormData((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">{t('pro:services.buffer_before', 'Buffer avant')}</span>
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
                <span className="text-sm font-medium text-slate-700">{t('pro:services.buffer_after', 'Buffer apres')}</span>
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
              {t('pro:services.is_active', 'Service actif')}
            </label>

            <fieldset className="space-y-1 text-sm text-slate-700" data-testid="pro-service-modes-field">
              <legend className="font-medium">{t('pro:services.modes_legend', 'Modalités proposées (au moins une)')}</legend>
              {[['IN_PERSON', t('pro:services.modality_in_person', 'En présentiel')], ['VIDEO', t('pro:services.modality_video', 'À distance (visio)')]].map(([m, label]) => (
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
              <p className="text-xs text-slate-700">{t('pro:services.video_hint', 'La visio n’est proposée aux personnes que si la structure l’accepte (mode de réservation) et si le service vidéo est activé.')}</p>
            </fieldset>

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {t('pro:services.save', 'Enregistrer')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
