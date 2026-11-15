// @ts-nocheck
import { citizenFollowUps } from '../../_services/pro-cases.js';
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { dossierAccessLog, dossierDocuments, downloadDossierDocument, removeDossierDocument } from '../../_services/mon-espace.js';
import { attachmentDisposition } from '../../_utils/content-disposition.js';
import { citizenDecide as referentDecide, citizenEnd as referentEnd, citizenView as referentView } from '../../_services/dossier-referent.js';


/**
 * PKG-2 / R16 + C17 — transparency on a dossier attached to the account.
 * GET ?shareId=&view=followups -> { followUps } (each organization's follow-up: status, outcome summary, notes written for the person — never internal notes)
 * GET ?shareId=&view=access -> { events } (which organisation did what, when; no staff id, no IP)
 * GET ?shareId=&view=documents -> { documents }   GET ?shareId=&download=<fileId> -> the decrypted bytes
 * DELETE { shareId, fileId } -> the person removes a document an organisation attached (the blob is purged)
 * M2 / G5 — the contact person of the path (« référent de parcours »: declarative, no access, no legal responsibility; api/_services/dossier-referent.js):
 * GET ?shareId=&view=referent -> { referent, proposal }   POST { action: 'referent_decide', shareId, accept } | { action: 'referent_end', shareId }
 */
export default citizenHandler('dossier', ['GET', 'POST', 'DELETE'], async (citizen, req, res) => {
  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.action === 'referent_decide' && typeof b.accept === 'boolean') return referentDecide(citizen.id, b.shareId, b.accept);
    if (b.action === 'referent_end') return referentEnd(citizen.id, b.shareId);
    return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
  }
  if (req.method === 'DELETE') return removeDossierDocument(citizen.id, req.body?.shareId, req.body?.fileId);
  const q = req.query || {};
  if (q.download) {
    const out = await downloadDossierDocument(citizen.id, q.shareId, q.download);
    if (!out.ok) return out;
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(out.name));   // R14: never throws on a Unicode name
    res.setHeader('Content-Length', out.bytes.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(out.bytes);
    return undefined;
  }
  if (q.view === 'followups') return { ok: true, status: 200, followUps: await citizenFollowUps(citizen.id, String(q.shareId || '')) };   // PKG-4: case status, outcome summary, notes written FOR the person
  if (q.view === 'referent') return referentView(citizen.id, q.shareId);
  if (q.view === 'access') return dossierAccessLog(citizen.id, q.shareId);
  return dossierDocuments(citizen.id, q.shareId);
});
