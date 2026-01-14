import { MarketDataReaderService } from './market-data-reader.service';

describe('MarketDataReaderService', () => {
  const createService = () => new MarketDataReaderService({} as any);

  describe('sanitizeObjectPath', () => {
    it('rejects path traversal segments', () => {
      const service = createService();

      expect(() => (service as any).sanitizeObjectPath('../secrets.csv')).toThrow(
        'Invalid storage path: path traversal not allowed'
      );
      expect(() => (service as any).sanitizeObjectPath('datasets/../secrets.csv')).toThrow(
        'Invalid storage path: path traversal not allowed'
      );
    });

    it('rejects absolute paths', () => {
      const service = createService();

      expect(() => (service as any).sanitizeObjectPath('/datasets/btc.csv')).toThrow(
        'Invalid storage path: absolute paths not allowed'
      );
    });
  });

  describe('parseCSV', () => {
    it('parses quoted values with commas and defaults optional fields', () => {
      const service = createService();
      const csv = [
        'Timestamp,Close,Symbol',
        '2024-01-01T00:00:00Z,100,"BTC,USD"',
        '2024-01-01T01:00:00Z,101,"BTC,USD"'
      ].join('\n');

      const result = (service as any).parseCSV(csv, []);

      expect(result).toHaveLength(2);
      expect(result[0].coinId).toBe('BTC,USD');
      expect(result[0].open).toBe(100);
      expect(result[0].high).toBe(100);
      expect(result[0].low).toBe(100);
      expect(result[0].volume).toBe(0);
    });

    it('skips invalid timestamps and keeps valid rows', () => {
      const service = createService();
      const csv = ['timestamp,close', 'not-a-date,100', '2024-01-01T00:00:00Z,101'].join('\n');

      const result = (service as any).parseCSV(csv, []);

      expect(result).toHaveLength(1);
      expect(result[0].close).toBe(101);
    });

    it('throws when all timestamps are invalid', () => {
      const service = createService();
      const csv = ['timestamp,close', 'not-a-date,100', 'also-bad,101'].join('\n');

      expect(() => (service as any).parseCSV(csv, [])).toThrow('No valid data rows found in CSV');
    });
  });
});
