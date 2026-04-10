import { convertToCsv, escapeCell } from './csv.util';

describe('csv.util', () => {
  describe('escapeCell', () => {
    it('returns empty string for null/undefined', () => {
      expect(escapeCell(null)).toBe('');
      expect(escapeCell(undefined)).toBe('');
    });

    it('passes plain values through unchanged', () => {
      expect(escapeCell('hello')).toBe('hello');
      expect(escapeCell(42)).toBe('42');
    });

    it('quotes values containing commas', () => {
      expect(escapeCell('a,b')).toBe('"a,b"');
    });

    it('escapes embedded double quotes', () => {
      expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('quotes values containing newlines', () => {
      expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
    });

    it('prefixes and quotes values that are both a formula and contain a comma', () => {
      expect(escapeCell('=a,b')).toBe(`"'=a,b"`);
    });

    it.each([
      ['=SUM(A1)', `"'=SUM(A1)"`],
      ['+1+1', `"'+1+1"`],
      ['-2', `"'-2"`],
      ['@cmd', `"'@cmd"`],
      ['\tleading', `"'\tleading"`],
      ['\rreturn', `"'\rreturn"`]
    ])('prefixes formula injection attempts: %s', (input, expected) => {
      expect(escapeCell(input)).toBe(expected);
    });
  });

  describe('convertToCsv', () => {
    it('returns empty buffer for empty data', () => {
      expect(convertToCsv([]).toString()).toBe('');
    });

    it('builds header row and values', () => {
      const out = convertToCsv([{ a: 1, b: 'x' }]).toString();
      expect(out).toBe('a,b\n1,x');
    });

    it('escapes formula-injection values in cells', () => {
      const out = convertToCsv([{ name: '=HYPERLINK("http://x")' }]).toString();
      expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    });

    it('emits one row per data entry', () => {
      const out = convertToCsv([{ a: 1 }, { a: 2 }, { a: 3 }]).toString();
      expect(out).toBe('a\n1\n2\n3');
    });
  });
});
