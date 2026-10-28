/**
 * National emergency numbers shown on /ressources?emergency=1 when the API list is unavailable (network error, 429, 5xx, empty answer).
 * A life-safety page must not be blank because a request failed. These are the same five public numbers the API serves (api/_handlers/ressources.js);
 * tests/unit/dta-s7-emergency-resources.test.jsx pins the two lists to each other so they cannot drift apart. Nothing here is territory data.
 */
export const EMERGENCY_FALLBACK = [
  { id: 'emergency-112', title: 'Urgences européennes', phone: '112' },
  { id: 'emergency-15', title: 'SAMU', phone: '15' },
  { id: 'emergency-17', title: 'Police secours', phone: '17' },
  { id: 'emergency-18', title: 'Sapeurs-pompiers', phone: '18' },
  { id: 'emergency-115', title: 'SAMU social', phone: '115' },
];
