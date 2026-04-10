/**
 * CSV export utilities with formula-injection protection.
 *
 * Any cell whose stringified value begins with `=`, `+`, `-`, `@`, `\t`, or
 * `\r` is prefixed with a single quote and wrapped in double quotes so that
 * spreadsheet software does not interpret it as a formula when the exported
 * file is opened.
 */

const FORMULA_RE = /^[=+\-@\t\r]/;

export function escapeCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  const hasFormula = FORMULA_RE.test(str);
  const needsQuote = hasFormula || str.includes(',') || str.includes('"') || str.includes('\n');
  if (!needsQuote) return str;
  const prefixed = hasFormula ? `'${str}` : str;
  return `"${prefixed.replace(/"/g, '""')}"`;
}

export function convertToCsv(data: object[]): Buffer {
  if (data.length === 0) {
    return Buffer.from('');
  }

  const headers = Object.keys(data[0]);
  const rows: string[] = [headers.map((h) => escapeCell(h)).join(',')];

  for (const row of data) {
    const values = headers.map((h) => escapeCell((row as Record<string, unknown>)[h]));
    rows.push(values.join(','));
  }

  return Buffer.from(rows.join('\n'), 'utf-8');
}
