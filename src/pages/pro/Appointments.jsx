// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, CheckCircle, Loader2, Plus, RefreshCw, XCircle } from 'lucide-react';
import { ListSkeleton } from '@/components/pro/ProPageSkeletons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { buildProAuthHeaders, getProToken, proRdvClient } from '@/api/pro-rdv-client';

function formatDateTime(raw) {
  if (!raw) return '-';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

function toDateIso(dateValue, kind) {
  const normalized = String(dateValue || '').trim();
  if (!normalized) return '';
  const suffix = kind === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
  return `${normalized}${suffix}`;
}

// owner usefulness pass (2026-10-25): statuses in French (they showed the raw codes), and every status the agenda really holds (citizen bookings are 'confirmed')
const STATUS_LABEL = { booked: 'Réservé par la structure', confirmed: 'Confirmé', requested: 'Demandé', pending: 'En attente', cancelled: 'Annulé', done: 'Venu', no_show: 'Absent' };
const STATUS_STYLES = {
  booked: 'border-blue-200 bg-blue-50 text-blue-800',
  confirmed: 'border-blue-200 bg-blue-50 text-blue-800',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  no_show: 'border-amber-200 bg-amber-50 text-amber-900',
};

export default function ProAppointments() {
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
  const [services, setServices] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [filters, setFilters] = useState({
    serviceId: '',
    status: '',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    const from = toDateIso(filters.fromDate, 'start');
    const to = toDateIso(filters.toDate, 'end');

    try {
      // R18: the server returns at most 50 per page (it used to be asked for 100 and silently gave 50): every page of the period is read
      const listPage = (page) => proRdvClient.appointments.list({
        from: from || undefined,
        to: to || undefined,
        status: filters.status || undefined,
        pageSize: 50,
        page,
      });
      const [servicesResponse, firstPage] = await Promise.all([proRdvClient.services.list(), listPage(1)]);
      const pages = Math.min(Number(firstPage?.totalPages) || 1, 40);
      const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => listPage(i + 2))) : [];

      setServices(Array.isArray(servicesResponse) ? servicesResponse : []);
      const items = [firstPage, ...rest].flatMap((r) => (Array.isArray(r?.items) ? r.items : []));
      const filteredByService =
        filters.serviceId && filters.serviceId !== ''
          ? items.filter((item) => item.serviceId === filters.serviceId)
          : items;
      setAppointments(filteredByService);
    } catch {
      setError('Impossible de charger l\'agenda.');
    } finally {
      setLoading(false);
    }
  }, [filters.fromDate, filters.toDate, filters.status, filters.serviceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const serviceOptions = useMemo(() => {
    return services.map((service) => ({ id: service.id, name: service.name }));
  }, [services]);

  const updateStatus = async (id, status) => {
    if (status === 'cancelled' && !window.confirm('Annuler ce rendez-vous ? La personne en sera prévenue.')) return;
    setUpdatingId(id);
    setError('');
    try {
      if (status === 'cancelled') {
        await proRdvClient.appointments.cancelLegacy(id);
      } else {
        await proRdvClient.appointments.update(id, { status });
      }
      await loadData();
    } catch (e) {
      // the server's own reason (French) when there is one; it used to be replaced by a generic sentence
      setError(e?.payload?.message || e?.payload?.error || (typeof e?.message === 'string' && e.message) || 'Impossible de mettre à jour ce rendez-vous.');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Agenda</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualiser
          </Button>
          <Button variant="outline" data-testid="pro-agenda-ics" onClick={async () => {
            // PKG-3 / B10: authenticated .ics download of the agenda (no subscription URL, no token in a link)
            const res = await fetch('/api/pro/appointments/ics', { headers: buildProAuthHeaders(getProToken()) }).catch(() => null);
            // R7: a failed export says so (nothing happened before)
            if (!res || !res.ok) { setError(res && res.status === 401 ? 'Votre session a expiré : reconnectez-vous.' : 'L’export de l’agenda n’a pas pu être préparé. Réessayez.'); return; }
            const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a');
            link.href = url; link.download = 'agenda-acces-direct-aide.ics'; link.click(); URL.revokeObjectURL(url);
          }}>
            Exporter l’agenda (.ics)
          </Button>
          <Button asChild>
            <Link to="/pro/rdv/new">Creer un RDV</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Service</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.serviceId}
              onChange={(event) => setFilters((prev) => ({ ...prev, serviceId: event.target.value }))}
            >
              <option value="">Tous</option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Statut</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="">Tous</option>
              <option value="confirmed">Confirmé</option>
              <option value="booked">Réservé par la structure</option>
              <option value="done">Venu</option>
              <option value="no_show">Absent</option>
              <option value="cancelled">Annulé</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Du</span>
            <Input
              type="date"
              value={filters.fromDate}
              onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-slate-700">Au</span>
            <Input
              type="date"
              value={filters.toDate}
              onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))}
            />
          </label>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      ) : null}

      {loading ? (
        <ListSkeleton count={4} />
      ) : appointments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Calendar className="h-12 w-12 text-slate-300 mb-2" />
            <p className="text-sm font-medium text-slate-600">
              Aucun rendez-vous sur cette période.
            </p>
            <p className="text-xs text-slate-600 max-w-xs">
              Configurez vos disponibilités pour recevoir des demandes de rendez-vous.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              asChild
            >
              <Link to="/pro/rdv/disponibilites">
                <Plus className="mr-2 h-3 w-3" /> Définir mes disponibilités
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {appointments.map((appointment) => {
            const statusClass = STATUS_STYLES[appointment.status] || 'border-slate-200 bg-slate-100 text-slate-700';
            return (
              <Card key={appointment.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{formatDateTime(appointment.startAt || appointment.start_at)}</p>
                      <Badge className={statusClass}>{STATUS_LABEL[appointment.status] || appointment.status}</Badge>
                      <Badge className="border-indigo-200 bg-indigo-50 text-indigo-800" data-testid="pro-agenda-mode">{appointment.mode === 'VIDEO' ? 'À distance (visio)' : 'En présentiel'}</Badge>
                      {appointment.rescheduleCount ? <Badge className="border-amber-200 bg-amber-50 text-amber-900" data-testid="pro-agenda-rescheduled">Déplacé par la personne ({appointment.rescheduleCount})</Badge> : null}
                      {appointment.mode === 'VIDEO' && !appointment.video?.approved ? <Badge className="border-amber-200 bg-amber-50 text-amber-900" data-testid="pro-agenda-video-pending">Visio à valider</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-700">
                      {appointment.serviceName || 'Service'}
                      {' - '}
                      {appointment.beneficiaryName || 'Beneficiaire'}
                    </p>
                    {appointment.notes ? <p className="text-xs text-slate-700">{appointment.notes}</p> : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline"><Link to={`/pro/appointments/${encodeURIComponent(appointment.id)}`} data-testid="pro-agenda-detail">Détails</Link></Button>
                    {/* PKG-4 / B09: attendance only once the appointment has started (the API refuses earlier) */}
                    {!['done', 'no_show', 'cancelled'].includes(appointment.status) && new Date(appointment.startAt || appointment.start_at).getTime() <= Date.now() ? (
                      <>
                        <Button size="sm" variant="outline" data-testid="pro-agenda-attended" onClick={() => updateStatus(appointment.id, 'done')} disabled={updatingId === appointment.id}>
                          {updatingId === appointment.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
                          Présent·e
                        </Button>
                        <Button size="sm" variant="outline" data-testid="pro-agenda-no-show" onClick={() => updateStatus(appointment.id, 'no_show')} disabled={updatingId === appointment.id}>Absent·e</Button>
                      </>
                    ) : null}

                    {/* a past appointment is marked « venu » / « absent », not cancelled */}
                    {!['cancelled', 'done', 'no_show'].includes(appointment.status) && new Date(appointment.startAt || appointment.start_at).getTime() > Date.now() ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => updateStatus(appointment.id, 'cancelled')}
                        disabled={updatingId === appointment.id}
                      >
                        {updatingId === appointment.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                        Annuler
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
