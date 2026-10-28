// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { espaceSummary } from '../../_services/mon-espace.js';

/** PKG-2 / C13 GET /api/citizen/espace -> { summary } : one call for the Mon Espace home (parcours, next deadline, next appointment, documents, favourites, dossiers). */
export default citizenHandler('espace', ['GET'], async (citizen) => espaceSummary(citizen.id));
