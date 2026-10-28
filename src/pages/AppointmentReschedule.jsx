// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, CalendarClock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';

import { getCsrfHeaders } from '@/lib/csrf';
/**
 * AppointmentReschedule — Citizen rescheduling via secure token link
 *
 * Route: /appointments/reschedule/:token
 * 1. Fetches real availability from /api/public/availability
 * 2. Calls PUT /api/appointments/reschedule with { token, newStartAt }
 */
export default function AppointmentReschedule() {
  const [token] = useState(() => {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const value = params.get('token') || '';
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        return value;
    });
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Compute min date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  // Fetch available slots when date changes
  const fetchSlots = useCallback(async (/** @type {string} */ date) => {
    if (!date) return;
    setSlotsLoading(true);
    setSelectedTime('');
    try {
      // Extract structureId from token URL or use a general availability endpoint
      const res = await fetch(`/api/public/availability?date=${date}`);
      if (res.ok) {
        const slots = await res.json();
        // Filter slots for the selected date and extract time strings
        const filtered = (Array.isArray(slots) ? slots : [])
          .filter((s) => s.start && s.start.startsWith(date))
          .map((s) => {
            const d = new Date(s.start);
            return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
          });
        setAvailableSlots(filtered);
                if (filtered.length === 0) setErrorMsg('Aucun créneau disponible pour cette date.');
      } else {
        setAvailableSlots([]);
                setErrorMsg('Impossible de vérifier les créneaux disponibles.');
      }
    } catch {
      setAvailableSlots([]);
                setErrorMsg('Impossible de vérifier les créneaux disponibles.');
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchSlots(selectedDate);
    }
  }, [selectedDate, fetchSlots]);

  const handleReschedule = async () => {
    if (!token) {
      setStatus('error');
      setErrorMsg('Lien de report invalide.');
      return;
    }

    if (!selectedDate || !selectedTime) {
      setStatus('error');
      setErrorMsg('Veuillez sélectionner une date et un créneau.');
      return;
    }

    const newStartAt = new Date(`${selectedDate}T${selectedTime}`);
    if (isNaN(newStartAt.getTime()) || newStartAt <= new Date()) {
      setStatus('error');
      setErrorMsg('La date choisie doit être dans le futur.');
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch('/api/appointments/reschedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({
          token,
          newStartAt: newStartAt.toISOString(),
        }),
      });

      if (res.ok) {
        setStatus('success');
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus('error');
        setErrorMsg(data.error || 'Le report a échoué. Veuillez réessayer.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Erreur de connexion. Veuillez réessayer.');
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO title="Rendez-vous reporté" noindex />
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg text-center p-8 border border-slate-100">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-500" size={32} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Rendez-vous reporté</h1>
          <p className="text-sm text-slate-500 mb-2">
            Votre nouveau créneau a été enregistré.
          </p>
          <p className="text-sm font-semibold text-slate-700 mb-8">
            {new Date(`${selectedDate}T${selectedTime}`).toLocaleDateString('fr-FR', {
              weekday: 'long', day: 'numeric', month: 'long',
            })} à {selectedTime}
          </p>
          <Button onClick={() => navigate('/')} className="w-full">
            Retour à l&apos;accueil
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <
// @ts-ignore
      SEO title="Reporter mon rendez-vous" noindex />
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-500 text-white p-8 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4">
            <CalendarClock size={24} />
          </div>
          <h1 className="text-lg font-bold">Reporter mon rendez-vous</h1>
          <p className="text-xs opacity-80 mt-1">AccesDirectAide</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Nouvelle date
            </span>
            <input
              type="date"
              min={minDate}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-400 focus:bg-white outline-none transition-all text-slate-700"
            />
          </div>

          {selectedDate && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Créneau horaire
              </span>
              {slotsLoading ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <Loader2 className="animate-spin mr-2" size={16} />
                  <span className="text-sm">Chargement des créneaux…</span>
                </div>
              ) : availableSlots.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">
                  Aucun créneau disponible pour cette date.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      onClick={() => setSelectedTime(slot)}
                      className={`py-2 rounded-lg text-xs font-medium transition-all ${selectedTime === slot
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="p-3 bg-red-50 border border-red-100 text-red-700 rounded-xl flex items-center gap-2 text-xs font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleReschedule}
              disabled={status === 'loading' || !selectedDate || !selectedTime}
              className="w-full"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  Traitement…
                </>
              ) : (
                'Confirmer le report'
              )}
            </Button>

            <Button
              onClick={() => navigate(-1)}
              disabled={status === 'loading'}
              variant="ghost"
              className="w-full"
            >
              Conserver la date actuelle
            </Button>
          </div>
        </div>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400">
            Un email de confirmation sera envoyé · AccesDirectAide
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Fallback time slots used when the availability API is not configured
 * or the structure has no defined schedule.
 */
