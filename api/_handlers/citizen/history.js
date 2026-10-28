// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addHistory, listHistory, removeHistory, setHistoryEnabled } from '../../_services/mon-espace.js';

/** PKG-2 / C11 opt-in history.  GET -> { enabled, entries }   PUT { enabled } (false erases everything)   POST { kind, label, ref? } (ignored unless enabled)   DELETE { id? } (no id = all) */
export default citizenHandler('history', ['GET', 'PUT', 'POST', 'DELETE'], async (citizen, req) => {
  if (req.method === 'GET') return listHistory(citizen.id);
  if (req.method === 'PUT') return setHistoryEnabled(citizen.id, req.body?.enabled);
  if (req.method === 'POST') return addHistory(citizen.id, req.body);
  return removeHistory(citizen.id, req.body?.id);
});
