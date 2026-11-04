// R42: moved out of src/pages/StructureDetail.jsx so the page file only exports its component.
/** the place on OpenStreetMap: its marker when the coordinates are known, otherwise a search of its address @param {any} st */
export function mapUrl(st) {
  const lat = Number(st?.latitude); const lon = Number(st?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent([st?.adresse, st?.code_postal, st?.ville].filter(Boolean).join(' '))}`;
}
