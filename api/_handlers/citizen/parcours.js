// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addManualItem, importPlan, itemHistory, listParcours, removeItem, setDeadline, setNote, setStatus } from '../../_services/mon-espace.js';

/**
 * PKG-2 / C07 Mon Parcours.  GET -> { items }   GET ?history=<id> -> { events }
 * POST { action: 'import', shareId } | { action: 'add', title } | { action: 'status', id, status } | { action: 'deadline', id, dueDate|null, dueSourceUrl } | { action: 'note', id, note }
 * DELETE { id }
 */
export default citizenHandler('parcours', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  if (req.method === 'GET') {
    const hid = req.query?.history;
    return hid ? itemHistory(citizen.id, hid) : listParcours(citizen.id);
  }
  if (req.method === 'DELETE') return removeItem(citizen.id, req.body?.id);
  const b = req.body || {};
  switch (b.action) {
    case 'import': return importPlan(citizen.id, b.shareId);
    case 'add': return addManualItem(citizen.id, b);
    case 'status': return setStatus(citizen.id, b.id, b.status);
    case 'deadline': return setDeadline(citizen.id, b.id, b);
    case 'note': return setNote(citizen.id, b.id, b.note);
    default: return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
  }
});
