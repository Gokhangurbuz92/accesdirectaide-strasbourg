// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addFavorite, listFavorites, removeFavorite } from '../../_services/mon-espace.js';

/** PKG-2 / C10.  GET -> { favorites }   POST { entityType, entityId } (published records only)   DELETE { entityType, entityId } */
export default citizenHandler('favorites', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  if (req.method === 'GET') return listFavorites(citizen.id);
  if (req.method === 'POST') return addFavorite(citizen.id, req.body);
  return removeFavorite(citizen.id, req.body);
});
