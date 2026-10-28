// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { deleteCoffre, downloadCoffre, listCoffre, shareFromCoffre, uploadCoffre } from '../../_services/mon-espace.js';
import { attachmentDisposition } from '../../_utils/content-disposition.js';


/**
 * PKG-2 / C09 Mon Coffre.  GET -> { documents, quota }   GET ?download=<id> -> the decrypted bytes (attachment, no-store, nosniff)
 * POST { category, originalName, mimeType, fileBase64, expiresAt? }   POST { action: 'share', documentId, shareId, structureId } (to ONE granted organisation)   DELETE { id } (blob purged)
 */
export default citizenHandler('coffre', ['GET', 'POST', 'DELETE'], async (citizen, req, res) => {
  if (req.method === 'GET') {
    const id = req.query?.download;
    if (!id) return listCoffre(citizen.id);
    const out = await downloadCoffre(citizen.id, id);
    if (!out.ok) return out;
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(out.name));   // R14: never throws on a Unicode name
    res.setHeader('Content-Length', out.bytes.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(out.bytes);
    return undefined;
  }
  if (req.method === 'POST') return req.body?.action === 'share' ? shareFromCoffre(citizen.id, req.body) : uploadCoffre(citizen.id, req.body);
  return deleteCoffre(citizen.id, req.body?.id);
});
