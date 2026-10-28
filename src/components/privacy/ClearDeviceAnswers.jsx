import { useState } from 'react';
import { storage } from '@/lib/storage';

/**
 * Launch-readiness item 63 — « Effacer mes réponses de cet appareil »: removes the questionnaire and assistant answers this browser keeps (src/lib/storage.js)
 * at once, from the privacy page (the questionnaire page has « Réinitialiser tout »). Nothing is sent: these answers exist only on the device.
 */
export default function ClearDeviceAnswers() {
  const [done, setDone] = useState(false);
  return (
    <span className="mt-2 block">
      <button type="button" data-testid="clear-device-answers" onClick={() => { storage.clearAll(); setDone(true); }}
        className="rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500">
        Effacer mes réponses enregistrées sur cet appareil
      </button>
      <span role="status" className="ml-2 text-sm">{done ? 'Vos réponses ont été effacées de cet appareil.' : ''}</span>
    </span>
  );
}
