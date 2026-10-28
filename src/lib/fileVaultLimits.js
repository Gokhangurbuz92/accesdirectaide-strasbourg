// DTA S8: the server (api/_handlers/pro/dossier/upload-secure.js) accepts application/pdf, image/jpeg and image/png up to 10 MB. The JSON upload carries the file as
// base64 (+33 %) and a serverless request body is capped near 4.5 MB, so the screen stops at 3 MB: it never offers a file the server cannot take.
export const MAX_SIZE = 3 * 1024 * 1024;
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
