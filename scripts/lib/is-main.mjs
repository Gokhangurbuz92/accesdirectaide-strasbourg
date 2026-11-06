/**
 * R47 — is this module the script node was started with? Compares REAL paths: the former `import.meta.url === \`file://${process.argv[1]}\``
 * test is false when the path goes through a symlink (macOS /var → /private/var, /tmp → /private/tmp) or contains URL-escaped characters, and
 * the script then silently did nothing and exited 0 — a gate that passes without running.
 * @param {string} metaUrl import.meta.url of the calling module
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(metaUrl) {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
