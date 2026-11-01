// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// PKG-11 audit pass 2 (P05): the marker images ship with the application — they were fetched from unpkg.com at run time (a third-party request revealing the
// visitor, broken wherever that host is blocked)
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useT } from '@/i18n';

/** Tile provider URL — change here to swap provider globally */
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Default center: France */
const FRANCE_CENTER = [46.6, 2.3];
const FRANCE_ZOOM = 6;

/** R32: the name and the address of a place are never translated — they read as French, left to right even in an Arabic page */
const FRENCH_TEXT = { lang: 'fr', dir: 'ltr' };

const hasPosition = (s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && Number.isFinite(s.latitude) && Number.isFinite(s.longitude);

/** The popup of one place, built as DOM nodes (text only: no HTML from the record is ever interpreted). `openLabel`: the link text, in the interface language. */
function popupOf(s, onOpen, openLabel) {
  const box = document.createElement('div'); box.className = 'text-sm';
  const name = document.createElement('p'); name.className = 'font-semibold mb-1'; Object.assign(name, FRENCH_TEXT); name.textContent = s.nom || ''; box.appendChild(name);
  const where = [s.adresse, [s.code_postal, s.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (where) { const p = document.createElement('p'); p.className = 'text-gray-700 mb-2'; Object.assign(p, FRENCH_TEXT); p.textContent = where; box.appendChild(p); }
  if (s.type_structure) { const p = document.createElement('p'); p.className = 'text-xs text-gray-700 mb-2'; p.textContent = s.type_structure; box.appendChild(p); }
  const to = `/structures/${encodeURIComponent(s.slug)}`;
  const link = document.createElement('a'); link.href = to; link.className = 'text-blue-700 hover:underline font-medium'; link.textContent = openLabel;
  link.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpen(to); });
  box.appendChild(link);
  return box;
}

/**
 * PKG-11 audit pass 2 (P05): the directory map drives Leaflet directly. It used react-leaflet 5, which requires React 19 — under the application's React 18 the
 * « Carte » view threw (« r is not a function ») and the whole site fell to the error screen. Leaflet 1.9 itself is already a dependency: no new package.
 * @param {{ structures: Array<{ id: string, slug: string, nom: string, latitude?: number, longitude?: number, adresse?: string, ville?: string, code_postal?: string, type_structure?: string }> }} props
 */
export default function StructureMap({ structures }) {
  const { t } = useT('structures');
  const navigate = useNavigate();
  const box = useRef(null);
  const [failed, setFailed] = useState(false);
  const geoStructures = (structures || []).filter(hasPosition);
  const withoutPosition = (structures || []).length - geoStructures.length;
  const key = geoStructures.map((s) => `${s.id}:${s.latitude}:${s.longitude}`).join('|');
  const openLabel = t('structures:map.open_record', 'Voir la fiche →');
  const placeLabel = t('structures:map.marker_fallback', 'Lieu');

  useEffect(() => {
    let map = null; let alive = true;
    // Dynamically import leaflet only in the browser (avoid SSR/SSG crash)
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      if (!alive || !box.current) return;
      const L = mod.default || mod;
      const icon = L.icon({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
      map = L.map(box.current, { scrollWheelZoom: true });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(map);
      for (const s of geoStructures) L.marker([s.latitude, s.longitude], { icon, alt: s.nom || placeLabel, title: s.nom || '' }).addTo(map).bindPopup(popupOf(s, navigate, openLabel));
      if (geoStructures.length === 1) map.setView([geoStructures[0].latitude, geoStructures[0].longitude], 13);
      else if (geoStructures.length > 1) map.fitBounds(L.latLngBounds(geoStructures.map((s) => [s.latitude, s.longitude])), { padding: [40, 40] });
      else map.setView(FRANCE_CENTER, FRANCE_ZOOM);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (map) map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the positioned places change (key) or the interface language does (labels), not on every render
  }, [key, navigate, openLabel, placeLabel]);

  return (
    <div className="space-y-2">
      {/* PKG-11 audit pass 2: places without a known position were left out silently */}
      {withoutPosition > 0 && (
        <p className="text-sm text-slate-700" data-testid="map-missing-count">
          {t('structures:map.missing', { count: withoutPosition, defaultValue_one: '{{count}} lieu n’a pas de position connue : il n’est pas sur la carte (voir la liste).', defaultValue_other: '{{count}} lieux n’ont pas de position connue : ils ne sont pas sur la carte (voir la liste).' })}
        </p>
      )}
      {failed ? (
        <p role="alert" className="text-sm text-red-800" data-testid="map-error">{t('structures:map.error', 'La carte n’a pas pu être chargée : utilisez la liste.')}</p>
      ) : (
        <div ref={box} className="h-[500px] w-full rounded-lg overflow-hidden border border-slate-200" role="application" aria-label={t('structures:map.label', 'Carte des structures')} data-testid="structures-map" />
      )}
    </div>
  );
}
