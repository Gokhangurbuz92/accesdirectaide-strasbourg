/**
 * Launch-readiness item 60: the codec of SharedDiagnostic.situation (src/db/sealed-json.ts) — envelope encryption, purpose 'diagnostic-situation', bound to the
 * column. Loaded by src/db/index.ts only where the data key exists; covered by the key rotation (api/_services/key-rotation.js).
 */
import { openText, sealText } from './data-keys.js';
import { registerSealedJsonCodec } from '../../src/db/sealed-json.js';

export const SITUATION_SEAL = /** @type {const} */ ({ purpose: 'diagnostic-situation', context: 'SharedDiagnostic.situation' });
registerSealedJsonCodec({ seal: (json) => sealText(json, SITUATION_SEAL), open: (sealed) => /** @type {string} */ (openText(sealed, SITUATION_SEAL)) });
