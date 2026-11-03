/**
 * R41-K F5 — the client-side CSV export of the pro audit log neutralises spreadsheet formulas like the server exports do: one cell helper shared by the
 * server (api/_utils/admin-personal-data.js csvCell) and the browser (src/lib/csv.js), and the audit page builds its file with it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from '../../src/lib/csv.js';

describe('client CSV cells', () => {
  it('quotes every value and prefixes formula starters (an RFC-valid e-mail can start with one)', () => {
    expect(csvCell('=HYPERLINK("http://x.test")@x.fr')).toBe(`"'=HYPERLINK(""http://x.test"")@x.fr"`);
    expect(csvCell('+33 6')).toBe(`"'+33 6"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvLine(['a', '=1+1', 'b "c"'])).toBe(`"a","'=1+1","b ""c"""`);
  });
  it('the server export helper is the same function', async () => {
    const server = await import('../../api/_utils/admin-personal-data.js');
    expect(server.csvCell).toBe(csvCell);
  });
  it('the pro audit log export builds every line with csvLine (no hand-quoted cells)', () => {
    const src = readFileSync('src/pages/pro/AuditLog.jsx', 'utf8');
    const exportFn = src.slice(src.indexOf('const handleExport'), src.indexOf('new Blob'));
    expect(exportFn).toMatch(/csvLine\(/);
    expect(exportFn).not.toMatch(/`"\$\{/);
  });
});
